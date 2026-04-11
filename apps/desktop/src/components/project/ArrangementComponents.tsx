import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useAudioStore } from '../../stores/audioStore';
import { api } from '../../lib/api';
import StemRow from '../tracks/StemRow';

/* ── track-type colours ── */
function trackColour(type: string) {
  switch (type) {
    case 'audio': return '#00FFC8';
    case 'midi': return '#7C3AED';
    case 'drum': return '#EC4899';
    case 'loop': return '#F59E0B';
    case 'fullmix': return '#00B4D8';
    default: return '#00FFC8';
  }
}

/* ── Drop zone for uploading audio files ── */
export function ArrangementDropZone({ projectId, onFilesAdded, children }: { projectId: string; onFilesAdded: () => void; children: React.ReactNode }) {
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith('audio/') || f.name.match(/\.(wav|mp3|flac|aiff|ogg|m4a|aac)$/i)
    );
    if (droppedFiles.length === 0) return;
    for (const file of droppedFiles) {
      const { fileId } = await api.uploadFile(projectId, file);
      const trackName = file.name.replace(/\.[^.]+$/, '');
      await api.addTrack(projectId, { name: trackName, type: 'fullmix', fileId, fileName: file.name } as any);
    }
    onFilesAdded();
  };

  return (
    <div
      className={`relative transition-all ${dragOver ? 'ring-2 ring-ghost-green/50 ring-inset' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {children}
      {dragOver && (
        <div className="absolute inset-0 bg-ghost-green/5 pointer-events-none z-30 rounded-xl" />
      )}
    </div>
  );
}

/* ── Simple scrollable container (no bar ruler) ── */
export function ArrangementScrollView({ children }: { children: React.ReactNode; showAll?: boolean }) {
  return (
    <div className="relative">
      {children}
    </div>
  );
}

/* ── No bar ruler needed ── */
export function BarRuler() {
  return null;
}

/* ── No grid overlay needed ── */
export function BarGridOverlay() {
  return null;
}

/* ── No playhead needed ── */
export function ArrangementPlayhead() {
  return null;
}

/* ── Simple track list — stacked waveforms ── */
export function DraggableTrackList({ tracks, selectedProjectId, deleteTrack, updateTrack, trackZoom, fetchProject }: {
  tracks: any[];
  selectedProjectId: string;
  deleteTrack: any;
  updateTrack: any;
  trackZoom: 'full' | 'half';
  fetchProject: any;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const bufferVersion = useAudioStore((s) => s.bufferVersion);

  const handleDragStart = useCallback((e: React.DragEvent, idx: number) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOverIdx(idx);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === dropIdx) {
      setDragIdx(null);
      setOverIdx(null);
      return;
    }
    const reordered = [...tracks];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(dropIdx, 0, moved);
    const trackIds = reordered.map((t: any) => t.id);
    setDragIdx(null);
    setOverIdx(null);
    await api.reorderTracks(selectedProjectId, trackIds);
    fetchProject(selectedProjectId);
  }, [dragIdx, tracks, selectedProjectId, fetchProject]);

  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    setOverIdx(null);
  }, []);

  return (
    <div className="flex flex-col gap-2">
      {tracks.map((track: any, idx: number) => (
        <div
          key={track.id}
          draggable
          onDragStart={(e) => handleDragStart(e, idx)}
          onDragOver={(e) => handleDragOver(e, idx)}
          onDrop={(e) => handleDrop(e, idx)}
          onDragEnd={handleDragEnd}
          className={`transition-transform duration-150 ${
            overIdx === idx && dragIdx !== idx ? 'ring-1 ring-purple-500/60 ring-inset rounded-xl' : ''
          }`}
        >
          <StemRow
            key={`${track.id}-${bufferVersion}`}
            trackId={track.id}
            name={track.name || track.fileName || 'Track'}
            type={track.type || 'audio'}
            fileId={track.fileId}
            projectId={selectedProjectId}
            createdAt={track.createdAt}
            onDelete={() => { useAudioStore.getState().removeTrack(track.id); deleteTrack(selectedProjectId, track.id); }}
            onRename={(newName) => updateTrack(selectedProjectId, track.id, { name: newName })}
            compact={trackZoom === 'half'}
          />
        </div>
      ))}
    </div>
  );
}

/* ── Legacy export kept for backward compat ── */
export function TrackWithWidth({ track, selectedProjectId, deleteTrack, updateTrack, trackZoom, fetchProject }: { track: any; selectedProjectId: string; deleteTrack: any; updateTrack: any; trackZoom: 'full' | 'half'; fetchProject: any }) {
  return (
    <StemRow
      trackId={track.id}
      name={track.name || track.fileName || 'Track'}
      type={track.type || 'audio'}
      fileId={track.fileId}
      projectId={selectedProjectId}
      createdAt={track.createdAt}
      onDelete={() => { useAudioStore.getState().removeTrack(track.id); deleteTrack(selectedProjectId, track.id); }}
      onRename={(newName) => updateTrack(selectedProjectId, track.id, { name: newName })}
      compact={trackZoom === 'half'}
    />
  );
}
