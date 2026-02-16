import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useStore } from '../contexts/StoreContext';

const EXTRA_STORE_URL = 'https://buy.stripe.com/test_00w9AVdmO6UGcw91lV4c805';
const FREE_LIMIT = 3;

export default function StoreManagementPage() {
  const { profile, apiCall, fetchProfile, getToken } = useAuth();
  const { stores } = useStore();
  const [storeList, setStoreList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [storeName, setStoreName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [employees, setEmployees] = useState([]);
  const [assigningStore, setAssigningStore] = useState(null);
  const [managerEmail, setManagerEmail] = useState('');

  useEffect(() => {
    if (profile?.orgId) {
      loadStores();
      loadEmployees();
    }
  }, [profile]);

  async function loadStores() {
    try {
      const data = await apiCall(`/organizations/${profile.orgId}/stores`);
      setStoreList(data.stores || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadEmployees() {
    try {
      const data = await apiCall(`/organizations/${profile.orgId}/employees`);
      setEmployees(data.employees || []);
    } catch {}
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!storeName.trim()) return;
    setCreating(true);
    setError('');
    setSuccess('');
    try {
      await apiCall(`/organizations/${profile.orgId}/stores`, {
        method: 'POST',
        body: JSON.stringify({ storeName: storeName.trim() })
      });
      setSuccess(`Store "${storeName.trim()}" created!`);
      setStoreName('');
      await loadStores();
      const token = await getToken();
      await fetchProfile(token);
    } catch (e) {
      if (e.message?.includes('needsExtraStore') || e.message?.includes('Purchase another')) {
        setError(`You've reached the limit. Purchase an extra store add-on ($8/mo) to add more.`);
      } else {
        setError(e.message);
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(storeId, storeName) {
    if (!confirm(`Delete store "${storeName}"? All inventory in this store will remain but be unlinked.`)) return;
    setError('');
    setSuccess('');
    try {
      await apiCall(`/organizations/${profile.orgId}/stores/${storeId}`, { method: 'DELETE' });
      setSuccess(`Store "${storeName}" deleted.`);
      await loadStores();
      const token = await getToken();
      await fetchProfile(token);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleAssignManager(storeId) {
    setError('');
    setSuccess('');
    try {
      await apiCall(`/organizations/${profile.orgId}/stores/${storeId}/manager`, {
        method: 'PUT',
        body: JSON.stringify({ managerEmail: managerEmail.trim() })
      });
      setSuccess(managerEmail.trim() ? `Manager assigned!` : `Manager removed.`);
      setAssigningStore(null);
      setManagerEmail('');
      await loadStores();
      const token = await getToken();
      await fetchProfile(token);
    } catch (e) {
      setError(e.message);
    }
  }

  function buildExtraStoreUrl() {
    if (!profile?.orgId) return EXTRA_STORE_URL;
    return `${EXTRA_STORE_URL}?client_reference_id=${profile.orgId}`;
  }

  if (loading) {
    return <div className="page"><div className="spinner" /></div>;
  }

  const paidExtras = storeList.length > FREE_LIMIT ? storeList.length - FREE_LIMIT : 0;

  return (
    <div className="page">
      <div className="page-header">
        <h1><span style={{ color: 'var(--purple-500)' }}>Store Management</span></h1>
        <p className="subtitle">{storeList.length} store{storeList.length !== 1 ? 's' : ''} ({FREE_LIMIT} free, {paidExtras > 0 ? `${paidExtras} paid` : 'no paid extras'})</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <div className="card">
        <h3>Create Store</h3>
        <form onSubmit={handleCreate} className="inline-form">
          <input
            type="text"
            value={storeName}
            onChange={e => setStoreName(e.target.value)}
            placeholder="Store name (e.g. Downtown Branch)"
            required
            style={{ flex: 1 }}
          />
          <button type="submit" className="btn btn-primary" disabled={creating}>
            {creating ? 'Creating...' : 'Create Store'}
          </button>
        </form>
        {storeList.length >= FREE_LIMIT && (
          <div style={{ marginTop: '0.75rem' }}>
            <p className="form-hint" style={{ marginBottom: '0.5rem' }}>
              You've used all {FREE_LIMIT} free stores. Extra stores cost $8/month each.
            </p>
            <a
              href={buildExtraStoreUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-small"
              style={{ background: 'var(--purple-500)', color: '#fff', border: 'none' }}
            >
              Purchase Extra Store ($8/mo)
            </a>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Your Stores</h3>
        {storeList.length === 0 ? (
          <p className="form-hint">No stores yet. Create one above.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Store Name</th>
                <th>Manager</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {storeList.map(store => (
                <tr key={store.storeId}>
                  <td style={{ fontWeight: 600 }}>{store.storeName}</td>
                  <td>
                    {store.managerEmail ? (
                      <span className="badge" style={{ background: 'var(--amber-50, #fffbeb)', color: 'var(--amber-500)' }}>
                        {store.managerEmail}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--gray-400)', fontSize: '0.8rem' }}>No manager</span>
                    )}
                  </td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--gray-500)' }}>
                    {store.createdAt ? new Date(store.createdAt).toLocaleDateString() : '-'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-small"
                        onClick={() => {
                          setAssigningStore(store.storeId);
                          setManagerEmail(store.managerEmail || '');
                        }}
                      >
                        {store.managerEmail ? 'Change Manager' : 'Assign Manager'}
                      </button>
                      <button
                        className="btn btn-danger btn-small"
                        onClick={() => handleDelete(store.storeId, store.storeName)}
                      >
                        Delete
                      </button>
                    </div>
                    {assigningStore === store.storeId && (
                      <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.375rem' }}>
                        <select
                          value={managerEmail}
                          onChange={e => setManagerEmail(e.target.value)}
                          style={{ flex: 1, padding: '0.375rem', borderRadius: 8, border: '1px solid var(--gray-200)' }}
                        >
                          <option value="">-- No Manager --</option>
                          {employees.filter(emp => emp.role !== 'admin').map(emp => (
                            <option key={emp.email} value={emp.email}>{emp.displayName} ({emp.email})</option>
                          ))}
                        </select>
                        <button className="btn btn-primary btn-small" onClick={() => handleAssignManager(store.storeId)}>
                          Save
                        </button>
                        <button className="btn btn-small" onClick={() => setAssigningStore(null)}>
                          Cancel
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
