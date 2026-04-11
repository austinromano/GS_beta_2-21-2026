import { useState, useRef, useEffect } from 'react';
import { useAudioStore } from '../../stores/audioStore';
import { useProjectStore } from '../../stores/projectStore';
import { audioBufferCache, cacheBuffer, detectBpmFromName, formatTime } from '../../lib/audio';
import FrequencyBar, { type VizMode } from './FrequencyBar';

export default function TransportBar({ tracks, projectId, projectTempo, onTempoChange, trackZoom, onZoomChange, vizMode }: { tracks?: any[]; projectId?: string; projectTempo?: number; onTempoChange?: (bpm: number) => void; trackZoom?: 'full' | 'half'; onZoomChange?: (zoom: 'full' | 'half') => void; vizMode?: VizMode }) {
  const isPlaying = useAudioStore((s) => s.isPlaying);
  const currentTime = useAudioStore((s) => s.currentTime);
  const duration = useAudioStore((s) => s.duration);
  const loadedTracks = useAudioStore((s) => s.loadedTracks);
  const projectBpm = useAudioStore((s) => s.projectBpm);
  const canUndo = useAudioStore((s) => s.canUndo);
  const canRedo = useAudioStore((s) => s.canRedo);
  const play = useAudioStore((s) => s.play);
  const pause = useAudioStore((s) => s.pause);
  const seekTo = useAudioStore((s) => s.seekTo);
  const loadTrackFromBuffer = useAudioStore((s) => s.loadTrackFromBuffer);
  const setProjectBpm = useAudioStore((s) => s.setProjectBpm);
  const currentProject = useProjectStore((s) => s.currentProject);
  const [loop, setLoop] = useState(false);
  const [metronome, setMetronome] = useState(false);
  const [dragging, setDragging] = useState(false);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (projectTempo && projectTempo > 0) {
      setProjectBpm(projectTempo);
    }
  }, [projectTempo, setProjectBpm]);

  useEffect(() => {
    if (!tracks || !projectId) return;
    const tryLoad = () => {
      for (const track of tracks) {
        if (!track.fileId || loadedRef.current.has(track.id)) continue;
        if (audioBufferCache.has(track.fileId)) {
          loadedRef.current.add(track.id);
          const trackName = track.name || track.fileName || '';
          const detectedBpm = detectBpmFromName(trackName);
          const buffer = audioBufferCache.get(track.fileId)!;
          loadTrackFromBuffer(track.id, buffer, detectedBpm);
          // Auto-set project tempo from first track with detected BPM
          if (detectedBpm > 0 && onTempoChange && (!projectTempo || projectTempo === 120)) {
            onTempoChange(detectedBpm);
          }
        }
      }
    };
    tryLoad();
    const interval = setInterval(tryLoad, 500);
    return () => clearInterval(interval);
  }, [tracks, projectId, loadTrackFromBuffer]);

  useEffect(() => {
    loadedRef.current.clear();
  }, [projectId]);

  // Restore arrangement state once all tracks are loaded
  const restoredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tracks || !projectId || restoredRef.current === projectId) return;
    const allLoaded = tracks.every((t: any) => !t.fileId || loadedRef.current.has(t.id));
    if (!allLoaded) return;
    restoredRef.current = projectId;
    const fileIdMap = new Map<string, string>();
    for (const t of tracks) {
      if (t.fileId) fileIdMap.set(t.id, t.fileId);
    }
    useAudioStore.getState().restoreArrangementState(projectId, fileIdMap);
  }, [tracks, projectId, useAudioStore.getState().loadedTracks.size]);

  // Auto-save arrangement state on changes
  const bufferVersion = useAudioStore((s) => s.bufferVersion);
  const arrangeLoadedTracks = useAudioStore((s) => s.loadedTracks);
  useEffect(() => {
    if (!projectId || !tracks || arrangeLoadedTracks.size === 0) return;
    const timer = setTimeout(() => {
      const fileIdMap = new Map<string, string>();
      for (const t of tracks) {
        if (t.fileId) fileIdMap.set(t.id, t.fileId);
      }
      useAudioStore.getState().saveArrangementState(projectId, fileIdMap);
    }, 500);
    return () => clearTimeout(timer);
  }, [projectId, tracks, bufferVersion, arrangeLoadedTracks]);

  const hasTracksLoaded = loadedTracks.size > 0;

  const handlePlayPause = () => {
    if (isPlaying) pause();
    else play();
  };

  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTo(ratio * duration);
  };

  const handleSeekDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragging || duration <= 0 || !seekBarRef.current) return;
    const rect = seekBarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTo(ratio * duration);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="shrink-0 flex flex-col w-full" style={{ background: 'rgba(10,4,18,0.97)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="h-4 w-full flex items-stretch overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {Array.from({ length: 16 }, (_, bar) => (
          <div key={bar} className="flex-1 flex items-start relative" style={{ borderLeft: '1px solid rgba(255,255,255,0.12)' }}>
            <span className="text-[10px] font-mono text-white/30 ml-1 mt-0.5 select-none">{bar + 1}</span>
            <div className="absolute bottom-0 left-1/4 w-px h-2" style={{ background: 'rgba(255,255,255,0.06)' }} />
            <div className="absolute bottom-0 left-1/2 w-px h-3" style={{ background: 'rgba(255,255,255,0.08)' }} />
            <div className="absolute bottom-0 left-3/4 w-px h-2" style={{ background: 'rgba(255,255,255,0.06)' }} />
          </div>
        ))}
      </div>
      <FrequencyBar
        seekBarRef={seekBarRef}
        progress={progress}
        isPlaying={isPlaying}
        onSeekClick={handleSeekClick}
        onSeekDrag={handleSeekDrag}
        onSeekEnd={() => setDragging(false)}
        vizMode={vizMode}
      >
        <div className="absolute inset-0 flex items-center z-10 pointer-events-none">
          <div className="absolute left-3 flex items-center gap-1 pointer-events-auto" style={{ filter: 'drop-shadow(0 0 3px rgba(0,0,0,0.8))' }}>
            <button onClick={() => {
              const state = useAudioStore.getState();
              if (!state.canUndo) return;
              state.undo();
              state.loadedTracks.forEach((t, id) => {
                const fileId = currentProject?.tracks?.find((tr: any) => tr.id === id)?.fileId;
                if (fileId) { cacheBuffer(fileId, t.buffer); }
              });
            }} className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${canUndo ? 'text-white/60 hover:text-white' : 'text-white/15 cursor-not-allowed'}`} title="Undo">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
            </button>
            <button onClick={() => {
              const state = useAudioStore.getState();
              if (!state.canRedo) return;
              state.redo();
              state.loadedTracks.forEach((t, id) => {
                const fileId = currentProject?.tracks?.find((tr: any) => tr.id === id)?.fileId;
                if (fileId) { cacheBuffer(fileId, t.buffer); }
              });
            }} className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${canRedo ? 'text-white/60 hover:text-white' : 'text-white/15 cursor-not-allowed'}`} title="Redo">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" /></svg>
            </button>
            <span className="text-[9px] font-mono text-white/60 ml-1">{formatTime(currentTime)}</span>
          </div>

          <div className="absolute flex items-center gap-3 pointer-events-auto" style={{ left: '50%', transform: 'translateX(-50%) translateY(-30%)', filter: 'drop-shadow(0 0 3px rgba(0,0,0,0.8))' }}>
            <button onClick={() => seekTo(0)} className="w-7 h-7 flex items-center justify-center rounded-full text-white/70 hover:text-white transition-colors" title="Skip Back">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="6" width="3" height="12" rx="1" /><polygon points="20,6 11,12 20,18" /></svg>
            </button>
            <button onClick={() => seekTo(Math.max(0, currentTime - 5))} className="w-7 h-7 flex items-center justify-center rounded-full text-white/70 hover:text-white transition-colors" title="Rewind">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="11,6 2,12 11,18" /><polygon points="22,6 13,12 22,18" /></svg>
            </button>
            <button onClick={handlePlayPause} className={`w-10 h-10 rounded-full flex items-center justify-center transition-all relative z-[5] text-white`} style={{ background: 'linear-gradient(180deg, #9333EA 0%, #6B21A8 100%)', boxShadow: '0 0 20px rgba(147,51,234,0.5)', isolation: 'isolate' }} title={isPlaying ? 'Pause' : 'Play'}>
              {isPlaying ? (
                <svg width="12" height="12" viewBox="0 0 12 14" fill="white"><rect x="1" y="1" width="3.5" height="12" rx="1" /><rect x="7.5" y="1" width="3.5" height="12" rx="1" /></svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 10 12" fill="white" className="ml-0.5"><polygon points="0,0 10,6 0,12" /></svg>
              )}
            </button>
            <button onClick={() => seekTo(Math.min(duration, currentTime + 5))} className="w-7 h-7 flex items-center justify-center rounded-full text-white/70 hover:text-white transition-colors" title="Fast Forward">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="13,6 22,12 13,18" /><polygon points="2,6 11,12 2,18" /></svg>
            </button>
          </div>

          <div className="absolute right-3 flex items-center gap-1.5 pointer-events-auto" style={{ filter: 'drop-shadow(0 0 3px rgba(0,0,0,0.8))' }}>
            <span className="text-[9px] font-mono text-white/60">{formatTime(currentTime)} / {formatTime(duration)}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/50"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>
          </div>
        </div>
      </FrequencyBar>
    </div>
  );
}
