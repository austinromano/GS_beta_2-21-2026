// Lightweight WAV peak/RMS extractor.
// Parses PCM WAV (8/16/24/32-bit int, 32-bit float) directly from a Buffer,
// returns a downsampled peaks + RMS array suitable for waveform rendering.
// For non-WAV files, throws — the client will fall back to its existing
// decodeAudioData path.

export interface PeakData {
  peaks: number[];
  rms: number[];
  duration: number;
  sampleRate: number;
  channels: number;
  bins: number;
}

export function parseWavPeaks(buf: Buffer, targetBins = 1024): PeakData {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a WAV file');
  }

  let offset = 12;
  let sampleRate = 44100;
  let channels = 1;
  let bitsPerSample = 16;
  let audioFormat = 1; // 1 = PCM, 3 = IEEE float
  let dataStart = 0;
  let dataSize = 0;

  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      audioFormat = buf.readUInt16LE(offset + 8);
      channels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
      bitsPerSample = buf.readUInt16LE(offset + 22);
    } else if (id === 'data') {
      dataStart = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size + (size & 1); // chunks are word-aligned
  }

  if (dataStart === 0) throw new Error('no data chunk');

  const bytesPerSample = bitsPerSample / 8;
  const frameSize = bytesPerSample * channels;
  const totalFrames = Math.floor(dataSize / frameSize);
  const duration = totalFrames / sampleRate;
  const bins = Math.min(targetBins, totalFrames);
  const framesPerBin = Math.max(1, Math.floor(totalFrames / bins));

  const peaks = new Array<number>(bins);
  const rmsArr = new Array<number>(bins);

  const readSample = (byteOffset: number): number => {
    if (audioFormat === 3 && bitsPerSample === 32) {
      return buf.readFloatLE(byteOffset);
    }
    if (bitsPerSample === 16) return buf.readInt16LE(byteOffset) / 32768;
    if (bitsPerSample === 24) {
      const b0 = buf[byteOffset];
      const b1 = buf[byteOffset + 1];
      const b2 = buf[byteOffset + 2];
      let val = b0 | (b1 << 8) | (b2 << 16);
      if (val & 0x800000) val |= ~0xFFFFFF;
      return val / 8388608;
    }
    if (bitsPerSample === 32) return buf.readInt32LE(byteOffset) / 2147483648;
    if (bitsPerSample === 8) return (buf.readUInt8(byteOffset) - 128) / 128;
    return 0;
  };

  for (let b = 0; b < bins; b++) {
    let max = 0;
    let sumSq = 0;
    let count = 0;
    const startFrame = b * framesPerBin;
    const endFrame = b === bins - 1 ? totalFrames : Math.min(startFrame + framesPerBin, totalFrames);

    for (let f = startFrame; f < endFrame; f++) {
      let sum = 0;
      const frameByteOffset = dataStart + f * frameSize;
      for (let ch = 0; ch < channels; ch++) {
        sum += readSample(frameByteOffset + ch * bytesPerSample);
      }
      const v = sum / channels;
      const abs = v < 0 ? -v : v;
      if (abs > max) max = abs;
      sumSq += v * v;
      count++;
    }
    peaks[b] = max;
    rmsArr[b] = count > 0 ? Math.sqrt(sumSq / count) : 0;
  }

  return { peaks, rms: rmsArr, duration, sampleRate, channels, bins };
}

// Simple in-memory LRU cache for generated peaks.
const CACHE_MAX = 500;
const cache = new Map<string, { data: PeakData; when: number }>();

export function getCachedPeaks(fileId: string): PeakData | null {
  const hit = cache.get(fileId);
  if (!hit) return null;
  // Move to back (LRU)
  cache.delete(fileId);
  cache.set(fileId, hit);
  return hit.data;
}

export function setCachedPeaks(fileId: string, data: PeakData) {
  cache.set(fileId, { data, when: Date.now() });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}
