import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

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
          <Link to="/dashboard" className={isActive('/dashboard')} onClick={() => setMenuOpen(false)}>Dashboard</Link>
          <Link to="/chat" className={isActive('/chat')} onClick={() => setMenuOpen(false)}>Chat</Link>
          <Link to="/inventory" className={isActive('/inventory')} onClick={() => setMenuOpen(false)}>Inventory</Link>
          {profile?.role === 'admin' && (
            <Link to="/manage-employees" className={isActive('/manage-employees')} onClick={() => setMenuOpen(false)}>Employees</Link>
          )}
        </div>
        <div className="navbar-user">
          <span className="user-info">
            {profile?.displayName || 'User'}
            {profile?.role === 'admin' && <span className="badge admin-badge">Admin</span>}
          </span>
          <button className="btn btn-outline btn-small" onClick={handleSignOut}>Sign Out</button>
        </div>
      </div>
    </nav>
  );
}
