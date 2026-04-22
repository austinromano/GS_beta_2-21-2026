import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from '@ghost/protocol';
import { db } from '../db/index.js';
import { communityMessages, users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type SK = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

// Hard-coded allow-list of room ids — must stay in sync with the client's
// CommunityRooms.tsx. Bounce unknown ids so a bad payload can't create rooms.
const KNOWN_ROOMS = new Set(['girl-producers', 'fl-studio-gang', 'ableton-lab', 'hip-hop-cypher']);

// In-memory presence map: roomId -> Set<userId>. Lives as long as the server.
const presence = new Map<string, Map<string, { displayName: string; avatarUrl: string | null }>>();

function buildMembersList(roomId: string) {
  const map = presence.get(roomId);
  if (!map) return [];
  return Array.from(map.entries()).map(([userId, info]) => ({ userId, ...info }));
}

function broadcastPresence(io: IO, roomId: string) {
  io.to(`community:${roomId}`).emit('community:presence', { roomId, members: buildMembersList(roomId) });
}

export function registerCommunityHandlers(io: IO, socket: SK) {
  const joinedRooms = new Set<string>();

  socket.on('community:join', async ({ roomId }) => {
    if (!KNOWN_ROOMS.has(roomId)) return;
    socket.join(`community:${roomId}`);
    joinedRooms.add(roomId);

    if (!presence.has(roomId)) presence.set(roomId, new Map());
    presence.get(roomId)!.set(socket.data.userId, {
      displayName: socket.data.displayName,
      avatarUrl: socket.data.avatarUrl || null,
    });
    broadcastPresence(io, roomId);
  });

  socket.on('community:leave', ({ roomId }) => {
    if (!KNOWN_ROOMS.has(roomId)) return;
    socket.leave(`community:${roomId}`);
    joinedRooms.delete(roomId);
    presence.get(roomId)?.delete(socket.data.userId);
    broadcastPresence(io, roomId);
  });

  socket.on('community:send', async ({ roomId, text, audioFileId, audioFileName }) => {
    if (!KNOWN_ROOMS.has(roomId)) return;
    const trimmed = (text || '').trim();
    if (trimmed.length > 2000) return;
    // Must have something to send: text, audio, or both.
    if (!trimmed && !audioFileId) return;

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await db.insert(communityMessages).values({
      id,
      roomId,
      userId: socket.data.userId,
      text: trimmed,
      audioFileId: audioFileId || null,
      audioFileName: audioFileName || null,
      createdAt,
    }).run();

    const [profile] = await db.select({ displayName: users.displayName, avatarUrl: users.avatarUrl })
      .from(users).where(eq(users.id, socket.data.userId)).limit(1).all();

    io.to(`community:${roomId}`).emit('community:message', {
      id,
      roomId,
      userId: socket.data.userId,
      displayName: profile?.displayName || socket.data.displayName,
      avatarUrl: profile?.avatarUrl ?? socket.data.avatarUrl ?? null,
      text: trimmed,
      audioFileId: audioFileId || null,
      audioFileName: audioFileName || null,
      createdAt,
    });
  });

  socket.on('community:delete', async ({ roomId, messageId }) => {
    if (!KNOWN_ROOMS.has(roomId)) return;
    // Only the author can delete. Check first to avoid leaking ownership.
    const [row] = await db.select({ userId: communityMessages.userId, roomId: communityMessages.roomId })
      .from(communityMessages)
      .where(eq(communityMessages.id, messageId))
      .limit(1).all();
    if (!row) return;
    if (row.userId !== socket.data.userId) return;
    if (row.roomId !== roomId) return;
    await db.delete(communityMessages).where(eq(communityMessages.id, messageId)).run();
    io.to(`community:${roomId}`).emit('community:message-deleted', { roomId, messageId });
  });

  socket.on('disconnect', () => {
    for (const roomId of joinedRooms) {
      presence.get(roomId)?.delete(socket.data.userId);
      broadcastPresence(io, roomId);
    }
    joinedRooms.clear();
  });
}
