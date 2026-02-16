import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function DashboardPage() {
  const { profile, apiCall } = useAuth();
  const [stats, setStats] = useState({ employees: 0, items: 0, alerts: 0 });
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const upgraded = searchParams.get('upgraded');

  const tier = profile?.tier || 'none';
  const tierLevel = { none: 0, tier1: 1, tier2: 2 }[tier] || 0;

  useEffect(() => {
    if (!profile?.orgId) return;
    loadDashboard();
  }, [profile]);

  // Auto-dismiss upgrade banner after 6s
  useEffect(() => {
    if (!upgraded) return;
    const timer = setTimeout(() => {
      searchParams.delete('upgraded');
      setSearchParams(searchParams, { replace: true });
    }, 6000);
    return () => clearTimeout(timer);
  }, [upgraded]);

  async function loadDashboard() {
    try {
      const [empData, invData, alertData] = await Promise.all([
        apiCall(`/organizations/${profile.orgId}/employees`),
        apiCall(`/organizations/${profile.orgId}/inventory`),
        apiCall(`/organizations/${profile.orgId}/inventory/alerts`)
      ]);

      setStats({
        employees: empData.employees?.length || 0,
        items: invData.items?.length || 0,
        alerts: alertData.totalAlerts || 0
      });
      setAlerts(alertData.alerts || []);
    } catch (e) {
      console.error('Dashboard load error:', e);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="page"><div className="spinner" /></div>;
  }

  return (
    <div className="page">
      {upgraded && (
        <div className="alert alert-success" style={{ marginBottom: '1.5rem' }}>
          Your organization has been upgraded to <strong>{upgraded === 'tier2' ? 'Tier 2' : 'Tier 1'}</strong>. All features are now unlocked.
        </div>
      )}

      <div className="page-header">
        <h1><span style={{ color: 'var(--blue-500)' }}>Dashboard</span></h1>
        <p className="subtitle">Welcome back, {profile?.displayName}</p>
      </div>

      <div className="stats-grid">
        <Link to="/manage-employees" className="stat-card stat-card--purple">
          <div className="stat-number">{stats.employees}</div>
          <div className="stat-label">Employees</div>
        </Link>
        <Link to="/inventory" className="stat-card stat-card--teal">
          <div className="stat-number">{stats.items}</div>
          <div className="stat-label">Inventory Items</div>
        </Link>
        <Link to="/inventory" className="stat-card stat-card--amber">
          <div className="stat-number">{stats.alerts}</div>
          <div className="stat-label">Stock Alerts</div>
        </Link>
        {tierLevel >= 2 && (
          <Link to="/chat" className="stat-card stat-card--blue">
            <div className="stat-number" style={{ fontSize: '1.25rem' }}>Chat</div>
            <div className="stat-label">Open Chat</div>
          </Link>
        )}
      </div>

      {alerts.length > 0 && (
        <div className="dashboard-section">
          <h2>Stock Alerts</h2>
          <div className="alert-list">
            {alerts.map(item => (
              <div key={item.itemId} className={`alert-item ${item.alertStatus}`}>
                <span className="alert-item-name">{item.itemName}</span>
                <span className="alert-item-qty">
                  {item.quantity === 0 ? 'OUT OF STOCK' : `${item.quantity} remaining`}
                </span>
                <span className={`alert-badge ${item.alertStatus}`}>
                  {item.alertStatus === 'out_of_stock' ? 'Critical' : 'Low'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
