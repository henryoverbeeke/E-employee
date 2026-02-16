import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const TIER_LEVELS = { none: 0, tier1: 1, tier2: 2 };

export default function Navbar() {
  const { user, profile, signOut } = useAuth();
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
              {profile?.role === 'admin' && (
                <Link to="/manage-employees" className={isActive('/manage-employees')} onClick={() => setMenuOpen(false)}>Employees</Link>
              )}
            </>
          )}
          {tierLevel >= 2 && (
            <Link to="/chat" className={isActive('/chat')} onClick={() => setMenuOpen(false)}>Chat</Link>
          )}
          {tierLevel === 0 && (
            <Link to="/pricing" className={isActive('/pricing')} onClick={() => setMenuOpen(false)}>Pricing</Link>
          )}
          {tierLevel === 1 && (
            <Link to="/pricing" className={isActive('/pricing')} onClick={() => setMenuOpen(false)} style={{ color: 'var(--blue-500)' }}>Upgrade</Link>
          )}
        </div>
        <div className="navbar-user">
          <span className="user-info">
            {profile?.displayName || 'User'}
            {profile?.role === 'admin' && <span className="badge admin-badge">Admin</span>}
            {tierLevel > 0 && (
              <span className="badge" style={{ background: tierLevel === 2 ? 'var(--blue-50)' : 'var(--teal-50)', color: tierLevel === 2 ? 'var(--blue-500)' : 'var(--teal-500)' }}>
                {tier === 'tier1' ? 'Tier 1' : 'Tier 2'}
              </span>
            )}
          </span>
          <button className="btn btn-outline btn-small" onClick={handleSignOut}>Sign Out</button>
        </div>
      </div>
    </nav>
  );
}
