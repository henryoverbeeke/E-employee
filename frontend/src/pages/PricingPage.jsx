import { useAuth } from '../contexts/AuthContext';

const TIER1_URL = 'https://buy.stripe.com/test_dRm6oJdmO4My3ZD3u34c802';
const TIER2_URL = 'https://buy.stripe.com/test_bJeeVf0A2a6SdAde8H4c803';
const INFRA_URL = 'https://buy.stripe.com/test_14AbJ33Me6UGeEh2pZ4c806';

export default function PricingPage() {
  const { profile } = useAuth();
  const currentTier = profile?.tier || 'none';
  const isAdmin = profile?.role === 'admin';

  function buildStripeUrl(baseUrl) {
    if (!profile?.orgId) return baseUrl;
    const sep = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${sep}client_reference_id=${profile.orgId}`;
  }

  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <div className="page-header" style={{ textAlign: 'center', display: 'block', marginBottom: '2rem' }}>
        <h1 style={{ justifyContent: 'center' }}>
          <span style={{ color: 'var(--blue-500)' }}>Choose Your Plan</span>
        </h1>
        <p className="subtitle" style={{ marginTop: '0.5rem' }}>
          Select a plan to unlock features for your organization.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem' }}>
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
            isAdmin ? (
              <a href={buildStripeUrl(TIER1_URL)} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-full">
                Subscribe to Tier 1
              </a>
            ) : (
              <p style={{ color: 'var(--gray-500)', fontSize: '0.8rem' }}>Ask your admin to upgrade</p>
            )
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
          ) : isAdmin ? (
            <a href={buildStripeUrl(TIER2_URL)} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-full">
              {currentTier === 'tier1' ? 'Upgrade to Tier 2' : 'Subscribe to Tier 2'}
            </a>
          ) : (
            <p style={{ color: 'var(--gray-500)', fontSize: '0.8rem' }}>Ask your admin to upgrade</p>
          )}
        </div>

        {/* Infrastructure */}
        <div className="card" style={{ textAlign: 'center', padding: '2rem 1.5rem', position: 'relative', border: '2px solid var(--purple-200, #e9d5ff)' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--purple-500)', borderRadius: '10px 10px 0 0' }} />
          <div style={{ position: 'absolute', top: '0.75rem', right: '0.75rem' }}>
            <span className="badge" style={{ background: 'var(--purple-50, #f3e8ff)', color: 'var(--purple-500)' }}>Multi-Store</span>
          </div>
          <h3 style={{ justifyContent: 'center', fontSize: '1.125rem' }}>Infrastructure</h3>
          <p style={{ color: 'var(--gray-600)', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
            For chains and multi-location businesses
          </p>
          <p style={{ fontWeight: 700, fontSize: '1.25rem', color: 'var(--purple-500)', marginBottom: '1rem' }}>
            $25/mo
          </p>
          <div style={{ marginBottom: '1.5rem' }}>
            <ul style={{ listStyle: 'none', padding: 0, textAlign: 'left' }}>
              <li style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--gray-100)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: 'var(--green-500)', fontWeight: 700 }}>+</span> Everything in Tier 2
              </li>
              <li style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--gray-100)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: 'var(--green-500)', fontWeight: 700 }}>+</span> <strong>3 free stores</strong>
              </li>
              <li style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--gray-100)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: 'var(--green-500)', fontWeight: 700 }}>+</span> Per-store inventory and chat
              </li>
              <li style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--gray-100)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: 'var(--green-500)', fontWeight: 700 }}>+</span> Store managers
              </li>
              <li style={{ padding: '0.5rem 0', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ color: 'var(--green-500)', fontWeight: 700 }}>+</span> Extra stores at $8/mo each
              </li>
            </ul>
          </div>
          {currentTier === 'infrastructure' ? (
            <span className="badge badge-success" style={{ fontSize: '0.8rem', padding: '0.375rem 1rem' }}>
              Current Plan
            </span>
          ) : isAdmin ? (
            <a href={buildStripeUrl(INFRA_URL)} target="_blank" rel="noopener noreferrer" className="btn btn-full" style={{ background: 'var(--purple-500)', color: '#fff', border: 'none' }}>
              Subscribe to Infrastructure
            </a>
          ) : (
            <p style={{ color: 'var(--gray-500)', fontSize: '0.8rem' }}>Ask your admin to upgrade</p>
          )}
        </div>
      </div>
    </div>
  );
}
