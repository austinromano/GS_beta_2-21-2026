import { useEffect, useRef, useState, useMemo } from 'react';
import { useCommunityStore } from '../../stores/communityStore';
import { useAuthStore } from '../../stores/authStore';
import { api } from '../../lib/api';
import { ROOMS } from './CommunityRooms';
import Avatar from '../common/Avatar';
import DmAudioBubble from '../messages/DmAudioBubble';

const AUDIO_EXT_RE = /\.(wav|mp3|flac|aiff|ogg|m4a|aac)$/i;
function isAudioFile(f: File): boolean {
  return f.type.startsWith('audio/') || AUDIO_EXT_RE.test(f.name);
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return time;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`;
}

export default function CommunityRoomView() {
  const activeRoomId = useCommunityStore((s) => s.activeRoomId);
  const messagesByRoom = useCommunityStore((s) => s.messagesByRoom);
  const membersByRoom = useCommunityStore((s) => s.membersByRoom);
  const send = useCommunityStore((s) => s.send);
  const deleteMessage = useCommunityStore((s) => s.deleteMessage);
  const me = useAuthStore((s) => s.user);

  const room = useMemo(() => ROOMS.find((r) => r.id === activeRoomId), [activeRoomId]);
  const messages = activeRoomId ? messagesByRoom.get(activeRoomId) || [] : [];
  const members = activeRoomId ? membersByRoom.get(activeRoomId) || [] : [];
  const [draft, setDraft] = useState('');
  const [pendingAudio, setPendingAudio] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, activeRoomId]);

  if (!room) return null;

  const handleFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files);
    const audio = list.find(isAudioFile);
    if (!audio) {
      setError('Only audio files are supported (wav, mp3, flac, aiff, ogg, m4a, aac)');
      setTimeout(() => setError(''), 3000);
      return;
    }
    if (audio.size > 50 * 1024 * 1024) {
      setError('File too large (50MB max)');
      setTimeout(() => setError(''), 3000);
      return;
    }
    setPendingAudio(audio);
    setError('');
  };

  const handleSend = async () => {
    if (uploading) return;
    const text = draft.trim();
    if (!text && !pendingAudio) return;

    let audioFileId: string | undefined;
    let audioFileName: string | undefined;
    if (pendingAudio) {
      setUploading(true);
      try {
        const res = await api.uploadCommunityAudio(pendingAudio);
        audioFileId = res.fileId;
        audioFileName = res.fileName;
      } catch (err: any) {
        setError(err?.message || 'Upload failed');
        setTimeout(() => setError(''), 3000);
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    send({ text: text || undefined, audioFileId, audioFileName });
    setDraft('');
    setPendingAudio(null);
  };

  const pickFile = () => fileInputRef.current?.click();
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden rounded-2xl glass glass-glow">
      {/* Main chat area */}
      <div
        className="flex-1 flex flex-col min-w-0 min-h-0 relative"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="flex items-center gap-3 px-5 py-3 border-b border-white/[0.06] shrink-0">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-[20px] shrink-0"
            style={{ background: room.gradient, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15)' }}
          >
            {room.icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold text-white truncate">{room.name}</div>
            <div className="text-[11px] text-white/50 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#22C55E' }} />
              <span><span className="font-semibold text-white/80">{members.length}</span> online</span>
              <span className="text-white/20">·</span>
              <span className="truncate">{room.tagline}</span>
            </div>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-center">
              <div>
                <p className="text-[14px] font-semibold text-white/70 mb-1">Welcome to {room.name}</p>
                <p className="text-[12px] text-white/40">Say hi — {members.length > 0 ? `${members.length} producer${members.length === 1 ? '' : 's'} online right now` : 'be the first to post'}.</p>
              </div>
            </div>
          ) : messages.map((msg, idx) => {
            const isOwn = msg.userId === me?.id;
            const prev = idx > 0 ? messages[idx - 1] : null;
            const sameAsPrev = prev && prev.userId === msg.userId
              && (Date.parse(msg.createdAt) - Date.parse(prev.createdAt)) < 5 * 60 * 1000;
            return (
              <div key={msg.id} className={`group flex items-end gap-2 ${isOwn ? 'justify-end' : 'justify-start'} ${sameAsPrev ? 'mt-0.5' : 'mt-3'}`}>
                {!isOwn && (
                  <div className={`shrink-0 w-8 ${sameAsPrev ? 'invisible' : ''}`}>
                    <Avatar name={msg.displayName} src={msg.avatarUrl} size="sm" userId={msg.userId} />
                  </div>
                )}
                <div className={`flex flex-col max-w-[70%] gap-1 ${isOwn ? 'items-end' : 'items-start'}`}>
                  {!sameAsPrev && !isOwn && (
                    <span className="text-[11px] font-semibold text-white/60 px-2">{msg.displayName}</span>
                  )}
                  {msg.audioFileId && (
                    <div className={`flex items-center gap-1.5 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
                      <DmAudioBubble
                        fileId={msg.audioFileId}
                        fileName={msg.audioFileName || 'audio.wav'}
                        isOwn={isOwn}
                        audioPath="/communities/audio"
                      />
                      {isOwn && !msg.text && (
                        <button
                          onClick={() => deleteMessage(msg.id)}
                          title="Delete message"
                          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-white/40 hover:text-red-400 hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                  {msg.text && (
                    <div className={`flex items-center gap-1.5 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
                      <div
                        className={`px-3.5 py-2 text-[13px] leading-[1.4] break-words rounded-[18px] ${isOwn ? 'text-white rounded-br-md' : 'text-ghost-text-primary rounded-bl-md'}`}
                        style={{ background: isOwn ? '#7C3AED' : 'rgba(255,255,255,0.08)' }}
                      >
                        {msg.text}
                      </div>
                      {isOwn && (
                        <button
                          onClick={() => deleteMessage(msg.id)}
                          title="Delete message"
                          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-white/40 hover:text-red-400 hover:bg-white/10 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                  {!sameAsPrev && (
                    <span className="text-[10px] text-white/30 px-2 mt-0.5">{fmtTime(msg.createdAt)}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {pendingAudio && (
          <div className="mx-4 mb-2 px-3 py-2 rounded-xl flex items-center gap-3 shrink-0" style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold text-white truncate">{pendingAudio.name}</div>
              <div className="text-[11px] text-white/40">{(pendingAudio.size / (1024 * 1024)).toFixed(1)} MB · ready to send</div>
            </div>
            <button onClick={() => setPendingAudio(null)} className="shrink-0 text-white/40 hover:text-white transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        )}

        {error && (
          <div className="mx-4 mb-2 px-3 py-2 rounded-lg text-[12px] text-red-300 shrink-0" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
            {error}
          </div>
        )}

        <div className="px-4 pb-4 pt-2 shrink-0">
          <div className="flex items-center bg-white/[0.04] rounded-full border border-white/[0.08] pr-1">
            <button
              onClick={pickFile}
              title="Attach audio"
              className="shrink-0 w-10 h-10 flex items-center justify-center text-white/50 hover:text-ghost-green transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.wav,.mp3,.flac,.aiff,.ogg,.m4a,.aac"
              className="hidden"
              onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
            />
            <input
              className="flex-1 min-w-0 bg-transparent text-[14px] text-ghost-text-primary placeholder:text-ghost-text-muted px-2 py-2.5 outline-none"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
              placeholder={pendingAudio ? 'Add a caption (optional)…' : `Message #${room.name.toLowerCase().replace(/\s+/g, '-')}…`}
              maxLength={2000}
            />
            <button
              onClick={handleSend}
              disabled={uploading || (!draft.trim() && !pendingAudio)}
              className="shrink-0 h-9 px-4 rounded-full text-[13px] font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              style={{ background: 'linear-gradient(135deg, #7C3AED 0%, #4C1D95 100%)' }}
            >
              {uploading ? 'Sending…' : 'Send'}
            </button>
          </div>
          <p className="text-[10px] text-white/25 mt-2 text-center">Drag audio files anywhere in this pane to share</p>
        </div>

        {dragOver && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none" style={{ background: 'rgba(10,4,18,0.7)', backdropFilter: 'blur(4px)' }}>
            <div className="px-8 py-6 rounded-2xl border-2 border-dashed border-ghost-green/60 text-center" style={{ background: 'rgba(0,255,200,0.08)' }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#00FFC8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <p className="text-[15px] font-bold text-white">Drop audio to share with the room</p>
              <p className="text-[12px] text-white/50 mt-0.5">wav, mp3, flac, aiff, ogg, m4a, aac</p>
            </div>
          </div>
        )}
      </div>

      {/* Online members pane */}
      <div className="w-[220px] shrink-0 flex flex-col border-l border-white/[0.06] min-h-0">
        <div className="px-4 pt-4 pb-2">
          <h3 className="text-[12px] font-bold text-white/55 uppercase tracking-wider">Online · {members.length}</h3>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 px-2 pb-3 space-y-0.5">
          {members.length === 0 ? (
            <p className="px-3 py-4 text-[12px] text-white/30 italic text-center">Nobody else is here yet.</p>
          ) : members.map((m) => (
            <div key={m.userId} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors">
              <div className="relative shrink-0">
                <Avatar name={m.displayName} src={m.avatarUrl} size="sm" userId={m.userId} />
                <span
                  className="absolute -bottom-0.5 -right-0.5 w-[9px] h-[9px] rounded-full"
                  style={{ background: '#22C55E', boxShadow: '0 0 0 1.5px #0A0412' }}
                />
              </div>
              <span className={`text-[13px] truncate ${m.userId === me?.id ? 'text-white font-semibold' : 'text-white/80'}`}>
                {m.displayName}{m.userId === me?.id ? ' (you)' : ''}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
