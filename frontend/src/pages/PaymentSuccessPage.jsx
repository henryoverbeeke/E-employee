import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function PaymentSuccessPage() {
  const { profile, apiCall, fetchProfile, getToken } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(true);

  const tier = searchParams.get('tier');
  const sessionId = searchParams.get('session_id');

  useEffect(() => {
    if (!profile?.orgId || !tier) return;
    if (tier !== 'tier1' && tier !== 'tier2') {
      setError('Invalid tier.');
      setProcessing(false);
      return;
    }

    async function activate() {
      try {
        if (sessionId) {
          // Call the Stripe Lambda to verify session and store subscription info
          await apiCall('/stripe/activate', {
            method: 'POST',
            body: JSON.stringify({ sessionId, tier })
          });
        } else {
          // Fallback: just set the tier directly (no Stripe session)
          await apiCall(`/organizations/${profile.orgId}`, {
            method: 'PUT',
            body: JSON.stringify({ tier })
          });
        }

        // Refresh profile so the new tier is picked up
        const token = await getToken();
        await fetchProfile(token);

        navigate(`/dashboard?upgraded=${tier}`, { replace: true });
      } catch (e) {
        setError(e.message || 'Failed to activate plan');
        setProcessing(false);
      }
    }

    activate();
  }, [profile, tier]);

  return (
    <div className="page" style={{ textAlign: 'center', paddingTop: '4rem' }}>
      {processing ? (
        <>
          <div className="spinner" />
          <p style={{ color: 'var(--gray-600)', marginTop: '1rem' }}>Activating your plan...</p>
        </>
      ) : error ? (
        <div className="alert alert-error" style={{ maxWidth: 400, margin: '0 auto' }}>{error}</div>
      ) : null}
    </div>
  );
}
