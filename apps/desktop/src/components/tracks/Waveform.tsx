import { useEffect, useState, useMemo, useRef, useCallback, memo } from 'react';
import { useAudioStore } from '../../stores/audioStore';
import { rawDataCache, audioBufferCache, getAudioData, snapToBar, getPeaks, peaksCache, type ServerPeaks } from '../../lib/audio';

export default memo(function Waveform({
  seed, height = 60, fileId, projectId, showPlayhead = false, trackId, showTrimHandles = false,
}: {
  seed: string; height?: number; fileId?: string | null; projectId?: string; showPlayhead?: boolean; trackId?: string; showTrimHandles?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [rawData, setRawData] = useState<Float32Array | null>(
    fileId ? rawDataCache.get(fileId) || null : null
  );
  const [serverPeaks, setServerPeaks] = useState<ServerPeaks | null>(
    fileId ? peaksCache.get(fileId) || null : null
  );

  const [loadFailed, setLoadFailed] = useState(false);
  const [draggingHandle, setDraggingHandle] = useState<'start' | 'end' | null>(null);

  const trimStart = useAudioStore((s) => trackId ? s.loadedTracks.get(trackId)?.trimStart ?? 0 : 0);
  const trimEnd = useAudioStore((s) => trackId ? s.loadedTracks.get(trackId)?.trimEnd ?? 0 : 0);
  const trackBuffer = useAudioStore((s) => trackId ? s.loadedTracks.get(trackId)?.buffer : undefined);
  const projectBpm = useAudioStore((s) => s.projectBpm);
  const setTrackTrim = useAudioStore((s) => s.setTrackTrim);

  const bufferDuration = trackBuffer?.duration || 0;
  const effectiveTrimEnd = trimEnd > 0 ? trimEnd : bufferDuration;
  const bpm = projectBpm > 0 ? projectBpm : 120;

  // If no fileId but we have a buffer (e.g. duplicated/split track), derive waveform from buffer
  useEffect(() => {
    if (!fileId && trackBuffer) {
      setRawData(trackBuffer.getChannelData(0));
    }
  }, [fileId, trackBuffer]);

  useEffect(() => {
    if (!fileId || !projectId) return;
    let cancelled = false;

    // 1) Render instantly from server-computed peaks (tiny JSON).
    if (!peaksCache.has(fileId)) {
      getPeaks(projectId, fileId).then((p) => {
        if (!cancelled && p) setServerPeaks(p);
      }).catch((err) => { if (import.meta.env.DEV) console.warn('[Waveform] getPeaks failed:', err); });
    }

    // 2) Kick off full decode in background for playback, trim handles, etc.
    if (rawDataCache.has(fileId)) {
      setRawData(rawDataCache.get(fileId)!);
    } else {
      getAudioData(projectId, fileId)
        .then(({ channelData }) => {
          if (!cancelled) setRawData(channelData);
        })
        .catch(() => {
          if (!cancelled) setLoadFailed(true);
        });
    }

    return () => { cancelled = true; };
  }, [fileId, projectId]);

  const fakeData = useMemo(() => {
    if (rawData) return null;
    if (fileId && projectId && !loadFailed) return null;
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
    const len = 44100 * 4;
    const data = new Float32Array(len);
    let env = 0;
    for (let i = 0; i < len; i++) {
      h = ((h * 1103515245 + 12345) & 0x7fffffff);
      const noise = ((h & 0xffff) / 32768) - 1;
      if (i % 512 === 0) {
        h = ((h * 1103515245 + 12345) & 0x7fffffff);
        const target = (h % 100) / 100;
        env += (target - env) * 0.3;
      }
      data[i] = noise * env * 0.9;
    }
    return data;
  }, [seed, rawData, fileId, projectId, loadFailed]);

  const audioData = rawData || fakeData;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    if (!audioData && !serverPeaks) return;

    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10, 4, 18, 0.7)';
    ctx.fillRect(0, 0, w, h);

    const mid = h / 2;

    // Compute both peak and RMS per column. Prefer server-side precomputed
    // peaks when available — orders of magnitude faster than deriving from
    // the raw channel data. Fall back to deriving from audioData if peaks
    // haven't arrived yet (or if the server couldn't produce them, e.g.
    // non-WAV files).
    const peaks = new Float32Array(w);
    const rms = new Float32Array(w);

    if (serverPeaks) {
      const nBins = serverPeaks.bins;
      for (let x = 0; x < w; x++) {
        // Map pixel column to bin range (may cover >=1 bins or <1)
        const bStart = Math.floor((x / w) * nBins);
        const bEnd = Math.max(bStart + 1, Math.floor(((x + 1) / w) * nBins));
        let maxPk = 0;
        let maxRm = 0;
        for (let b = bStart; b < bEnd && b < nBins; b++) {
          if (serverPeaks.peaks[b] > maxPk) maxPk = serverPeaks.peaks[b];
          if (serverPeaks.rms[b] > maxRm) maxRm = serverPeaks.rms[b];
        }
        peaks[x] = maxPk;
        rms[x] = maxRm;
      }
    } else if (audioData) {
    const samplesPerPixel = audioData.length / w;
    for (let x = 0; x < w; x++) {
      let max = 0;
      let sumSq = 0;
      let count = 0;
      const start = Math.floor(x * samplesPerPixel);
      const end = Math.min(Math.floor((x + 1) * samplesPerPixel), audioData.length);
      for (let j = start; j < end; j++) {
        const v = audioData[j];
        const abs = v < 0 ? -v : v;
        if (abs > max) max = abs;
        sumSq += v * v;
        count++;
      }
      peaks[x] = max;
      rms[x] = count > 0 ? Math.sqrt(sumSq / count) : 0;
    }
    }

    const scalePeak = mid * 0.9;
    const scaleRms = mid * 1.7; // amplify RMS — it's always smaller than peak

    // Aurora gradients — horizontal ribbon of indigo → violet → fuchsia → violet → indigo.
    // Symmetric so short and long clips both read as balanced.
    const bodyGrad = ctx.createLinearGradient(0, 0, w, 0);
    bodyGrad.addColorStop(0,    '#6366F1'); // indigo
    bodyGrad.addColorStop(0.28, '#A855F7'); // violet
    bodyGrad.addColorStop(0.5,  '#EC4899'); // pink peak
    bodyGrad.addColorStop(0.72, '#A855F7'); // violet
    bodyGrad.addColorStop(1,    '#6366F1'); // indigo

    const haloGrad = ctx.createLinearGradient(0, 0, w, 0);
    haloGrad.addColorStop(0,    'rgba(99, 102, 241, 0.30)');
    haloGrad.addColorStop(0.28, 'rgba(168, 85, 247, 0.34)');
    haloGrad.addColorStop(0.5,  'rgba(236, 72, 153, 0.34)');
    haloGrad.addColorStop(0.72, 'rgba(168, 85, 247, 0.34)');
    haloGrad.addColorStop(1,    'rgba(99, 102, 241, 0.30)');

    // Peak halo (outer translucent shape)
    ctx.beginPath();
    ctx.moveTo(0, mid - peaks[0] * scalePeak);
    for (let x = 1; x < w; x++) ctx.lineTo(x, mid - peaks[x] * scalePeak);
    for (let x = w - 1; x >= 0; x--) ctx.lineTo(x, mid + peaks[x] * scalePeak);
    ctx.closePath();
    ctx.fillStyle = haloGrad;
    ctx.fill();

    // RMS body (inner solid shape)
    ctx.beginPath();
    ctx.moveTo(0, mid - Math.min(rms[0] * scaleRms, peaks[0] * scalePeak));
    for (let x = 1; x < w; x++) {
      const top = Math.min(rms[x] * scaleRms, peaks[x] * scalePeak);
      ctx.lineTo(x, mid - top);
    }
    for (let x = w - 1; x >= 0; x--) {
      const top = Math.min(rms[x] * scaleRms, peaks[x] * scalePeak);
      ctx.lineTo(x, mid + top);
    }
    ctx.closePath();
    ctx.fillStyle = bodyGrad;
    ctx.fill();

    // Subtle center reference line — match the aurora hue at that column
    const centerGrad = ctx.createLinearGradient(0, 0, w, 0);
    centerGrad.addColorStop(0,   'rgba(99, 102, 241, 0.18)');
    centerGrad.addColorStop(0.5, 'rgba(236, 72, 153, 0.22)');
    centerGrad.addColorStop(1,   'rgba(99, 102, 241, 0.18)');
    ctx.fillStyle = centerGrad;
    ctx.fillRect(0, mid - 0.5, w, 1);
  }, [audioData, serverPeaks]);

  useEffect(() => {
    draw();
    const obs = new ResizeObserver(draw);
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [draw]);

  // Trim handle dragging
  const handleMouseDown = useCallback((handle: 'start' | 'end') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingHandle(handle);
  }, []);

  useEffect(() => {
    if (!draggingHandle || !containerRef.current || !trackId || bufferDuration === 0) return;

    const container = containerRef.current;

    const onMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const rawTime = ratio * bufferDuration;
      const clamped = Math.max(0, Math.min(bufferDuration, rawTime));

      if (draggingHandle === 'start') {
        const maxStart = (trimEnd > 0 ? trimEnd : bufferDuration) - 0.01;
        setTrackTrim(trackId, Math.min(clamped, maxStart), trimEnd);
      } else {
        const minEnd = trimStart + 0.01;
        setTrackTrim(trackId, trimStart, Math.max(clamped, minEnd));
      }
    };

    const onMouseUp = () => {
      // Snap to nearest bar on release
      if (trackId) {
        const snappedStart = snapToBar(useAudioStore.getState().loadedTracks.get(trackId)?.trimStart ?? 0, bpm, 'nearest');
        const rawEnd = useAudioStore.getState().loadedTracks.get(trackId)?.trimEnd ?? 0;
        const snappedEnd = rawEnd > 0 ? snapToBar(rawEnd, bpm, 'nearest') : 0;
        setTrackTrim(trackId, Math.max(0, snappedStart), snappedEnd);
      }
      setDraggingHandle(null);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [draggingHandle, trackId, bufferDuration, bpm, trimStart, trimEnd, setTrackTrim]);

  const currentTime = useAudioStore((s) => s.currentTime);
  const duration = useAudioStore((s) => s.duration);
  const isPlaying = useAudioStore((s) => s.isPlaying);
  const soloPlayingTrackId = useAudioStore((s) => s.soloPlayingTrackId);
  const soloCurrentTime = useAudioStore((s) => s.soloCurrentTime);
  const soloDuration = useAudioStore((s) => s.soloDuration);

  const startOffset = useAudioStore((s) => trackId ? s.loadedTracks.get(trackId)?.startOffset ?? 0 : 0);

  let playheadPct = 0;
  let showLine = false;
  if (showPlayhead && trackId) {
    if (soloPlayingTrackId === trackId && soloDuration > 0) {
      playheadPct = (soloCurrentTime / soloDuration) * 100;
      showLine = playheadPct >= 0 && playheadPct <= 100;
    } else if (isPlaying && !soloPlayingTrackId && bufferDuration > 0) {
      // Only show playhead when currentTime is within this clip's time range
      const clipStart = startOffset;
      const clipEnd = startOffset + bufferDuration;
      if (currentTime >= clipStart && currentTime <= clipEnd) {
        playheadPct = ((currentTime - clipStart) / bufferDuration) * 100;
        showLine = true;
      }
    }
  }

  const trimStartPct = bufferDuration > 0 ? (trimStart / bufferDuration) * 100 : 0;
  const trimEndPct = bufferDuration > 0 ? (effectiveTrimEnd / bufferDuration) * 100 : 100;

  return (
    <div ref={containerRef} className="flex-1 rounded relative" style={{ height, overflow: showTrimHandles ? 'visible' : 'hidden' }}>
      <canvas ref={canvasRef} style={{
        display: 'block',
        clipPath: showTrimHandles && bufferDuration > 0 && (trimStart > 0 || (trimEnd > 0 && trimEnd < bufferDuration))
          ? `inset(0 ${100 - trimEndPct}% 0 ${trimStartPct}%)`
          : undefined,
      }} />
      {showLine && (
        <div
          className="absolute top-0 bottom-0 w-[2px] pointer-events-none"
          style={{ left: `${playheadPct}%`, background: '#00FFC8', boxShadow: '0 0 6px rgba(0,255,200,0.6), 0 0 12px rgba(0,255,200,0.2)' }}
        />
      )}
      {showTrimHandles && bufferDuration > 0 && (
        <>
          {/* Left trim handle — gold tab with left chevron */}
          <div
            className="absolute top-0 bottom-0 cursor-col-resize z-20"
            style={{ left: `calc(${trimStartPct}% - 18px)`, width: 20 }}
            onMouseDown={handleMouseDown('start')}
          >
            <div
              className="absolute right-0 top-[4px] bottom-[4px] flex items-center justify-center transition-shadow"
              style={{
                width: 18,
                background: draggingHandle === 'start'
                  ? 'linear-gradient(180deg, #FFD700 0%, #E6AC00 100%)'
                  : 'linear-gradient(180deg, #F5C518 0%, #D4A017 100%)',
                borderRadius: '6px 0 0 6px',
                boxShadow: draggingHandle === 'start'
                  ? '0 0 12px rgba(245,197,24,0.6), -2px 0 8px rgba(0,0,0,0.4)'
                  : '-2px 0 6px rgba(0,0,0,0.3)',
              }}
            >
              <svg width="10" height="16" viewBox="0 0 10 16" fill="none">
                <path d="M7 3L3 8L7 13" stroke="#1a1a1a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
          {/* Right trim handle — gold tab with right chevron */}
          <div
            className="absolute top-0 bottom-0 cursor-col-resize z-20"
            style={{ left: `calc(${trimEndPct}% - 2px)`, width: 20 }}
            onMouseDown={handleMouseDown('end')}
          >
            <div
              className="absolute left-0 top-[4px] bottom-[4px] flex items-center justify-center transition-shadow"
              style={{
                width: 18,
                background: draggingHandle === 'end'
                  ? 'linear-gradient(180deg, #FFD700 0%, #E6AC00 100%)'
                  : 'linear-gradient(180deg, #F5C518 0%, #D4A017 100%)',
                borderRadius: '0 6px 6px 0',
                boxShadow: draggingHandle === 'end'
                  ? '0 0 12px rgba(245,197,24,0.6), 2px 0 8px rgba(0,0,0,0.4)'
                  : '2px 0 6px rgba(0,0,0,0.3)',
              }}
            >
              <svg width="10" height="16" viewBox="0 0 10 16" fill="none">
                <path d="M3 3L7 8L3 13" stroke="#1a1a1a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        </>
      )}
    </div>
  );
});
