import { useState, useEffect } from 'react';
import { Reorder } from 'framer-motion';
import type { SamplePack } from '@ghost/types';
import { api } from '../../lib/api';
import { useAudioStore } from '../../stores/audioStore';

export type { SamplePack };

function ProjectListSidebar({
  projects,
  allProjects,
  selectedId,
  onSelect,
  onCreate,
  onCreateBeat,
  samplePacks,
  selectedPackId,
  onSelectPack,
  onCreatePack,
  friends,
}: {
  projects: { id: string; name: string }[];
  allProjects: any[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onCreateBeat: () => void;
  samplePacks: SamplePack[];
  selectedPackId: string | null;
  onSelectPack: (id: string) => void;
  onCreatePack: () => void;
  friends: { id: string; displayName: string; avatarUrl: string | null }[];
}) {
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [packsOpen, setPacksOpen] = useState(false);
  const [beatsOpen, setBeatsOpen] = useState(false);
  const [sectionOrder, setSectionOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('ghost_sidebar_order');
      if (saved) return JSON.parse(saved);
    } catch {}
    return ['collabs', 'projects', 'favorites', 'samples'];
  });
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('ghost_favorites') || '[]')); } catch { return new Set(); }
  });
  const toggleFavorite = (id: string) => {
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem('ghost_favorites', JSON.stringify([...next]));
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full">

      <Reorder.Group axis="y" values={sectionOrder} onReorder={(newOrder) => { setSectionOrder(newOrder); localStorage.setItem('ghost_sidebar_order', JSON.stringify(newOrder)); }} className="flex-1 overflow-y-auto min-h-0" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {sectionOrder.map((sectionKey) => {
          if (sectionKey === 'collabs') return null;
          if (sectionKey === 'projects') return (
        <Reorder.Item key="projects" value="projects" style={{ listStyle: 'none' }} className="cursor-grab active:cursor-grabbing" whileDrag={{ scale: 1.02, zIndex: 50, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
        {/* My Beats dropdown */}
        <div>
          <div className="h-9 px-3 mx-2 mt-1.5 w-[calc(100%-16px)] flex items-center justify-between rounded-lg glass-subtle hover:bg-white/[0.08] transition-colors cursor-grab active:cursor-grabbing">
            <button
              onClick={() => setBeatsOpen((v) => !v)}
              className="flex items-center justify-between flex-1"
            >
              <span className="text-[13px] font-bold text-white/80 uppercase tracking-[0.08em]">
                Projects
              </span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className={`text-ghost-text-muted transition-transform ${beatsOpen ? 'rotate-90' : ''}`}>
                <polygon points="2,0 8,5 2,10" />
              </svg>
            </button>
          </div>
          {beatsOpen && (
            <div className="px-2 pb-1.5 space-y-0.5">
              <button onClick={onCreateBeat} className="w-full flex items-center gap-2 px-2 py-1.5 text-[13px] text-purple-400 hover:text-purple-300 hover:bg-white/[0.04] rounded-md transition-colors">
                <span className="text-[15px]">+</span> New Projects
              </button>
              {allProjects.filter((p: any) => p.projectType === 'beat').map((p: any) => (
                <div
                  key={p.id}
                  onClick={() => { onSelect(p.id); }}
                  className={`flex items-center w-full px-2 py-1.5 text-[13px] rounded-md transition-colors cursor-pointer ${
                    selectedId === p.id && !selectedPackId
                      ? 'bg-white/[0.08] text-white font-medium'
                      : 'text-ghost-text-muted font-normal hover:bg-white/[0.04] hover:text-ghost-text-secondary'
                  }`}
                >
                  <span className="flex items-center gap-2 flex-1 min-w-0">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ghost-green shrink-0">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    <span className="truncate">{p.name}</span>
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(p.id); }}
                    className="text-yellow-400 transition-colors hover:text-yellow-300 shrink-0 ml-2"
                    title={favoriteIds.has(p.id) ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={favoriteIds.has(p.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.5">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  </button>
                </div>
              ))}
              {allProjects.filter((p: any) => p.projectType === 'beat').length === 0 && (
                <p className="px-2 py-1.5 text-[13px] text-ghost-text-muted italic">No beats yet</p>
              )}
            </div>
          )}
        </div>
        </Reorder.Item>
          );
          if (sectionKey === 'favorites') return (
        <Reorder.Item key="favorites" value="favorites" style={{ listStyle: 'none' }} className="cursor-grab active:cursor-grabbing" whileDrag={{ scale: 1.02, zIndex: 50, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
        {/* Favorites dropdown */}
        <div>
          <button
            onClick={() => setFavoritesOpen((v) => !v)}
            className="h-9 px-3 mx-2 mt-1.5 w-[calc(100%-16px)] flex items-center justify-between rounded-lg glass-subtle hover:bg-white/[0.08] transition-colors cursor-grab active:cursor-grabbing"
          >
            <span className="flex items-center gap-1.5 flex-1">
              <span className="text-[13px] font-bold text-white/80 uppercase tracking-[0.08em]">
                Favorites
              </span>
            </span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className={`text-ghost-text-muted transition-transform ${favoritesOpen ? 'rotate-90' : ''}`}>
              <polygon points="2,0 8,5 2,10" />
            </svg>
          </button>
          {favoritesOpen && (
            <div className="px-2 pb-1.5 space-y-0.5">
              {allProjects.filter((p: any) => favoriteIds.has(p.id)).map((p: any) => (
                <button
                  key={p.id}
                  onClick={() => onSelect(p.id)}
                  className={`w-full text-left px-2 py-1.5 text-[13px] rounded-md transition-colors ${
                    selectedId === p.id && !selectedPackId
                      ? 'bg-white/[0.08] text-white font-medium'
                      : 'text-ghost-text-muted font-normal hover:bg-white/[0.04] hover:text-ghost-text-secondary'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ghost-green shrink-0">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    {p.name}
                  </span>
                </button>
              ))}
              {samplePacks.filter((sp) => favoriteIds.has(sp.id)).map((sp) => (
                <button
                  key={sp.id}
                  onClick={() => onSelectPack(sp.id)}
                  className={`w-full text-left px-2 py-1.5 text-[13px] rounded-md transition-colors ${
                    selectedPackId === sp.id
                      ? 'bg-white/[0.08] text-white font-medium'
                      : 'text-ghost-text-muted font-normal hover:bg-white/[0.04] hover:text-ghost-text-secondary'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ghost-purple">
                      <path d="M9 18V5l12-2v13" />
                      <circle cx="6" cy="18" r="3" />
                      <circle cx="18" cy="16" r="3" />
                    </svg>
                    {sp.name}
                  </span>
                </button>
              ))}
              {projects.filter((p) => favoriteIds.has(p.id)).length === 0 && samplePacks.filter((sp) => favoriteIds.has(sp.id)).length === 0 && (
                <p className="px-2 py-1.5 text-[13px] text-ghost-text-muted italic">No favorites yet</p>
              )}
            </div>
          )}
        </div>
        </Reorder.Item>
          );
          if (sectionKey === 'samples') return (
        <Reorder.Item key="samples" value="samples" style={{ listStyle: 'none' }} className="cursor-grab active:cursor-grabbing" whileDrag={{ scale: 1.02, zIndex: 50, boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
        {/* Sample Packs dropdown */}
        <div>
          <button
            onClick={() => setPacksOpen((v) => !v)}
            className="h-9 px-3 mx-2 mt-1.5 w-[calc(100%-16px)] flex items-center justify-between rounded-lg glass-subtle hover:bg-white/[0.08] transition-colors cursor-grab active:cursor-grabbing"
          >
            <span className="text-[13px] font-bold text-white/80 uppercase tracking-[0.08em]">
              My Samples
            </span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className={`text-ghost-text-muted transition-transform ${packsOpen ? 'rotate-90' : ''}`}>
              <polygon points="2,0 8,5 2,10" />
            </svg>
          </button>
          {packsOpen && (
            <div className="px-2 pb-1.5 space-y-0.5">
              <button onClick={onCreatePack} className="w-full flex items-center gap-2 px-2 py-1.5 text-[13px] text-purple-400 hover:text-purple-300 hover:bg-white/[0.04] rounded-md transition-colors">
                <span className="text-[15px]">+</span> New Samples
              </button>
              {samplePacks.length === 0 && (
                <p className="text-[11px] text-ghost-text-muted italic px-2 py-1">No packs yet</p>
              )}
              {samplePacks.map((sp) => (
                <div
                  key={sp.id}
                  onClick={() => onSelectPack(sp.id)}
                  className={`group flex items-center w-full px-2 py-1.5 text-[13px] rounded-md transition-colors cursor-pointer ${
                    selectedPackId === sp.id
                      ? 'bg-white/[0.08] text-white font-medium'
                      : 'text-ghost-text-muted font-normal hover:bg-white/[0.04] hover:text-ghost-text-secondary'
                  }`}
                >
                  <span className="flex items-center gap-2 flex-1 min-w-0">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ghost-purple">
                      <path d="M9 18V5l12-2v13" />
                      <circle cx="6" cy="18" r="3" />
                      <circle cx="18" cy="16" r="3" />
                    </svg>
                    <span className="truncate">{sp.name}</span>
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(sp.id); }}
                    className="text-yellow-400 transition-colors hover:text-yellow-300 shrink-0 ml-2"
                    title={favoriteIds.has(sp.id) ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={favoriteIds.has(sp.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.5">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        </Reorder.Item>
          );
          return null;
        })}

        {/* Friends */}
      </Reorder.Group>

      {/* Storage usage */}
      <StorageBar />
    </div>
  );
}

function StorageBar() {
  const loadedTracks = useAudioStore((s) => s.loadedTracks);
  const limit = 2 * 1024 * 1024 * 1024; // 2 GB

  // Calculate usage from loaded audio buffers
  let used = 0;
  loadedTracks.forEach((track) => {
    if (track.buffer) {
      // AudioBuffer size = channels * length * 4 bytes per float32 sample
      used += track.buffer.numberOfChannels * track.buffer.length * 4;
    }
  });

  const usedGB = used / (1024 * 1024 * 1024);
  const limitGB = limit / (1024 * 1024 * 1024);
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const isWarning = pct > 80;
  const isCritical = pct > 95;

  return (
    <div className="shrink-0 px-3 py-3 border-t border-white/[0.06]">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] text-white/50 font-medium">
          {usedGB.toFixed(2)} GB of {limitGB} GB used
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: isCritical
              ? 'linear-gradient(90deg, #ED4245, #FF6B6B)'
              : isWarning
                ? 'linear-gradient(90deg, #F0B232, #ED4245)'
                : 'linear-gradient(90deg, #7C3AED, #00FFC8)',
            boxShadow: isCritical
              ? '0 0 8px rgba(237,66,69,0.4)'
              : '0 0 8px rgba(124,58,237,0.3)',
          }}
        />
      </div>
      {pct > 80 && (
        <p className="text-[9px] text-ghost-warning-amber mt-1">Storage almost full — upgrade for more space</p>
      )}
    </div>
  );
}

export default ProjectListSidebar;
