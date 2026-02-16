import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const TIER_LEVELS = { none: 0, tier1: 1, tier2: 2 };

export default function ProtectedRoute({ children, adminOnly = false, requiredTier = null }) {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return <div className="loading-screen"><div className="spinner" /></div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (adminOnly && profile?.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  if (requiredTier) {
    const userTier = profile?.tier || 'none';
    const userLevel = TIER_LEVELS[userTier] || 0;
    const requiredLevel = TIER_LEVELS[requiredTier] || 0;
    if (userLevel < requiredLevel) {
      return <Navigate to="/pricing" replace />;
    }
  }

  return children;
}
