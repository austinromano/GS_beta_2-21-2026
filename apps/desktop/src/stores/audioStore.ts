import { create } from 'zustand';
import { api } from '../lib/api';
import { FFT_SIZE, SMOOTHING_TIME_CONSTANT, PITCH_MIN, PITCH_MAX } from '../lib/constants';
import { audioBufferCache, cacheBuffer, clearAudioCaches } from '../lib/audio';

// ── Arrangement persistence ──

interface ArrangementClipState {
  trackId: string;
  trimStart: number;
  trimEnd: number;
  startOffset: number;
  volume: number;
  muted: boolean;
  soloed: boolean;
  pitch: number;
  parentTrackId?: string; // for duplicates/splits — the server track they were cloned from
  parentFileId?: string;  // fileId to reconstruct buffer
}

interface ArrangementState {
  clips: ArrangementClipState[];
}

function getArrangementKey(projectId: string) {
  return `ghost_arrangement_${projectId}`;
}

function saveArrangement(projectId: string, loadedTracks: Map<string, LoadedTrack>, serverTrackFileIds: Map<string, string>) {
  const clips: ArrangementClipState[] = [];
  loadedTracks.forEach((track, id) => {
    const isChild = id.includes('_split_') || id.includes('_dup_');
    const parentId = isChild ? id.split(/_split_|_dup_/)[0] : undefined;
    clips.push({
      trackId: id,
      trimStart: track.trimStart,
      trimEnd: track.trimEnd,
      startOffset: track.startOffset,
      volume: track.volume,
      muted: track.muted,
      soloed: track.soloed,
      pitch: track.pitch,
      parentTrackId: parentId,
      parentFileId: parentId ? serverTrackFileIds.get(parentId) : undefined,
    });
  });
  try {
    localStorage.setItem(getArrangementKey(projectId), JSON.stringify({ clips }));
  } catch {}
}

