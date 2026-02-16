import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function RegisterOrgPage() {
  const [orgName, setOrgName] = useState('');
  const [domain, setDomain] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signUp, signIn, apiCall, fetchProfile, getToken } = useAuth();
  const navigate = useNavigate();

  function handleEmailChange(e) {
    setEmail(e.target.value);
    const parts = e.target.value.split('@');
    if (parts.length === 2 && parts[1]) {
      setDomain(parts[1]);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (!email.endsWith('@' + domain)) {
        throw new Error('Your email must match the organization domain');
      }

      await signUp(email, password);
      await signIn(email, password);

      await apiCall('/organizations', {
        method: 'POST',
        body: JSON.stringify({ orgName, domain, displayName })
      });

      const profileToken = await getToken();
      await fetchProfile(profileToken);

      navigate('/dashboard');
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>E-Employee</h1>
        <h2>Create Organization</h2>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Organization Name</label>
            <input
              type="text"
              value={orgName}
              onChange={e => setOrgName(e.target.value)}
              required
              placeholder="Acme Corp"
            />
          </div>

          <div className="form-group">
            <label>Your Email (admin)</label>
            <input
              type="email"
              value={email}
              onChange={handleEmailChange}
              required
              placeholder="admin@acme.com"
            />
          </div>

          <div className="form-group">
            <label>Domain</label>
            <input
              type="text"
              value={domain}
              onChange={e => setDomain(e.target.value)}
              required
              placeholder="acme.com"
            />
            <p className="form-hint">Only emails with this domain can join your org</p>
          </div>

          <div className="form-group">
            <label>Your Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="John Doe"
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="Min 8 chars, uppercase, lowercase, number"
              minLength={8}
            />
          </div>

          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? 'Creating...' : 'Create Organization'}
          </button>
        </form>

        <div className="auth-links">
          <Link to="/login">Already have an account? Sign In</Link>
        </div>
      </div>
    </div>
  );
}
