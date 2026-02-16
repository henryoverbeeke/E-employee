import { useState, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

const hasSubtleCrypto = !!(globalThis.crypto && globalThis.crypto.subtle);

export function useChat() {
  const { getToken, profile, apiCall } = useAuth();
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('idle'); // idle | connecting | connected | error | not_configured | booting
  const wsRef = useRef(null);
  const encKeyRef = useRef(null);
  const connectingRef = useRef(false);

  async function deriveKey(orgId, salt) {
    if (!hasSubtleCrypto) {
      encKeyRef.current = 'fallback';
      return 'fallback';
    }
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', encoder.encode(orgId + salt), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: encoder.encode('eemployee-chat'), iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false, ['encrypt', 'decrypt']
    );
  }

  async function encryptMessage(text) {
    const key = encKeyRef.current;
    if (!key) return null;
    const jsonStr = JSON.stringify({ text, senderName: profile?.displayName || profile?.email });

    if (key === 'fallback') {
      return { payload: btoa(unescape(encodeURIComponent(jsonStr))), iv: 'none' };
    }

    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = encoder.encode(jsonStr);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    return {
      payload: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
      iv: btoa(String.fromCharCode(...iv))
    };
  }

  async function decryptMessage(payload, iv) {
    const key = encKeyRef.current;
    if (!key) return null;

    if (key === 'fallback' || iv === 'none') {
      try {
        return JSON.parse(decodeURIComponent(escape(atob(payload))));
      } catch {
        return null;
      }
    }

    try {
      const encData = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
      const ivData = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivData }, key, encData);
      return JSON.parse(new TextDecoder().decode(decrypted));
    } catch {
      return null;
    }
  }

  const connect = useCallback(async () => {
    if (!profile?.orgId) return;
    if (connectingRef.current) return;
    connectingRef.current = true;

    // Close any existing connection first
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnectionError('');
    setConnectionStatus('connecting');

    try {
      const serverInfo = await apiCall(`/organizations/${profile.orgId}/chat-server`);
      const status = serverInfo.chatServerStatus;

      if (!status || status === 'none' || status === 'terminated') {
        setConnectionError('Chat server has not been created yet. Ask your admin to set it up in the Employees page.');
        setConnectionStatus('not_configured');
        return;
      }

      if (status === 'starting' || status === 'booting') {
        setConnectionError('The chat server is still starting up. This usually takes a few minutes. Please try again shortly.');
        setConnectionStatus('booting');
        return;
      }

      if (status === 'stopped') {
        setConnectionError('');
        setConnectionStatus('stopped');
        return;
      }

      if (status === 'failed') {
        setConnectionError('The chat server failed to start. Ask your admin to check the Employees page.');
        setConnectionStatus('error');
        return;
      }

      const org = await apiCall(`/organizations/${profile.orgId}`);

      if (!org.chatServerHost || !org.chatServerPort) {
        setConnectionError('Chat server has not been configured. Ask your admin to set it up in the Employees page.');
        setConnectionStatus('not_configured');
        return;
      }

      const token = await getToken();
      encKeyRef.current = await deriveKey(profile.orgId, org.encryptionSalt);

      // Check once more that we haven't been superseded
      if (!connectingRef.current) return;

      const isSecure = window.location.protocol === 'https:';
      const wsPort = isSecure ? (org.chatServerWssPort || 8766) : org.chatServerPort;
      const wsUrl = `${isSecure ? 'wss' : 'ws'}://${org.chatServerHost}:${wsPort}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'auth', token }));
      };

      ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case 'auth_success':
            setIsConnected(true);
            setConnectionError('');
            setConnectionStatus('connected');
            break;
          case 'auth_error':
            setConnectionError(data.message || 'Authentication failed');
            setConnectionStatus('error');
            ws.close();
            break;
          case 'message': {
            const decrypted = await decryptMessage(data.payload, data.iv);
            if (decrypted) {
              setMessages(prev => [...prev, {
                text: decrypted.text, senderName: decrypted.senderName,
                from: data.from, fromSelf: data.from === profile?.email,
                timestamp: data.timestamp, type: 'message'
              }]);
            }
            break;
          }
          case 'user_joined':
            setUsers(prev => [...prev.filter(u => u.email !== data.email), { email: data.email, displayName: data.displayName }]);
            setMessages(prev => [...prev, { type: 'system', text: `${data.displayName || data.email} joined`, timestamp: new Date().toISOString() }]);
            break;
          case 'user_left':
            setUsers(prev => prev.filter(u => u.email !== data.email));
            setMessages(prev => [...prev, { type: 'system', text: `${data.email} left`, timestamp: new Date().toISOString() }]);
            break;
          case 'user_list':
            setUsers(data.users || []);
            break;
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
      };

      ws.onerror = () => {
        const isSecure = window.location.protocol === 'https:';
        if (isSecure) {
          setConnectionError(`cert_needed:${org.chatServerHost}:${wsPort}`);
        } else {
          setConnectionError('Could not connect to the chat server. It may be offline.');
        }
        setIsConnected(false);
        setConnectionStatus('error');
      };
    } catch (e) {
      setConnectionError(e.message || 'Failed to connect');
      setConnectionStatus('error');
    } finally {
      connectingRef.current = false;
    }
  }, [profile]);

  const disconnect = useCallback(() => {
    connectingRef.current = false;
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    setUsers([]);
    setConnectionStatus('idle');
  }, []);

  const sendMessage = useCallback(async (text) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const encrypted = await encryptMessage(text);
    if (!encrypted) return;
    wsRef.current.send(JSON.stringify({ type: 'message', ...encrypted }));
  }, [profile]);

  return {
    messages, users, isConnected, connectionError,
    connectionStatus, connect, disconnect, sendMessage
  };
}
