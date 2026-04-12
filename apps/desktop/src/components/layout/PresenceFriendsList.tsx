import { useState, useEffect } from 'react';
import { motion, Reorder } from 'framer-motion';
import Avatar from '../common/Avatar';
import { type OnlineUser } from '../../lib/socket';

function PresenceFriendsList({ friends, onlineActivity, selectProject, onRemoveFriend }: { friends: any[]; onlineActivity: Map<string, OnlineUser>; selectProject: (id: string) => void; onRemoveFriend?: (id: string) => void }) {
  const sourceFriends = friends;

  const [orderedIds, setOrderedIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('ghost_friend_order');
      if (saved) return JSON.parse(saved);
    } catch {}
    return sourceFriends.map((f: any) => f.id);
  });

  // Sync order when friends list changes
  useEffect(() => {
    const ids = sourceFriends.map((f: any) => f.id);
    setOrderedIds(prev => {
      const existing = prev.filter(id => ids.includes(id));
      const newIds = ids.filter(id => !prev.includes(id));
      return [...existing, ...newIds];
    });
  }, [sourceFriends.length]);

  const orderedFriends = orderedIds
    .map(id => sourceFriends.find((f: any) => f.id === id))
    .filter(Boolean) as any[];

  const handleReorder = (newOrder: string[]) => {
    setOrderedIds(newOrder);
    localStorage.setItem('ghost_friend_order', JSON.stringify(newOrder));
  };

  return (
    <Reorder.Group axis="y" values={orderedIds} onReorder={handleReorder} className="flex flex-col items-center gap-4" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {orderedFriends.map((f) => {
        const activity = onlineActivity.get(f.id);
        const isOnline = !!activity;
        const projectName = activity?.currentProjectName;
        const projectId = activity?.currentProjectId;
        return (
          <Reorder.Item key={f.id} value={f.id} className="relative group cursor-grab active:cursor-grabbing" style={{ listStyle: 'none' }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            whileDrag={{ scale: 1.15, zIndex: 50 }}
          >
            <div onClick={() => { if (projectId) selectProject(projectId); }}>
              <div className="rounded-2xl p-[2px] transition-all overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.3)] hover:rounded-xl hover:shadow-[0_0_12px_rgba(124,58,237,0.4),0_2px_8px_rgba(0,0,0,0.3)]"
                style={{ background: 'linear-gradient(180deg, #7C3AED 0%, #581C87 100%)' }}
              >
                <div className="rounded-[14px] overflow-hidden hover:rounded-xl transition-all">
                  <Avatar name={f.displayName} src={f.avatarUrl} size="lg" />
                </div>
              </div>
              {isOnline ? (
                <motion.span
                  className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full"
                  style={{ background: '#23A559', border: '2.5px solid #0A0412' }}
                  animate={{ scale: [1, 1.3, 1], boxShadow: ['0 0 0px rgba(35,165,89,0)', '0 0 8px rgba(35,165,89,0.6)', '0 0 0px rgba(35,165,89,0)'] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                />
              ) : (
                <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full" style={{ background: 'transparent', border: '2.5px solid #0A0412', boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,0.2)' }} />
              )}
            </div>
            {/* Hover tooltip with remove button */}
            <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity whitespace-nowrap z-50">
              <div className="px-3 py-1.5 rounded-lg text-[11px]" style={{ background: 'rgba(20,10,35,0.97)', border: '1px solid rgba(255,255,255,0.15)', backdropFilter: 'blur(12px)' }}>
                <div className="font-semibold text-white">{f.displayName}</div>
                {projectName ? (
                  <div className="text-ghost-green mt-0.5">Working on: {projectName}</div>
                ) : isOnline ? (
                  <div className="text-white/40 mt-0.5">Online</div>
                ) : (
                  <div className="text-white/30 mt-0.5">Offline</div>
                )}
                {onRemoveFriend && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemoveFriend(f.id); }}
                    className="mt-1.5 text-[10px] text-red-400 hover:text-red-300 transition-colors"
                  >
                    Remove Friend
                  </button>
                )}
              </div>
            </div>
          </Reorder.Item>
        );
      })}
    </Reorder.Group>
  );
}

export default PresenceFriendsList;
