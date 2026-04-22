import { Hono } from 'hono';
import { db } from '../db/index.js';
import { communityMessages, users } from '../db/schema.js';
import { eq, desc, inArray } from 'drizzle-orm';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { isR2Configured, uploadToR2, downloadFromR2 } from '../services/storage.js';

const communityRoutes = new Hono();
communityRoutes.use('*', authMiddleware);

const KNOWN_ROOMS = new Set(['girl-producers', 'fl-studio-gang', 'ableton-lab', 'hip-hop-cypher']);

// GET /communities/:roomId/messages — return the most recent 200 messages
// hydrated with the sender's display name + avatar. Reversed so the client
// can append directly (oldest first).
communityRoutes.get('/:roomId/messages', async (c) => {
  const roomId = c.req.param('roomId');
  if (!KNOWN_ROOMS.has(roomId)) return c.json({ success: true, data: [] });

  const rows = await db.select({
    id: communityMessages.id,
    userId: communityMessages.userId,
    text: communityMessages.text,
    audioFileId: communityMessages.audioFileId,
    audioFileName: communityMessages.audioFileName,
    createdAt: communityMessages.createdAt,
  })
    .from(communityMessages)
    .where(eq(communityMessages.roomId, roomId))
    .orderBy(desc(communityMessages.createdAt))
    .limit(200)
    .all();

  if (rows.length === 0) return c.json({ success: true, data: [] });

  const userIds = [...new Set(rows.map((r) => r.userId))];
  const profiles = await db.select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
    .from(users).where(inArray(users.id, userIds)).all();
  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  const data = rows.reverse().map((r) => {
    const p = profileMap.get(r.userId);
    return {
      id: r.id,
      roomId,
      userId: r.userId,
      displayName: p?.displayName || 'Unknown',
      avatarUrl: p?.avatarUrl || null,
      text: r.text,
      audioFileId: r.audioFileId,
      audioFileName: r.audioFileName,
      createdAt: r.createdAt,
    };
  });

  return c.json({ success: true, data });
});

// POST /communities/upload — upload audio for a community message. Returns
// { fileId, fileName } for the client to include in community:send.
communityRoutes.post('/upload', async (c) => {
  const user = c.get('user') as AuthUser;
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return c.json({ success: false, error: 'No file' }, 400);
  if (file.size > 50 * 1024 * 1024) return c.json({ success: false, error: 'File too large (50MB max)' }, 413);

  const fileId = crypto.randomUUID();
  const buf = Buffer.from(await file.arrayBuffer());

  if (isR2Configured()) {
    const key = `community/${user.id}/${fileId}_${file.name}`;
    await uploadToR2(key, buf, file.type || 'audio/wav');
    return c.json({ success: true, data: { fileId, fileName: file.name } });
  }
  const { mkdir } = await import('node:fs/promises');
  const { resolve, join } = await import('node:path');
  const dir = resolve(import.meta.dirname, '../../uploads/community');
  await mkdir(dir, { recursive: true });
  const fsp = await import('node:fs/promises');
  await fsp.writeFile(join(dir, `${fileId}_${file.name}`), buf);
  return c.json({ success: true, data: { fileId, fileName: file.name } });
});

// GET /communities/audio/:fileId — stream community audio. Any authenticated
// user can listen (community rooms are public across the platform).
communityRoutes.get('/audio/:fileId', async (c) => {
  const fileId = c.req.param('fileId');

  // Must be attached to a real community message before we serve it.
  const [row] = await db.select({ userId: communityMessages.userId, fileName: communityMessages.audioFileName })
    .from(communityMessages)
    .where(eq(communityMessages.audioFileId, fileId))
    .limit(1).all();
  if (!row) return c.json({ success: false, error: 'Not found' }, 404);

  if (isR2Configured()) {
    try {
      const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
      const s3 = new S3Client({
        region: process.env.S3_REGION || 'auto',
        endpoint: process.env.S3_ENDPOINT,
        credentials: { accessKeyId: process.env.S3_ACCESS_KEY || '', secretAccessKey: process.env.S3_SECRET_KEY || '' },
      });
      const list = await s3.send(new ListObjectsV2Command({
        Bucket: process.env.S3_BUCKET || 'ghost-session-files',
        Prefix: `community/${row.userId}/${fileId}`,
        MaxKeys: 1,
      }));
      const key = list.Contents?.[0]?.Key;
      if (!key) return c.json({ success: false, error: 'Not found' }, 404);
      const { stream, contentLength } = await downloadFromR2(key);
      return new Response(stream, {
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Disposition': `inline; filename="${key.split('/').pop()}"`,
          'Content-Length': contentLength.toString(),
        },
      });
    } catch {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
  }

  const { resolve, join } = await import('node:path');
  const dir = resolve(import.meta.dirname, '../../uploads/community');
  const fsp = await import('node:fs/promises');
  const fs = await import('node:fs');
  const allFiles = await fsp.readdir(dir).catch(() => []);
  const match = (allFiles as string[]).find((f: string) => f.startsWith(fileId));
  if (!match) return c.json({ success: false, error: 'Not found' }, 404);
  const filePath = join(dir, match);
  const fileStat = await fsp.stat(filePath);
  const stream = fs.createReadStream(filePath);
  const { Readable } = await import('node:stream');
  c.header('Content-Type', 'audio/wav');
  c.header('Content-Disposition', `inline; filename="${match}"`);
  c.header('Content-Length', fileStat.size.toString());
  return new Response(Readable.toWeb(stream) as ReadableStream, { headers: c.res.headers });
});

export default communityRoutes;
