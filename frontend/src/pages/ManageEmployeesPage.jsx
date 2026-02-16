import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function ManageEmployeesPage() {
  const { profile, apiCall, fetchProfile, getToken } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [tempPassword, setTempPassword] = useState('');
  const [tempEmail, setTempEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  // Subscription state
  const [subInfo, setSubInfo] = useState(null);
  const [subLoading, setSubLoading] = useState(true);
  const [subAction, setSubAction] = useState('');

  // Chat server state
  const [chatStatus, setChatStatus] = useState('none'); // none | starting | booting | running | stopped | failed | terminated
  const [chatHost, setChatHost] = useState('');
  const [chatPort, setChatPort] = useState(8765);
  const [newPort, setNewPort] = useState('8765');
  const [creatingChat, setCreatingChat] = useState(false);
  const [deletingChat, setDeletingChat] = useState(false);
  const [togglingChat, setTogglingChat] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    if (profile?.orgId) {
      loadEmployees();
      loadChatStatus();
      loadSubscription();
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [profile]);

  async function loadChatStatus() {
    try {
      const data = await apiCall(`/organizations/${profile.orgId}/chat-server`);
      setChatStatus(data.chatServerStatus || 'none');
      setChatHost(data.chatServerHost || '');
      setChatPort(data.chatServerPort || 8765);

      // If booting, poll every 15s until running
      if (data.chatServerStatus === 'booting' || data.chatServerStatus === 'starting') {
        startPolling();
      }
    } catch {
      setChatStatus('none');
    }
  }

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const data = await apiCall(`/organizations/${profile.orgId}/chat-server`);
        setChatStatus(data.chatServerStatus || 'none');
        setChatHost(data.chatServerHost || '');
        setChatPort(data.chatServerPort || 8765);
        if (data.chatServerStatus === 'running' || data.chatServerStatus === 'failed' || data.chatServerStatus === 'terminated') {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {}
    }, 15000);
  }

  async function handleCreateChat() {
    setError('');
    setSuccess('');
    setCreatingChat(true);
    try {
      const port = parseInt(newPort, 10);
      if (isNaN(port) || port < 1024 || port > 65535) {
        setError('Port must be between 1024 and 65535');
        setCreatingChat(false);
        return;
      }
      const result = await apiCall(`/organizations/${profile.orgId}/chat-server`, {
        method: 'POST',
        body: JSON.stringify({ port })
      });
      setChatStatus(result.chatServerStatus || 'booting');
      setChatHost(result.chatServerHost || '');
      setChatPort(result.chatServerPort || port);
      setSuccess('Chat server is being created! It may take a few minutes to boot.');
      startPolling();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingChat(false);
    }
  }

  async function handleToggleChat(action) {
    setError('');
    setSuccess('');
    setTogglingChat(true);
    try {
      const result = await apiCall(`/organizations/${profile.orgId}/chat-server`, {
        method: 'PUT',
        body: JSON.stringify({ action })
      });
      setChatStatus(result.chatServerStatus || (action === 'stop' ? 'stopped' : 'starting'));
      if (action === 'stop') {
        setSuccess('Chat server is stopping.');
      } else {
        setSuccess('Chat server is starting up. This may take a minute.');
        startPolling();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setTogglingChat(false);
    }
  }

  async function handleDeleteChat() {
    if (!confirm('This will permanently terminate the chat server. You will need to create a new one. Continue?')) return;
    setError('');
    setSuccess('');
    setDeletingChat(true);
    try {
      await apiCall(`/organizations/${profile.orgId}/chat-server`, { method: 'DELETE' });
      setChatStatus('terminated');
      setChatHost('');
      setSuccess('Chat server has been terminated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingChat(false);
    }
  }

  async function loadEmployees() {
    try {
      const data = await apiCall(`/organizations/${profile.orgId}/employees`);
      setEmployees(data.employees || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setAdding(true);

    try {
      const result = await apiCall(`/organizations/${profile.orgId}/employees`, {
        method: 'POST',
        body: JSON.stringify({ email, displayName })
      });
      setTempPassword(result.tempPassword);
      setTempEmail(email);
      setSuccess(`Employee ${email} created!`);
      setEmail('');
      setDisplayName('');
      loadEmployees();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(empEmail) {
    if (!confirm(`Remove ${empEmail} from the organization?`)) return;

    try {
      await apiCall(`/organizations/${profile.orgId}/employees/${encodeURIComponent(empEmail)}`, {
        method: 'DELETE'
      });
      loadEmployees();
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadSubscription() {
    try {
      const data = await apiCall('/stripe/subscription');
      setSubInfo(data);
    } catch {
      setSubInfo(null);
    } finally {
      setSubLoading(false);
    }
  }

  async function handleSubAction(action) {
    setSubAction(action);
    setError('');
    setSuccess('');
    try {
      const result = await apiCall(`/stripe/${action}`, { method: 'POST' });
      setSuccess(result.message || 'Done');
      await loadSubscription();
      // Refresh profile to pick up tier changes
      const token = await getToken();
      await fetchProfile(token);
    } catch (e) {
      setError(e.message || `Failed to ${action}`);
    } finally {
      setSubAction('');
    }
  }

  function renderPlanCard() {
    const tier = profile?.tier || 'none';
    const tierLabel = tier === 'tier2' ? 'Tier 2' : tier === 'tier1' ? 'Tier 1' : 'No Plan';

    return (
      <div className="card">
        <h3>Organization Plan</h3>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
          <span style={{
            fontWeight: 600,
            fontSize: '1rem',
            color: tier === 'none' ? 'var(--gray-500)' : 'var(--blue-500)'
          }}>
            {tierLabel}
          </span>
          {tier !== 'none' && (
            <span className="badge badge-success">Active</span>
          )}
        </div>

        {subLoading ? (
          <p className="form-hint">Loading subscription details...</p>
        ) : subInfo && subInfo.status !== 'none' ? (
          <>
            <div style={{ fontSize: '0.875rem', color: 'var(--gray-700)', marginBottom: '0.5rem' }}>
              Status: <strong style={{ textTransform: 'capitalize' }}>{subInfo.status}</strong>
            </div>
            {subInfo.currentPeriodEnd && (
              <div style={{ fontSize: '0.8125rem', color: 'var(--gray-600)', marginBottom: '0.5rem' }}>
                Current period ends: {new Date(subInfo.currentPeriodEnd * 1000).toLocaleDateString()}
              </div>
            )}
            {subInfo.cancelAtPeriodEnd && (
              <div className="alert alert-warning" style={{ marginBottom: '0.75rem' }}>
                This subscription is set to cancel at the end of the current billing period.
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {subInfo.cancelAtPeriodEnd ? (
                <button
                  className="btn btn-primary btn-small"
                  onClick={() => handleSubAction('reactivate')}
                  disabled={!!subAction}
                >
                  {subAction === 'reactivate' ? 'Reactivating...' : 'Keep Subscription'}
                </button>
              ) : (
                <button
                  className="btn btn-small"
                  onClick={() => handleSubAction('cancel')}
                  disabled={!!subAction}
                  style={{ background: 'var(--amber-500)', color: '#fff', border: 'none' }}
                >
                  {subAction === 'cancel' ? 'Cancelling...' : 'Cancel at Period End'}
                </button>
              )}
              <button
                className="btn btn-danger btn-small"
                onClick={() => {
                  if (confirm('Cancel immediately? You will lose access to paid features right away.')) {
                    handleSubAction('cancel-now');
                  }
                }}
                disabled={!!subAction}
              >
                {subAction === 'cancel-now' ? 'Cancelling...' : 'Cancel Immediately'}
              </button>
              {tier === 'tier1' && (
                <Link to="/pricing" className="btn btn-primary btn-small">
                  Upgrade to Tier 2
                </Link>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="form-hint" style={{ marginBottom: '0.75rem' }}>
              {tier === 'none'
                ? 'No active subscription. Subscribe to unlock features.'
                : 'No Stripe subscription linked.'}
            </p>
            <Link to="/pricing" className="btn btn-primary btn-small">
              View Plans
            </Link>
          </>
        )}
      </div>
    );
  }

  function renderChatServerCard() {
    const isActive = chatStatus === 'running';
    const isBooting = chatStatus === 'booting' || chatStatus === 'starting';
    const isStopped = chatStatus === 'stopped';
    const hasServer = isActive || isBooting || isStopped;

    return (
      <div className="card">
        <h3>Chat Server</h3>

        {!hasServer && chatStatus !== 'failed' ? (
          <>
            <p className="form-hint" style={{ marginBottom: '0.75rem' }}>
              Create a dedicated chat server for your organization. All employees will be able to chat in real time.
            </p>
            <div className="inline-form" style={{ marginBottom: '0.75rem' }}>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label>Port</label>
                <input
                  type="number"
                  value={newPort}
                  onChange={e => setNewPort(e.target.value)}
                  placeholder="8765"
                  min="1024"
                  max="65535"
                />
              </div>
              <button
                className="btn btn-primary"
                onClick={handleCreateChat}
                disabled={creatingChat}
                style={{ alignSelf: 'flex-end' }}
              >
                {creatingChat ? 'Creating...' : 'Create Chat Server'}
              </button>
            </div>
          </>
        ) : isBooting ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div className="spinner" style={{ width: 24, height: 24, margin: 0, borderWidth: 2 }} />
            <div>
              <p style={{ color: '#6b7280', marginBottom: '0.25rem' }}>
                <strong>Chat server is starting up...</strong>
              </p>
              <p className="form-hint">
                This may take a few minutes while the server boots and installs dependencies.
                {chatHost && <> Server IP: <code>{chatHost}:{chatPort}</code></>}
              </p>
            </div>
          </div>
        ) : isActive ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
              <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: '0.9rem' }}>Running</span>
              <code style={{ marginLeft: '0.5rem', fontSize: '0.85rem' }}>{chatHost}:{chatPort}</code>
            </div>
            <p className="form-hint" style={{ marginBottom: '0.75rem' }}>
              Your chat server is online. Employees can open the Chat page to connect.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-small"
                onClick={() => handleToggleChat('stop')}
                disabled={togglingChat}
                style={{ background: '#f59e0b', color: '#fff', border: 'none' }}
              >
                {togglingChat ? 'Stopping...' : 'Stop Server'}
              </button>
              <button
                className="btn btn-danger btn-small"
                onClick={handleDeleteChat}
                disabled={deletingChat}
              >
                {deletingChat ? 'Terminating...' : 'Terminate Server'}
              </button>
            </div>
          </>
        ) : isStopped ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#9ca3af', display: 'inline-block' }} />
              <span style={{ color: '#6b7280', fontWeight: 600, fontSize: '0.9rem' }}>Stopped</span>
            </div>
            <p className="form-hint" style={{ marginBottom: '0.75rem' }}>
              Your chat server is stopped. Start it to allow employees to chat.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-primary btn-small"
                onClick={() => handleToggleChat('start')}
                disabled={togglingChat}
              >
                {togglingChat ? 'Starting...' : 'Start Server'}
              </button>
              <button
                className="btn btn-danger btn-small"
                onClick={handleDeleteChat}
                disabled={deletingChat}
              >
                {deletingChat ? 'Terminating...' : 'Terminate Server'}
              </button>
            </div>
          </>
        ) : chatStatus === 'failed' ? (
          <>
            <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>
              Chat server failed to start. You can try creating a new one.
            </div>
            <button className="btn btn-primary" onClick={() => setChatStatus('none')}>
              Try Again
            </button>
          </>
        ) : null}
      </div>
    );
  }

  if (loading) {
    return <div className="page"><div className="spinner" /></div>;
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1><span style={{ color: 'var(--purple-500)' }}>Manage Employees</span></h1>
        <p className="subtitle">{employees.length} member{employees.length !== 1 ? 's' : ''}</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {tempPassword && (
        <div className="card temp-password-card">
          <h3>Temporary Password for {tempEmail}</h3>
          <p className="form-hint">Give this password to the employee. They will be asked to set a new password on their first login.</p>
          <div className="temp-password-display">
            <code>{tempPassword}</code>
            <button
              className="btn btn-small"
              onClick={() => { navigator.clipboard.writeText(tempPassword); }}
            >
              Copy
            </button>
          </div>
          <button className="btn btn-small" onClick={() => { setTempPassword(''); setTempEmail(''); }}>
            Dismiss
          </button>
        </div>
      )}

      {renderPlanCard()}

      {(profile?.tier === 'tier2') && renderChatServerCard()}

      <div className="card">
        <h3>Add Employee</h3>
        <form onSubmit={handleAdd} className="inline-form">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="employee@domain.com"
            required
          />
          <input
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="Display name"
          />
          <button type="submit" className="btn btn-primary" disabled={adding}>
            {adding ? 'Adding...' : 'Add'}
          </button>
        </form>
      </div>

      <div className="card">
        <h3>Employees</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {employees.map(emp => (
              <tr key={emp.email}>
                <td>{emp.displayName}</td>
                <td>{emp.email}</td>
                <td>
                  <span className={`badge ${emp.role === 'admin' ? 'admin-badge' : ''}`}>
                    {emp.role}
                  </span>
                </td>
                <td>
                  {emp.role !== 'admin' && (
                    <button
                      className="btn btn-danger btn-small"
                      onClick={() => handleDelete(emp.email)}
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