function loadArrangement(projectId: string): ArrangementState | null {
  try {
    const raw = localStorage.getItem(getArrangementKey(projectId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

interface LoadedTrack {
  id: string;
  buffer: AudioBuffer;
  source: AudioBufferSourceNode | null;
  gainNode: GainNode | null;
  volume: number;
  muted: boolean;
  soloed: boolean;
  bpm: number;
  pitch: number;
  trimStart: number;   // seconds from buffer start
  trimEnd: number;     // seconds from buffer start (0 = use full length)
  startOffset: number; // seconds from project start (timeline position)
}

interface UndoSnapshot {
  trackId: string;
  buffer: AudioBuffer;
  fileId?: string;
}

interface AudioState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  projectBpm: number;
  canUndo: boolean;
  canRedo: boolean;
  bufferVersion: number;
  loadedTracks: Map<string, LoadedTrack>;
  soloActive: boolean;
  soloPlayingTrackId: string | null;
  soloCurrentTime: number;
  soloDuration: number;
  loadError: string | null;

  loadTrack: (trackId: string, fileId: string, projectId: string, trackBpm?: number) => Promise<void>;
  loadTrackFromBuffer: (trackId: string, buffer: AudioBuffer, trackBpm?: number) => void;
  unloadTrack: (trackId: string) => void;
  setProjectBpm: (bpm: number) => void;
  setTrackBpm: (trackId: string, bpm: number) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  seekTo: (time: number) => void;
  playSoloTrack: (trackId: string) => void;
  stopSoloTrack: () => void;
  setTrackVolume: (trackId: string, volume: number) => void;
  setTrackMuted: (trackId: string, muted: boolean) => void;
  removeTrack: (trackId: string) => void;
  loopTrackToFill: (trackId: string, fileId?: string) => void;
  undo: () => void;
  redo: () => void;
  setTrackSoloed: (trackId: string, soloed: boolean) => void;
  setTrackPitch: (trackId: string, semitones: number) => void;
  setTrackTrim: (trackId: string, trimStart: number, trimEnd: number) => void;
  setTrackOffset: (trackId: string, offset: number) => void;
  duplicateTrack: (trackId: string) => string | null;
  splitTrack: (trackId: string, atTime: number) => string | null;
  saveArrangementState: (projectId: string, serverTrackFileIds: Map<string, string>) => void;
  restoreArrangementState: (projectId: string, serverTrackFileIds: Map<string, string>) => void;
  cleanup: () => void;
}

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let analyserNode: AnalyserNode | null = null;

export function getAnalyser(): AnalyserNode | null {
  return analyserNode;
}
let startedAt = 0;
let pausedAt = 0;
let rafId: number | null = null;
const undoStack: UndoSnapshot[] = [];
const redoStack: UndoSnapshot[] = [];
let soloSource: AudioBufferSourceNode | null = null;
let soloGain: GainNode | null = null;
let soloStartedAt = 0;
let soloRafId: number | null = null;

function getCtx() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    masterGain = audioCtx.createGain();
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = FFT_SIZE;
    analyserNode.smoothingTimeConstant = SMOOTHING_TIME_CONSTANT;
    masterGain.connect(analyserNode);
    analyserNode.connect(audioCtx.destination);
  }
  return audioCtx;
}

function getMaster() {
  getCtx();
  return masterGain!;
}

export const useAudioStore = create<AudioState>((set, get) => {

  function recalcDuration() {
    const { loadedTracks } = get();
    let maxDur = 0;
    loadedTracks.forEach((t) => {
      const trackEnd = t.startOffset + t.buffer.duration;
      if (trackEnd > maxDur) maxDur = trackEnd;
    });
    set({ duration: maxDur });
  }

  function updatePosition() {
    const ctx = audioCtx;
    if (!ctx || !get().isPlaying) return;
    const elapsed = ctx.currentTime - startedAt;
    const dur = get().duration;
    // Auto-loop: restart from beginning when reaching the end
    if (dur > 0 && elapsed >= dur) {
      startAllSources(0);
      return;
    }
    set({ currentTime: elapsed });
    rafId = requestAnimationFrame(updatePosition);
  }

  let loopTimer: ReturnType<typeof setTimeout> | null = null;

  function startAllSources(offset: number) {
    const ctx = getCtx();
    const { loadedTracks } = get();

    // Clear any pending loop restart
    if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }

    loadedTracks.forEach((track) => {
      if (track.source) {
        try { track.source.stop(); } catch {}
      }

      const source = ctx.createBufferSource();
      source.buffer = track.buffer;
      source.playbackRate.value = 1;
      source.loop = false;

      const gain = ctx.createGain();
      gain.gain.value = track.muted ? 0 : track.volume;
      source.connect(gain);
      gain.connect(getMaster());

      const trimStart = track.trimStart;
      const trimEnd = track.trimEnd > 0 ? track.trimEnd : track.buffer.duration;
      const trimDuration = trimEnd - trimStart;
      const trackStartsAt = track.startOffset;

      // How far into the project timeline we are
      const projectTime = offset;

      // Always keep gain node so mute/solo works even after track finishes
      track.source = source;
      track.gainNode = gain;

      if (projectTime >= trackStartsAt) {
        // We're past the track's start — play from the right position
        const elapsed = projectTime - trackStartsAt;
        if (elapsed >= trimDuration) {
          // Track already finished — don't start the source
          return;
        }
        source.start(0, trimStart + elapsed, trimDuration - elapsed);
      } else {
        // Track hasn't started yet — schedule it in the future
        const delay = trackStartsAt - projectTime;
        source.start(ctx.currentTime + delay, trimStart, trimDuration);
      }

    });

    startedAt = ctx.currentTime - offset;
    updateSoloState();
  }

  function stopAllSources() {
    if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
    const { loadedTracks } = get();
    loadedTracks.forEach((track) => {
      if (track.source) {
        try { track.source.stop(); } catch {}
        track.source = null;
        track.gainNode = null;
      }
    });
  }

  function updateSoloState() {
    const { loadedTracks } = get();
    const anySoloed = Array.from(loadedTracks.values()).some((t) => t.soloed);
    set({ soloActive: anySoloed });

    loadedTracks.forEach((track) => {
      if (track.gainNode) {
        if (track.muted) {
          track.gainNode.gain.value = 0;
        } else if (anySoloed) {
          track.gainNode.gain.value = track.soloed ? track.volume : 0;
        } else {
          track.gainNode.gain.value = track.volume;
        }
      }
    });
  }

  function restartIfPlaying() {
    const wasPlaying = get().isPlaying;
    if (wasPlaying) {
      const ctx = getCtx();
      const currentOffset = ctx.currentTime - startedAt;
      stopAllSources();
      if (rafId) cancelAnimationFrame(rafId);
      startAllSources(currentOffset);
      set({ isPlaying: true });
      rafId = requestAnimationFrame(updatePosition);
    }
    recalcDuration();
  }

  return {
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    projectBpm: 0,
    canUndo: false,
    canRedo: false,
    bufferVersion: 0,
    loadedTracks: new Map(),
    soloActive: false,
    soloPlayingTrackId: null,
    soloCurrentTime: 0,
    soloDuration: 0,
    loadError: null,

    loadTrack: async (trackId, fileId, projectId, trackBpm = 0) => {
      if (audioBufferCache.has(fileId)) {
        const cachedBuf = audioBufferCache.get(fileId)!;
        set((s) => {
          const m = new Map(s.loadedTracks);
          const existing = m.get(trackId);
          m.set(trackId, {
            id: trackId, buffer: cachedBuf, source: null, gainNode: null,
            volume: existing?.volume ?? 1, muted: existing?.muted ?? false,
            soloed: existing?.soloed ?? false, bpm: trackBpm || existing?.bpm || 0, pitch: existing?.pitch ?? 0,
            trimStart: existing?.trimStart ?? 0, trimEnd: existing?.trimEnd ?? 0,
            startOffset: existing?.startOffset ?? 0,
          });
          return { loadedTracks: m };
        });
        recalcDuration();
        return;
      }

      try {
        const arrayBuffer = await api.downloadFile(projectId, fileId);
        const tempCtx = new AudioContext();
        const buffer = await tempCtx.decodeAudioData(arrayBuffer);
        await tempCtx.close();
        cacheBuffer(fileId, buffer);

        set((s) => {
          const m = new Map(s.loadedTracks);
          m.set(trackId, {
            id: trackId, buffer, source: null, gainNode: null,
            volume: 1, muted: false, soloed: false, bpm: trackBpm, pitch: 0,
            trimStart: 0, trimEnd: 0, startOffset: 0,
          });
          return { loadedTracks: m };
        });
        recalcDuration();
      } catch (err: any) {
        console.error('[AudioStore] Failed to load track:', trackId, 'fileId:', fileId, err);
        set({ loadError: `Track ${trackId}: ${err?.message || err}` });
      }
    },

    loadTrackFromBuffer: (trackId, buffer, trackBpm = 0) => {
      set((s) => {
        const m = new Map(s.loadedTracks);
        const existing = m.get(trackId);

        m.set(trackId, {
          id: trackId, buffer, source: null, gainNode: null,
          volume: existing?.volume ?? 1, muted: existing?.muted ?? false,
          soloed: existing?.soloed ?? false, bpm: trackBpm || existing?.bpm || 0,
          pitch: existing?.pitch ?? 0,
          trimStart: existing?.trimStart ?? 0,
          trimEnd: existing?.trimEnd ?? 0,
          startOffset: existing?.startOffset ?? 0,
        });
        return { loadedTracks: m };
      });
      recalcDuration();
    },

    setProjectBpm: (bpm) => {
      set({ projectBpm: bpm });
      restartIfPlaying();
    },

    setTrackBpm: (trackId, bpm) => {
      const { loadedTracks } = get();
      const track = loadedTracks.get(trackId);
      if (track) {
        track.bpm = bpm;
        set({ loadedTracks: new Map(loadedTracks) });
        restartIfPlaying();
      }
    },

    unloadTrack: (trackId) => {
      const { loadedTracks } = get();
      const track = loadedTracks.get(trackId);
      if (track?.source) {
        try { track.source.stop(); } catch {}
      }
      loadedTracks.delete(trackId);
      set({ loadedTracks: new Map(loadedTracks) });
      recalcDuration();
    },

    play: () => {
      if (get().isPlaying) return;
      const ctx = getCtx();
      if (ctx.state === 'suspended') ctx.resume();
      pausedAt = 0;
      startAllSources(0);
      set({ isPlaying: true, currentTime: 0 });
      rafId = requestAnimationFrame(updatePosition);
    },

    pause: () => {
      if (!get().isPlaying) return;
      const ctx = getCtx();
      pausedAt = ctx.currentTime - startedAt;
      stopAllSources();
      if (rafId) cancelAnimationFrame(rafId);
      set({ isPlaying: false, currentTime: pausedAt });
    },

    stop: () => {
      stopAllSources();
      if (rafId) cancelAnimationFrame(rafId);
      pausedAt = 0;
      startedAt = 0;
      set({ isPlaying: false, currentTime: 0 });
    },

    seekTo: (time) => {
      const wasPlaying = get().isPlaying;
      stopAllSources();
      if (rafId) cancelAnimationFrame(rafId);
      pausedAt = time;
      set({ currentTime: time });
      if (wasPlaying) {
        startAllSources(time);
        set({ isPlaying: true });
        rafId = requestAnimationFrame(updatePosition);
      }
    },

    setTrackVolume: (trackId, volume) => {
      const { loadedTracks } = get();
      const track = loadedTracks.get(trackId);
      if (track) {
        track.volume = volume;
        if (track.gainNode && !track.muted) {
          track.gainNode.gain.value = volume;
        }
        set({ loadedTracks: new Map(loadedTracks) });
      }
    },

    setTrackMuted: (trackId, muted) => {
      const { loadedTracks } = get();
      const track = loadedTracks.get(trackId);
      if (track) {
        track.muted = muted;
        // Also mute/unmute all child clips (duplicates/splits)
        loadedTracks.forEach((t, id) => {
          if (id !== trackId && (id.startsWith(trackId + '_dup_') || id.startsWith(trackId + '_split_'))) {
            t.muted = muted;
          }
        });
        set({ loadedTracks: new Map(loadedTracks) });
        updateSoloState();
      }
    },

    removeTrack: (trackId) => {
      const { loadedTracks } = get();
      const track = loadedTracks.get(trackId);
      if (track) {
        if (track.source) {
          try { track.source.stop(); } catch {}
        }
        loadedTracks.delete(trackId);
        set({ loadedTracks: new Map(loadedTracks) });
        recalcDuration();
      }
    },

    loopTrackToFill: (trackId, fileId) => {
      const { loadedTracks, duration } = get();
      const track = loadedTracks.get(trackId);
      if (!track || !track.buffer || track.buffer.duration >= duration) return;

      // Save snapshot for undo
      undoStack.push({ trackId, buffer: track.buffer, fileId });
      redoStack.length = 0;
      set({ canUndo: true, canRedo: false });

      const origBuffer = track.buffer;
      const ctx = getCtx();
      // Cap to exactly the max duration so we don't overshoot
      const targetLength = Math.round(duration * origBuffer.sampleRate);
      const newBuffer = ctx.createBuffer(origBuffer.numberOfChannels, targetLength, origBuffer.sampleRate);

      for (let ch = 0; ch < origBuffer.numberOfChannels; ch++) {
        const newData = newBuffer.getChannelData(ch);
        const origData = origBuffer.getChannelData(ch);
        for (let i = 0; i < targetLength; i++) {
          newData[i] = origData[i % origData.length];
        }
      }

      track.buffer = newBuffer;
      set({ loadedTracks: new Map(loadedTracks), bufferVersion: get().bufferVersion + 1 });
      recalcDuration();
    },

    undo: () => {
      if (undoStack.length === 0) return;
      const snapshot = undoStack.pop()!;
      const { loadedTracks } = get();
      const track = loadedTracks.get(snapshot.trackId);
      if (track) {
        // Save current state for redo
        redoStack.push({ trackId: snapshot.trackId, buffer: track.buffer, fileId: snapshot.fileId });
        // Restore old buffer
        track.buffer = snapshot.buffer;
        set({ loadedTracks: new Map(loadedTracks), canUndo: undoStack.length > 0, canRedo: true, bufferVersion: get().bufferVersion + 1 });
        recalcDuration();
      }
    },

    redo: () => {
      if (redoStack.length === 0) return;
      const snapshot = redoStack.pop()!;
      const { loadedTracks } = get();
      const track = loadedTracks.get(snapshot.trackId);
      if (track) {
        // Save current state for undo
        undoStack.push({ trackId: snapshot.trackId, buffer: track.buffer, fileId: snapshot.fileId });
        // Restore redo buffer
        track.buffer = snapshot.buffer;
        set({ loadedTracks: new Map(loadedTracks), canUndo: true, canRedo: redoStack.length > 0, bufferVersion: get().bufferVersion + 1 });
        recalcDuration();
      }
    },

    setTrackSoloed: (trackId, soloed) => {
      const { loadedTracks } = get();
      const track = loadedTracks.get(trackId);
      if (track) {
        track.soloed = soloed;
        set({ loadedTracks: new Map(loadedTracks) });
        updateSoloState();
      }
    },

    setTrackPitch: (trackId, semitones) => {
      const { loadedTracks } = get();
      const track = loadedTracks.get(trackId);
      if (track) {
        track.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, semitones));
        set({ loadedTracks: new Map(loadedTracks) });
        // Restart playback to apply new pitch cleanly
        restartIfPlaying();
      }
    },

    playSoloTrack: (trackId) => {
      if (soloSource) { try { soloSource.stop(); } catch {} soloSource = null; }
      if (soloGain) { soloGain.disconnect(); soloGain = null; }
      if (soloRafId) { cancelAnimationFrame(soloRafId); soloRafId = null; }
      if (get().isPlaying) { get().pause(); }

      const track = get().loadedTracks.get(trackId);
      if (!track) return;

      const ctx = getCtx();
      if (ctx.state === 'suspended') ctx.resume();

      soloSource = ctx.createBufferSource();
      soloSource.buffer = track.buffer;
      soloSource.loop = false;

      soloGain = ctx.createGain();
      soloGain.gain.value = track.volume;
      soloSource.connect(soloGain);
      soloGain.connect(getMaster());

      soloSource.onended = () => {
        if (soloRafId) { cancelAnimationFrame(soloRafId); soloRafId = null; }
        set({ soloPlayingTrackId: null, soloCurrentTime: 0, soloDuration: 0 });
        soloSource = null;
        soloGain?.disconnect();
        soloGain = null;
      };

      soloStartedAt = ctx.currentTime;
      const dur = track.buffer.duration;
      soloSource.start(0);
      set({ soloPlayingTrackId: trackId, soloCurrentTime: 0, soloDuration: dur });

      function updateSoloPos() {
        if (!get().soloPlayingTrackId) return;
        const elapsed = (audioCtx?.currentTime || 0) - soloStartedAt;
        set({ soloCurrentTime: Math.min(elapsed, dur) });
        soloRafId = requestAnimationFrame(updateSoloPos);
      }
      soloRafId = requestAnimationFrame(updateSoloPos);
    },

    stopSoloTrack: () => {
      if (soloSource) { try { soloSource.stop(); } catch {} soloSource = null; }
      if (soloGain) { soloGain.disconnect(); soloGain = null; }
      if (soloRafId) { cancelAnimationFrame(soloRafId); soloRafId = null; }
      set({ soloPlayingTrackId: null, soloCurrentTime: 0, soloDuration: 0 });
    },

    setTrackOffset: (trackId, offset) => {
      const { loadedTracks } = get();
      const track = loadedTracks.get(trackId);
      if (track) {
        track.startOffset = Math.max(0, offset);
        set({ loadedTracks: new Map(loadedTracks) });
        recalcDuration();
        restartIfPlaying();
      }
    },

    setTrackTrim: (trackId, trimStart, trimEnd) => {
      const { loadedTracks } = get();
      const track = loadedTracks.get(trackId);
      if (track) {
        track.trimStart = trimStart;
        track.trimEnd = trimEnd;
        set({ loadedTracks: new Map(loadedTracks) });
        recalcDuration();
        restartIfPlaying();
      }
    },

    duplicateTrack: (trackId) => {
      const { loadedTracks } = get();
      const track = loadedTracks.get(trackId);
      if (!track) return null;

      const buf = track.buffer;
      const ctx = getCtx();

      // Copy the buffer
      const newBuf = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        newBuf.getChannelData(c).set(buf.getChannelData(c));
      }

      // Place right after the original clip
      const clipEnd = track.trimEnd > 0 ? track.trimEnd : buf.duration;
      const clipDuration = clipEnd - track.trimStart;
      const newOffset = track.startOffset + clipDuration;

      const newId = trackId + '_dup_' + Date.now();
      const m = new Map(loadedTracks);
      m.set(newId, {
        id: newId,
        buffer: newBuf,
        source: null,
        gainNode: null,
        volume: track.volume,
        muted: track.muted,
        soloed: track.soloed,
        bpm: track.bpm,
        pitch: track.pitch,
        trimStart: track.trimStart,
        trimEnd: track.trimEnd,
        startOffset: newOffset,
      });

      set({ loadedTracks: m, bufferVersion: get().bufferVersion + 1 });
      recalcDuration();
      restartIfPlaying();
      return newId;
    },

    splitTrack: (trackId, atTime) => {
      const { loadedTracks } = get();
      const track = loadedTracks.get(trackId);
      if (!track) return null;

      const buf = track.buffer;
      // atTime is the project playhead position — use directly as split point in the buffer
      const splitPoint = atTime;
      if (splitPoint <= 0 || splitPoint >= buf.duration) return null;

      const ctx = getCtx();
      const sr = buf.sampleRate;
      const ch = buf.numberOfChannels;

      // First half: 0 → splitPoint
      const len1 = Math.round(splitPoint * sr);
      const buf1 = ctx.createBuffer(ch, len1, sr);
      for (let c = 0; c < ch; c++) {
        const src = buf.getChannelData(c);
        const dst = buf1.getChannelData(c);
        for (let i = 0; i < len1; i++) dst[i] = src[i] || 0;
      }

      // Second half: splitPoint → end
      const len2 = buf.length - len1;
      const buf2 = ctx.createBuffer(ch, len2, sr);
      for (let c = 0; c < ch; c++) {
        const src = buf.getChannelData(c);
        const dst = buf2.getChannelData(c);
        for (let i = 0; i < len2; i++) dst[i] = src[len1 + i] || 0;
      }

      // Update original track with first half
      track.buffer = buf1;
      track.trimStart = 0;
      track.trimEnd = 0;

      // Create new track with second half
      const newId = trackId + '_split_' + Date.now();
      const m = new Map(loadedTracks);
      m.set(newId, {
        id: newId,
        buffer: buf2,
        source: null,
        gainNode: null,
        volume: track.volume,
        muted: track.muted,
        soloed: track.soloed,
        bpm: track.bpm,
        pitch: track.pitch,
        trimStart: 0,
        trimEnd: 0,
        startOffset: track.startOffset + splitPoint,
      });

      set({ loadedTracks: m, bufferVersion: get().bufferVersion + 1 });
      recalcDuration();
      restartIfPlaying();
      return newId;
    },

    saveArrangementState: (projectId, serverTrackFileIds) => {
      saveArrangement(projectId, get().loadedTracks, serverTrackFileIds);
    },

    restoreArrangementState: (projectId, serverTrackFileIds) => {
      const saved = loadArrangement(projectId);
      if (!saved) return;

      const { loadedTracks } = get();
      const m = new Map(loadedTracks);

      for (const clip of saved.clips) {
        const existing = m.get(clip.trackId);
        if (existing) {
          // Restore state for existing tracks
          existing.trimStart = clip.trimStart;
          existing.trimEnd = clip.trimEnd;
          existing.startOffset = clip.startOffset;
          existing.volume = clip.volume;
          existing.muted = clip.muted;
          existing.soloed = clip.soloed;
          existing.pitch = clip.pitch;
        } else if (clip.parentTrackId && clip.parentFileId) {
          // Reconstruct duplicate/split tracks from parent buffer
          const parentTrack = m.get(clip.parentTrackId);
          if (parentTrack) {
            const ctx = getCtx();
            const buf = parentTrack.buffer;
            const newBuf = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
            for (let c = 0; c < buf.numberOfChannels; c++) {
              newBuf.getChannelData(c).set(buf.getChannelData(c));
            }
            m.set(clip.trackId, {
              id: clip.trackId,
              buffer: newBuf,
              source: null,
              gainNode: null,
              volume: clip.volume,
              muted: clip.muted,
              soloed: clip.soloed,
              bpm: parentTrack.bpm,
              pitch: clip.pitch,
              trimStart: clip.trimStart,
              trimEnd: clip.trimEnd,
              startOffset: clip.startOffset,
            });
          }
        }
      }

      set({ loadedTracks: m, bufferVersion: get().bufferVersion + 1 });
      recalcDuration();
    },

    cleanup: () => {
      stopAllSources();
      if (soloSource) { try { soloSource.stop(); } catch {} soloSource = null; }
      if (soloGain) { soloGain.disconnect(); soloGain = null; }
      if (rafId) cancelAnimationFrame(rafId);
      pausedAt = 0;
      startedAt = 0;
      if (soloRafId) { cancelAnimationFrame(soloRafId); soloRafId = null; }
      undoStack.length = 0;
      redoStack.length = 0;
      clearAudioCaches();
      set({ isPlaying: false, currentTime: 0, loadedTracks: new Map(), duration: 0, projectBpm: 0, soloPlayingTrackId: null, soloCurrentTime: 0, soloDuration: 0, canUndo: false, canRedo: false });
    },
  };
});
