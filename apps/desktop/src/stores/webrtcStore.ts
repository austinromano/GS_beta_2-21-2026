import { create } from 'zustand';

interface WebrtcState {
  speakingUserIds: Set<string>;
  setSpeaking: (userId: string, speaking: boolean) => void;
  clearAll: () => void;
}

export const useWebrtcStore = create<WebrtcState>((set) => ({
  speakingUserIds: new Set(),
  setSpeaking: (userId, speaking) => set((s) => {
    if (speaking && s.speakingUserIds.has(userId)) return s;
    if (!speaking && !s.speakingUserIds.has(userId)) return s;
    const next = new Set(s.speakingUserIds);
    if (speaking) next.add(userId); else next.delete(userId);
    return { speakingUserIds: next };
  }),
  clearAll: () => set({ speakingUserIds: new Set() }),
}));
