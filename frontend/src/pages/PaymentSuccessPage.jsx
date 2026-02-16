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

    const validTiers = ['tier1', 'tier2', 'infrastructure', 'extra_store'];
    if (!validTiers.includes(tier)) {
      setError('Invalid tier.');
      setProcessing(false);
      return;
    }

    async function activate() {
      try {
        if (tier === 'extra_store') {
          // Extra store add-on -- link the subscription via /stripe/add-store
          await apiCall('/stripe/add-store', {
            method: 'POST',
            body: JSON.stringify({ sessionId })
          });

          const token = await getToken();
          await fetchProfile(token);
          navigate('/stores?added=true', { replace: true });
          return;
        }

        if (sessionId) {
          await apiCall('/stripe/activate', {
            method: 'POST',
            body: JSON.stringify({ sessionId, tier })
          });
        } else {
          await apiCall(`/organizations/${profile.orgId}`, {
            method: 'PUT',
            body: JSON.stringify({ tier })
          });
        }

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
          <p style={{ color: 'var(--gray-600)', marginTop: '1rem' }}>
            {tier === 'extra_store' ? 'Linking extra store...' : 'Activating your plan...'}
          </p>
        </>
      ) : error ? (
        <div className="alert alert-error" style={{ maxWidth: 400, margin: '0 auto' }}>{error}</div>
      ) : null}
    </div>
  );
}
