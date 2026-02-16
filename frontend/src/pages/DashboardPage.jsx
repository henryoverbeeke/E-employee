import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function DashboardPage() {
  const { profile, apiCall } = useAuth();
  const [stats, setStats] = useState({ employees: 0, items: 0, alerts: 0 });
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.orgId) return;
    loadDashboard();
  }, [profile]);

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
      <div className="page-header">
        <h1>Dashboard</h1>
        <p className="subtitle">Welcome back, {profile?.displayName}</p>
      </div>

      <div className="stats-grid">
        <Link to="/manage-employees" className="stat-card">
          <div className="stat-number">{stats.employees}</div>
          <div className="stat-label">Employees</div>
        </Link>
        <Link to="/inventory" className="stat-card">
          <div className="stat-number">{stats.items}</div>
          <div className="stat-label">Inventory Items</div>
        </Link>
        <Link to="/inventory" className="stat-card alert-card">
          <div className="stat-number">{stats.alerts}</div>
          <div className="stat-label">Stock Alerts</div>
        </Link>
        <Link to="/chat" className="stat-card chat-card">
          <div className="stat-icon">💬</div>
          <div className="stat-label">Open Chat</div>
        </Link>
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
