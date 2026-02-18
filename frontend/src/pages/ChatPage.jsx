import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useStore } from '../contexts/StoreContext';
import { useChat } from '../hooks/useLocalChat';

export default function ChatPage() {
  const { profile } = useAuth();
  const { storeId, currentStore, isInfrastructure } = useStore();
  const [messageText, setMessageText] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const prevStoreRef = useRef(storeId);

  const {
    messages, users, isConnected, connectionError,
    connectionStatus, connect, disconnect, sendMessage
  } = useChat();

  useEffect(() => {
    if (profile?.orgId && connectionStatus === 'idle') {
      connect();
    }
    return () => disconnect();
  }, [profile]);

  // Reconnect when store changes
  useEffect(() => {
    if (prevStoreRef.current !== storeId && storeId) {
      prevStoreRef.current = storeId;
      disconnect();
      setTimeout(() => connect(), 300);
    }
  }, [storeId]);

  // Auto-retry every 20s while booting
  useEffect(() => {
    if (connectionStatus !== 'booting') return;
    const timer = setInterval(() => connect(), 20000);
    return () => clearInterval(timer);
  }, [connectionStatus]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSend(e) {
    e.preventDefault();
    if (!messageText.trim()) return;
    sendMessage(messageText.trim());
    setMessageText('');
  }

  function renderConnectionState() {
    if (isConnected) return null;

    switch (connectionStatus) {
      case 'connecting':
        return (
          <div className="scan-status">
            <div className="spinner" />
            <p>Connecting to chat server...</p>
          </div>
        );
      case 'not_configured':
        return (
          <div className="scan-status">
            <div className="alert alert-warning">
              {connectionError || 'Chat server has not been created yet.'}
            </div>
            {profile?.role === 'admin' && (
              <p style={{ marginTop: '0.75rem', fontSize: '0.9rem', color: '#6b7280' }}>
                Go to <a href="/manage-employees" style={{ color: '#2563eb' }}>Manage Employees</a> to create a chat server.
              </p>
            )}
          </div>
        );
      case 'stopped':
        return (
          <div className="scan-status">
            <p style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: '0.5rem' }}>Chat server is off</p>
            <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>
              It may take a few minutes to turn back on.
            </p>
            {profile?.role === 'admin' && (
              <p style={{ marginTop: '0.75rem', fontSize: '0.9rem', color: '#6b7280' }}>
                Go to <a href="/manage-employees" style={{ color: '#2563eb' }}>Manage Employees</a> to start it.
              </p>
            )}
          </div>
        );
      case 'booting':
        return (
          <div className="scan-status">
            <div className="spinner" />
            <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Chat server is starting up...</p>
            <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>
              This may take a few minutes. The page will automatically retry.
            </p>
            <button className="btn btn-small" onClick={connect} style={{ marginTop: '1rem' }}>
              Check Again
            </button>
          </div>
        );
      case 'error':
        return (
          <div className="scan-status">
            {connectionError && <div className="alert alert-error">{connectionError}</div>}
            <button className="btn btn-primary btn-small" onClick={connect} style={{ marginTop: '0.75rem' }}>
              Retry
            </button>
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <div className="page chat-page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h1><span style={{ color: 'var(--blue-500)' }}>Chat</span>{isInfrastructure && currentStore && <span style={{ fontSize: '0.875rem', fontWeight: 400, color: 'var(--gray-500)', marginLeft: '0.75rem' }}>{currentStore.storeName}</span>}</h1>
          {isConnected && (
            <span className="wifi-badge">
              <span className="status-dot connected" /> Connected
            </span>
          )}
        </div>
        {isConnected && (
          <button className="btn btn-small sidebar-toggle-btn" onClick={() => setSidebarOpen(true)}>
            Users ({users.length})
          </button>
        )}
      </div>

      <div className="chat-container">
        {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
        <div className={`chat-sidebar ${sidebarOpen ? 'open' : ''}`}>
          <div className="sidebar-header">
            <h3>Connection</h3>
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              {isConnected && (
                <button className="btn btn-danger btn-small" onClick={disconnect}>Disconnect</button>
              )}
              <button className="btn btn-small sidebar-close" onClick={() => setSidebarOpen(false)}>Close</button>
            </div>
          </div>

          <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
            <span className="status-dot" />
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>

          {isConnected && connectionError && (
            <div className="alert alert-error small">{connectionError}</div>
          )}

          <div className="online-users">
            <h4>Online ({users.length})</h4>
            {users.map(u => (
              <div key={u.email} className="user-item">
                <span className="user-avatar">{u.displayName?.[0]?.toUpperCase() || '?'}</span>
                <span>{u.displayName || u.email}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="chat-main">
          {!isConnected ? (
            <div className="scan-container">
              {renderConnectionState()}
            </div>
          ) : (
            <>
              <div className="messages-container">
                {messages.length === 0 && (
                  <div className="empty-chat">No messages yet. Say hello!</div>
                )}
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`message ${msg.type === 'system' ? 'message-system' : ''} ${msg.fromSelf ? 'message-self' : ''}`}
                  >
                    {msg.type === 'system' ? (
                      <div className="message-system-text">{msg.text}</div>
                    ) : (
                      <>
                        {!msg.fromSelf && <div className="message-sender">{msg.senderName}</div>}
                        <div className="message-bubble">
                          <div className="message-text">{msg.text}</div>
                          <div className="message-time">
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <form className="message-input" onSubmit={handleSend}>
                <input
                  type="text"
                  value={messageText}
                  onChange={e => setMessageText(e.target.value)}
                  placeholder="Type a message..."
                  autoFocus
                />
                <button type="submit" className="btn btn-primary" disabled={!messageText.trim()}>
                  Send
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
