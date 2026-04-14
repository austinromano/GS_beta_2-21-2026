import { api } from './api';
import { API_BASE } from './constants';

// ── Managed Audio Cache ──
// Single source of truth for decoded audio data.
// Max 50 entries with oldest-first eviction.

const MAX_CACHE_SIZE = 50;
const insertionOrder: string[] = []; // tracks insertion order for eviction

export const audioBufferCache = new Map<string, AudioBuffer>();
export const rawDataCache = new Map<string, Float32Array>();
// Pre-computed peaks fetched from the server for fast initial render.
export type ServerPeaks = { peaks: number[]; rms: number[]; duration: number; sampleRate: number; channels: number; bins: number };
export const peaksCache = new Map<string, ServerPeaks>();
const peaksPromises = new Map<string, Promise<ServerPeaks | null>>();
const downloadPromises = new Map<string, Promise<ArrayBuffer>>();

export function getPeaks(projectId: string, fileId: string, bins = 1024): Promise<ServerPeaks | null> {
  const cached = peaksCache.get(fileId);
  if (cached) return Promise.resolve(cached);
  let p = peaksPromises.get(fileId);
  if (!p) {
    p = api.getPeaks(projectId, fileId, bins).then((data) => {
      peaksPromises.delete(fileId);
      if (data) peaksCache.set(fileId, data);
      return data;
    });
    peaksPromises.set(fileId, p);
  }
  return p;
}

function evictIfNeeded() {
  while (insertionOrder.length > MAX_CACHE_SIZE) {
    const oldest = insertionOrder.shift()!;
    audioBufferCache.delete(oldest);
    rawDataCache.delete(oldest);
    downloadPromises.delete(oldest);
  }
}

/** Store a buffer in the cache (used by loopTrackToFill, undo/redo) */
export function cacheBuffer(fileId: string, buffer: AudioBuffer) {
  audioBufferCache.set(fileId, buffer);
  // Invalidate raw data so waveform re-derives from new buffer
  rawDataCache.delete(fileId);
  if (!insertionOrder.includes(fileId)) {
    insertionOrder.push(fileId);
    evictIfNeeded();
  }
}

/** Clear all caches — call on logout or account switch */
export function clearAudioCaches() {
  audioBufferCache.clear();
  rawDataCache.clear();
  downloadPromises.clear();
  insertionOrder.length = 0;
}

export function debugLog(msg: string) {
  fetch(`${API_BASE}/debug`, { method: 'POST', body: msg }).catch(() => {});
}

export function getAudioData(projectId: string, fileId: string): Promise<{ buffer: AudioBuffer; channelData: Float32Array }> {
  if (audioBufferCache.has(fileId)) {
    const buffer = audioBufferCache.get(fileId)!;
    const channelData = rawDataCache.get(fileId) || buffer.getChannelData(0);
    return Promise.resolve({ buffer, channelData });
  }

  let downloadPromise = downloadPromises.get(fileId);
  if (!downloadPromise) {
    downloadPromise = api.downloadFile(projectId, fileId);
    downloadPromises.set(fileId, downloadPromise);
  }

  return downloadPromise.then((buf) => {
    if (audioBufferCache.has(fileId)) {
      const buffer = audioBufferCache.get(fileId)!;
      return { buffer, channelData: rawDataCache.get(fileId) || buffer.getChannelData(0) };
    }
    const ctx = new AudioContext();
    return ctx.decodeAudioData(buf.slice(0)).then((decoded) => {
      ctx.close();
      audioBufferCache.set(fileId, decoded);
      const channelData = decoded.getChannelData(0);
      rawDataCache.set(fileId, channelData);
      downloadPromises.delete(fileId);
      if (!insertionOrder.includes(fileId)) {
        insertionOrder.push(fileId);
        evictIfNeeded();
      }
      return { buffer: decoded, channelData };
    }).catch((err) => {
      ctx.close();
      downloadPromises.delete(fileId);
      throw err;
    });
  }).catch((err) => {
    downloadPromises.delete(fileId);
    throw err;
  });
}

export function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

export function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Measure / Snap helpers ──

export function secondsPerBar(bpm: number, beatsPerBar = 4): number {
  return (60 / bpm) * beatsPerBar;
}

export function snapToBar(seconds: number, bpm: number, direction: 'nearest' | 'floor' | 'ceil' = 'nearest'): number {
  const spb = secondsPerBar(bpm);
  if (direction === 'floor') return Math.floor(seconds / spb) * spb;
  if (direction === 'ceil') return Math.ceil(seconds / spb) * spb;
  return Math.round(seconds / spb) * spb;
}

export function detectBpmFromName(name: string): number {
  const patterns = [
    /[_\-\s](\d{2,3})\s*bpm/i,
    /bpm\s*[_\-\s]*(\d{2,3})/i,
    /[_\-](\d{2,3})[_\-]/,
    /^(\d{2,3})[_\-]/,
  ];
  for (const pat of patterns) {
    const match = name.match(pat);
    if (match) {
      const val = parseInt(match[1]);
      if (val >= 60 && val <= 250) return val;
    }
  }
  return 0;
}
