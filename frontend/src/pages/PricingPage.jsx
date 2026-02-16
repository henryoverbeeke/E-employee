import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function PricingPage() {
  const { profile, apiCall } = useAuth();
  const currentTier = profile?.tier || 'none';
  const [stripeConfig, setStripeConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadConfig() {
      try {
        const config = await apiCall('/stripe/config');
        setStripeConfig(config);
      } catch (e) {
        console.error('Failed to load Stripe config:', e);
      } finally {
        setLoading(false);
      }
    }
    loadConfig();
  }, []);

  function buildStripeUrl(baseUrl) {
    if (!baseUrl || !profile?.orgId) return '#';
    const sep = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${sep}client_reference_id=${profile.orgId}`;
  }

  if (loading) {
    return <div className="page"><div className="spinner" /></div>;
  }

  return (
    <div className="page" style={{ maxWidth: 800 }}>
      <div className="page-header" style={{ textAlign: 'center', display: 'block', marginBottom: '2rem' }}>
        <h1 style={{ justifyContent: 'center' }}>
          <span style={{ color: 'var(--blue-500)' }}>Choose Your Plan</span>
        </h1>
        <p className="subtitle" style={{ marginTop: '0.5rem' }}>
          Select a plan to unlock features for your organization.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
        {/* Tier 1 */}
        <div className="card" style={{ textAlign: 'center', padding: '2rem 1.5rem', position: 'relative' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--teal-500)', borderRadius: '12px 12px 0 0' }} />
          <h3 style={{ justifyContent: 'center', fontSize: '1.125rem' }}>Tier 1</h3>
          <p style={{ color: 'var(--gray-600)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
            Essential tools for your team
          </p>
          <div style={{ marginBottom: '1.5rem' }}>
            <ul style={{ listStyle: 'none', padding: 0, textAlign: 'left' }}>
              <li style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--gray-100)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: 'var(--green-500)', fontWeight: 700 }}>+</span> Inventory Management
              </li>
              <li style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--gray-100)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: 'var(--green-500)', fontWeight: 700 }}>+</span> Employee Management
              </li>
              <li style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--gray-100)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: 'var(--green-500)', fontWeight: 700 }}>+</span> Dashboard Analytics
              </li>
              <li style={{ padding: '0.5rem 0', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--gray-400)' }}>
                <span style={{ fontWeight: 700 }}>-</span> Team Chat
              </li>
            </ul>
          </div>
          {currentTier === 'none' ? (
            <a href={buildStripeUrl(stripeConfig?.tier1CheckoutUrl)} className="btn btn-primary btn-full">
              Subscribe to Tier 1
            </a>
          ) : (
            <span className="badge badge-success" style={{ fontSize: '0.8rem', padding: '0.375rem 1rem' }}>
              {currentTier === 'tier1' ? 'Current Plan' : 'Included'}
            </span>
          )}
        </div>

        {/* Tier 2 */}
        <div className="card" style={{ textAlign: 'center', padding: '2rem 1.5rem', position: 'relative', border: '2px solid var(--blue-200)' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--blue-500)', borderRadius: '10px 10px 0 0' }} />
          <div style={{ position: 'absolute', top: '0.75rem', right: '0.75rem' }}>
            <span className="badge" style={{ background: 'var(--blue-50)', color: 'var(--blue-500)' }}>Recommended</span>
          </div>
          <h3 style={{ justifyContent: 'center', fontSize: '1.125rem' }}>Tier 2</h3>
          <p style={{ color: 'var(--gray-600)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
            Everything your organization needs
          </p>
          <div style={{ marginBottom: '1.5rem' }}>
            <ul style={{ listStyle: 'none', padding: 0, textAlign: 'left' }}>
              <li style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--gray-100)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: 'var(--green-500)', fontWeight: 700 }}>+</span> Inventory Management
              </li>
              <li style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--gray-100)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: 'var(--green-500)', fontWeight: 700 }}>+</span> Employee Management
              </li>
              <li style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--gray-100)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: 'var(--green-500)', fontWeight: 700 }}>+</span> Dashboard Analytics
              </li>
              <li style={{ padding: '0.5rem 0', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: 'var(--green-500)', fontWeight: 700 }}>+</span> <strong>Team Chat</strong>
              </li>
            </ul>
          </div>
          {currentTier === 'tier2' ? (
            <span className="badge badge-success" style={{ fontSize: '0.8rem', padding: '0.375rem 1rem' }}>
              Current Plan
            </span>
          ) : (
            <a href={buildStripeUrl(stripeConfig?.tier2CheckoutUrl)} className="btn btn-primary btn-full">
              {currentTier === 'tier1' ? 'Upgrade to Tier 2' : 'Subscribe to Tier 2'}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
