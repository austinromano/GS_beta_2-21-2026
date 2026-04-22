import { create } from 'zustand';
import { api, type CommunityMessage, type CommunityMember } from '../lib/api';
import { getSocket } from '../lib/socket';

interface CommunityState {
  activeRoomId: string | null;
  messagesByRoom: Map<string, CommunityMessage[]>;
  membersByRoom: Map<string, CommunityMember[]>;
  loading: boolean;
  openRoom: (roomId: string) => Promise<void>;
  closeRoom: () => void;
  send: (payload: { text?: string; audioFileId?: string; audioFileName?: string }) => void;
  deleteMessage: (messageId: string) => void;
}

let socketHandlerAttached = false;

function ensureSocketHandlers(set: (partial: Partial<CommunityState> | ((s: CommunityState) => Partial<CommunityState>)) => void, get: () => CommunityState) {
  const socket = getSocket();
  if (!socket || socketHandlerAttached) return;

  socket.on('community:message', (msg) => {
    const room = msg.roomId;
    const map = new Map(get().messagesByRoom);
    const list = map.get(room) || [];
    if (!list.some((m) => m.id === msg.id)) {
      map.set(room, [...list, msg]);
      set({ messagesByRoom: map });
    }
  });

  socket.on('community:presence', ({ roomId, members }) => {
    const map = new Map(get().membersByRoom);
    map.set(roomId, members);
    set({ membersByRoom: map });
  });

  socket.on('community:message-deleted', ({ roomId, messageId }) => {
    const map = new Map(get().messagesByRoom);
    const list = map.get(roomId);
    if (!list) return;
    map.set(roomId, list.filter((m) => m.id !== messageId));
    set({ messagesByRoom: map });
  });

  socketHandlerAttached = true;
}

export const useCommunityStore = create<CommunityState>((set, get) => ({
  activeRoomId: null,
  messagesByRoom: new Map(),
  membersByRoom: new Map(),
  loading: false,

  openRoom: async (roomId) => {
    const prev = get().activeRoomId;
    if (prev === roomId) return;

    // Leave any previous room, then join + fetch history.
    const socket = getSocket();
    if (prev) socket?.emit('community:leave', { roomId: prev });
    ensureSocketHandlers(set, get);
    socket?.emit('community:join', { roomId });

    set({ activeRoomId: roomId, loading: true });
    try {
      const history = await api.getCommunityHistory(roomId);
      const map = new Map(get().messagesByRoom);
      map.set(roomId, history);
      set({ messagesByRoom: map, loading: false });
    } catch (err) {
      console.warn('[community] history fetch failed', err);
      set({ loading: false });
    }
  },

  closeRoom: () => {
    const prev = get().activeRoomId;
    if (!prev) return;
    const socket = getSocket();
    socket?.emit('community:leave', { roomId: prev });
    set({ activeRoomId: null });
  },

  send: (payload) => {
    const roomId = get().activeRoomId;
    if (!roomId) return;
    const socket = getSocket();
    socket?.emit('community:send', {
      roomId,
      text: payload.text,
      audioFileId: payload.audioFileId,
      audioFileName: payload.audioFileName,
    });
  },

  deleteMessage: (messageId) => {
    const roomId = get().activeRoomId;
    if (!roomId) return;
    const socket = getSocket();
    socket?.emit('community:delete', { roomId, messageId });
  },
}));
