import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [needsNewPassword, setNeedsNewPassword] = useState(false);
  const [cognitoUser, setCognitoUser] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, completeNewPassword } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (needsNewPassword) {
        if (newPassword !== confirmPassword) {
          throw new Error('Passwords do not match');
        }
        if (newPassword.length < 8) {
          throw new Error('Password must be at least 8 characters');
        }
        await completeNewPassword(cognitoUser, newPassword);
        navigate('/dashboard');
      } else {
        const result = await signIn(email, password);
        if (result?.newPasswordRequired) {
          setNeedsNewPassword(true);
          setCognitoUser(result.cognitoUser);
        } else {
          navigate('/dashboard');
        }
      }
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>E-Employee</h1>
        <h2>{needsNewPassword ? 'Set Your Password' : 'Sign In'}</h2>

        {error && <div className="alert alert-error">{error}</div>}

        {needsNewPassword && (
          <div className="alert alert-success">
            Welcome! Your admin created your account. Please choose a password to get started.
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {!needsNewPassword ? (
            <>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="you@company.com"
                />
              </div>
              <div className="form-group">
                <label>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="Enter password or temporary password"
                />
                <p className="form-hint">First time? Use the temporary password from your email.</p>
              </div>
            </>
          ) : (
            <>
              <div className="form-group">
                <label>New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required
                  placeholder="Choose a new password"
                  minLength={8}
                />
                <p className="form-hint">Min 8 characters, uppercase, lowercase, and a number</p>
              </div>
              <div className="form-group">
                <label>Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  placeholder="Re-enter your new password"
                  minLength={8}
                />
              </div>
            </>
          )}

          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading
              ? (needsNewPassword ? 'Setting password...' : 'Signing in...')
              : (needsNewPassword ? 'Set Password & Continue' : 'Sign In')
            }
          </button>
        </form>

        <div className="auth-links">
          <Link to="/register/org">Create an Organization</Link>
        </div>
      </div>
    </div>
  );
}
