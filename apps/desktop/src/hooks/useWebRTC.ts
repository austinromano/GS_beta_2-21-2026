import { useEffect, useRef, useState, useCallback } from 'react';
import { getSocket } from '../lib/socket';
import { sendWebRTCOffer, sendWebRTCAnswer, sendICECandidate, sendWebRTCLeave } from '../lib/socket';
import { useWebrtcStore } from '../stores/webrtcStore';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

interface SpeakingMonitor {
  ctx: AudioContext;
  raf: number;
}

export function useWebRTC(projectId: string | null, userId: string | null) {
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const speakingMonitorsRef = useRef<Map<string, SpeakingMonitor>>(new Map());
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const attachSpeakingMonitor = useCallback((remoteUserId: string, stream: MediaStream) => {
    // Tear down any previous monitor for this user.
    const prev = speakingMonitorsRef.current.get(remoteUserId);
    if (prev) {
      cancelAnimationFrame(prev.raf);
      try { prev.ctx.close(); } catch {}
      speakingMonitorsRef.current.delete(remoteUserId);
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return;

    try {
      const ctx = new AudioContext();
      const audioOnly = new MediaStream(audioTracks);
      const source = ctx.createMediaStreamSource(audioOnly);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      let lastSpeaking = false;
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        const speaking = avg > 8;
        if (speaking !== lastSpeaking) {
          useWebrtcStore.getState().setSpeaking(remoteUserId, speaking);
          lastSpeaking = speaking;
        }
        const monitor = speakingMonitorsRef.current.get(remoteUserId);
        if (monitor) monitor.raf = requestAnimationFrame(tick);
      };
      const raf = requestAnimationFrame(tick);
      speakingMonitorsRef.current.set(remoteUserId, { ctx, raf });
    } catch (err) {
      // Speaking detection is best-effort; never block playback.
      if (import.meta.env.DEV) console.warn('[useWebRTC] speaking monitor failed:', err);
    }
  }, []);

  const detachSpeakingMonitor = useCallback((remoteUserId: string) => {
    const monitor = speakingMonitorsRef.current.get(remoteUserId);
    if (monitor) {
      cancelAnimationFrame(monitor.raf);
      try { monitor.ctx.close(); } catch {}
      speakingMonitorsRef.current.delete(remoteUserId);
    }
    useWebrtcStore.getState().setSpeaking(remoteUserId, false);
  }, []);

  // Clean up a single peer
  const closePeer = useCallback((peerId: string) => {
    const pc = peersRef.current.get(peerId);
    if (pc) {
      pc.close();
      peersRef.current.delete(peerId);
    }
    detachSpeakingMonitor(peerId);
    setRemoteStreams((prev) => {
      const next = new Map(prev);
      next.delete(peerId);
      return next;
    });
  }, [detachSpeakingMonitor]);

  // Create a peer connection for a remote user
  const createPeer = useCallback((remoteUserId: string, initiator: boolean) => {
    if (peersRef.current.has(remoteUserId)) {
      closePeer(remoteUserId);
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peersRef.current.set(remoteUserId, pc);

    // Add local tracks to the connection
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        pc.addTrack(track, localStreamRef.current);
      }
    }

    // Handle incoming remote tracks
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      setRemoteStreams((prev) => {
        const next = new Map(prev);
        next.set(remoteUserId, stream);
        return next;
      });
      attachSpeakingMonitor(remoteUserId, stream);
    };

    // Send ICE candidates
    pc.onicecandidate = (e) => {
      if (e.candidate && projectIdRef.current) {
        sendICECandidate(projectIdRef.current, remoteUserId, e.candidate.toJSON());
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        closePeer(remoteUserId);
      }
    };

    return pc;
  }, [closePeer]);

  // Start sharing local stream
  const startStream = useCallback(async (stream: MediaStream) => {
    localStreamRef.current = stream;

    // For each existing peer, add the new tracks
    // But typically we create fresh connections when starting
    // Signal all users in the room by creating offers
    const socket = getSocket();
    if (!socket || !projectIdRef.current) return;

    // Get online users from presence to know who to call
    // We'll initiate connections when we get user-joined or when we start streaming
  }, []);

  // Call a specific user (create offer)
  const callUser = useCallback(async (remoteUserId: string) => {
    const pc = createPeer(remoteUserId, true);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (projectIdRef.current) {
      sendWebRTCOffer(projectIdRef.current, remoteUserId, offer);
    }
  }, [createPeer]);

  // Set local stream and call all existing room members
  const publishStream = useCallback(async (stream: MediaStream, onlineUserIds: string[]) => {
    localStreamRef.current = stream;

    // Call every other user in the room
    for (const uid of onlineUserIds) {
      if (uid !== userId) {
        await callUser(uid);
      }
    }
  }, [callUser, userId]);

  // Replace tracks on existing connections (e.g., camera toggle)
  const replaceStream = useCallback((stream: MediaStream) => {
    localStreamRef.current = stream;
    for (const [, pc] of peersRef.current) {
      const senders = pc.getSenders();
      for (const track of stream.getTracks()) {
        const sender = senders.find((s) => s.track?.kind === track.kind);
        if (sender) {
          sender.replaceTrack(track);
        } else {
          pc.addTrack(track, stream);
        }
      }
    }
  }, []);

  // Stop sharing
  const stopStream = useCallback(() => {
    if (projectIdRef.current) {
      sendWebRTCLeave(projectIdRef.current);
    }
    for (const [peerId] of peersRef.current) {
      closePeer(peerId);
    }
    localStreamRef.current = null;
    setRemoteStreams(new Map());
  }, [closePeer]);

  // Listen for signaling events
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !projectId) return;

    const handleOffer = async ({ fromUserId, offer }: { fromUserId: string; offer: RTCSessionDescriptionInit }) => {
      const pc = createPeer(fromUserId, false);

      // Add local tracks before answering
      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          pc.addTrack(track, localStreamRef.current);
        }
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendWebRTCAnswer(projectId, fromUserId, answer);
    };

    const handleAnswer = async ({ fromUserId, answer }: { fromUserId: string; answer: RTCSessionDescriptionInit }) => {
      const pc = peersRef.current.get(fromUserId);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    };

    const handleIceCandidate = async ({ fromUserId, candidate }: { fromUserId: string; candidate: RTCIceCandidateInit }) => {
      const pc = peersRef.current.get(fromUserId);
      if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    };

    const handleUserLeft = ({ userId: leftUserId }: { userId: string }) => {
      closePeer(leftUserId);
    };

    socket.on('webrtc-offer', handleOffer);
    socket.on('webrtc-answer', handleAnswer);
    socket.on('webrtc-ice-candidate', handleIceCandidate);
    socket.on('webrtc-user-left', handleUserLeft);

    return () => {
      socket.off('webrtc-offer', handleOffer);
      socket.off('webrtc-answer', handleAnswer);
      socket.off('webrtc-ice-candidate', handleIceCandidate);
      socket.off('webrtc-user-left', handleUserLeft);
    };
  }, [projectId, createPeer, closePeer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const [peerId] of peersRef.current) {
        closePeer(peerId);
      }
    };
  }, [closePeer]);

  return {
    remoteStreams,
    publishStream,
    replaceStream,
    stopStream,
    callUser,
  };
}
