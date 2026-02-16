import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useStore } from '../contexts/StoreContext';

const TIER_LEVELS = { none: 0, tier1: 1, tier2: 2, infrastructure: 3 };

export default function Navbar() {
  const { user, profile, signOut } = useAuth();
  const { stores, currentStore, selectStore, isInfrastructure } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  function handleSignOut() {
    signOut();
    navigate('/login');
  }

  if (!user) return null;

  const tier = profile?.tier || 'none';
  const tierLevel = TIER_LEVELS[tier] || 0;
  const isActive = (path) => location.pathname === path ? 'nav-link active' : 'nav-link';
  const isAdmin = profile?.role === 'admin';
  const isManager = profile?.role === 'manager';

  const tierLabel = tier === 'infrastructure' ? 'Infrastructure' : tier === 'tier2' ? 'Tier 2' : tier === 'tier1' ? 'Tier 1' : '';
  const tierColor = tier === 'infrastructure' ? 'var(--purple-500)' : tier === 'tier2' ? 'var(--blue-500)' : 'var(--teal-500)';
  const tierBg = tier === 'infrastructure' ? 'var(--purple-50, #f3e8ff)' : tier === 'tier2' ? 'var(--blue-50)' : 'var(--teal-50)';

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <Link to="/dashboard">E-Employee</Link>
      </div>

      <button className="navbar-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">
        <span className={`hamburger ${menuOpen ? 'open' : ''}`} />
      </button>

      <div className={`navbar-menu ${menuOpen ? 'show' : ''}`}>
        <div className="navbar-links">
          {tierLevel >= 1 && (
            <>
              <Link to="/dashboard" className={isActive('/dashboard')} onClick={() => setMenuOpen(false)}>Dashboard</Link>
              <Link to="/inventory" className={isActive('/inventory')} onClick={() => setMenuOpen(false)}>Inventory</Link>
              {(isAdmin || isManager) && (
                <Link to="/manage-employees" className={isActive('/manage-employees')} onClick={() => setMenuOpen(false)}>Employees</Link>
              )}
            </>
          )}
          {tierLevel >= 2 && (
            <Link to="/chat" className={isActive('/chat')} onClick={() => setMenuOpen(false)}>Chat</Link>
          )}
          {isInfrastructure && isAdmin && (
            <Link to="/stores" className={isActive('/stores')} onClick={() => setMenuOpen(false)}>Stores</Link>
          )}
          {tierLevel === 0 && (
            <Link to="/pricing" className={isActive('/pricing')} onClick={() => setMenuOpen(false)}>Pricing</Link>
          )}
          {tierLevel >= 1 && tierLevel < 3 && (
            <Link to="/pricing" className={isActive('/pricing')} onClick={() => setMenuOpen(false)} style={{ color: 'var(--blue-500)' }}>Upgrade</Link>
          )}

          {isInfrastructure && stores.length > 1 && (
            <select
              className="store-selector"
              value={currentStore?.storeId || ''}
              onChange={(e) => {
                const store = stores.find(s => s.storeId === e.target.value);
                if (store) selectStore(store);
              }}
            >
              {stores.map(s => (
                <option key={s.storeId} value={s.storeId}>{s.storeName}</option>
              ))}
            </select>
          )}
        </div>
        <div className="navbar-user">
          <span className="user-info">
            {profile?.displayName || 'User'}
            {isAdmin && <span className="badge admin-badge">Admin</span>}
            {isManager && <span className="badge" style={{ background: 'var(--amber-50, #fffbeb)', color: 'var(--amber-500)' }}>Manager</span>}
            {tierLevel > 0 && (
              <span className="badge" style={{ background: tierBg, color: tierColor }}>
                {tierLabel}
              </span>
            )}
          </span>
          {isInfrastructure && currentStore && (
            <span style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginRight: '0.5rem' }}>
              {currentStore.storeName}
            </span>
          )}
          <button className="btn btn-outline btn-small" onClick={handleSignOut}>Sign Out</button>
        </div>
      </div>
    </nav>
  );
}
