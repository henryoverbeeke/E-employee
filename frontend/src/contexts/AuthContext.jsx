import { createContext, useContext, useState, useEffect } from 'react';
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute
} from 'amazon-cognito-identity-js';
import { config } from '../config';

const userPool = new CognitoUserPool({
  UserPoolId: config.cognito.userPoolId,
  ClientId: config.cognito.clientId
});

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const cognitoUser = userPool.getCurrentUser();
    if (cognitoUser) {
      cognitoUser.getSession((err, session) => {
        if (err || !session.isValid()) {
          setLoading(false);
          return;
        }
        setUser(cognitoUser);
        fetchProfile(session.getIdToken().getJwtToken()).finally(() => setLoading(false));
      });
    } else {
      setLoading(false);
    }
  }, []);

  async function fetchProfile(token) {
    try {
      const res = await fetch(`${config.apiUrl}/auth/me`, {
        headers: { Authorization: token }
      });
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
      }
    } catch (e) {
      console.error('Failed to fetch profile:', e);
    }
  }

  function getToken() {
    return new Promise((resolve, reject) => {
      const cognitoUser = userPool.getCurrentUser();
      if (!cognitoUser) return reject(new Error('No user'));
      cognitoUser.getSession((err, session) => {
        if (err) return reject(err);
        resolve(session.getIdToken().getJwtToken());
      });
    });
  }

  async function apiCall(path, options = {}) {
    const token = await getToken();
    const res = await fetch(`${config.apiUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: token,
        ...options.headers
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'API error');
    return data;
  }

  function signUp(email, password) {
    return new Promise((resolve, reject) => {
      const attributes = [
        new CognitoUserAttribute({ Name: 'email', Value: email })
      ];
      userPool.signUp(email, password, attributes, null, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    });
  }

  function signIn(email, password) {
    return new Promise((resolve, reject) => {
      const cognitoUser = new CognitoUser({ Username: email, Pool: userPool });
      const authDetails = new AuthenticationDetails({ Username: email, Password: password });

      cognitoUser.authenticateUser(authDetails, {
        onSuccess: async (session) => {
          setUser(cognitoUser);
          await fetchProfile(session.getIdToken().getJwtToken());
          resolve(session);
        },
        onFailure: (err) => reject(err),
        newPasswordRequired: (userAttributes) => {
          resolve({ newPasswordRequired: true, cognitoUser, userAttributes });
        }
      });
    });
  }

  function completeNewPassword(cognitoUser, newPassword) {
    return new Promise((resolve, reject) => {
      cognitoUser.completeNewPasswordChallenge(newPassword, {}, {
        onSuccess: async (session) => {
          setUser(cognitoUser);
          await fetchProfile(session.getIdToken().getJwtToken());
          resolve(session);
        },
        onFailure: (err) => reject(err)
      });
    });
  }

  function signOut() {
    const cognitoUser = userPool.getCurrentUser();
    if (cognitoUser) cognitoUser.signOut();
    setUser(null);
    setProfile(null);
  }

  return (
    <AuthContext.Provider value={{
      user, profile, loading, error, setError,
      signUp, signIn, signOut, completeNewPassword,
      getToken, apiCall, fetchProfile, setProfile
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
