import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiRequest, apiPost } from '../api/client';
import { GOOGLE_CLIENT_ID } from '../utils/constants';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [organization, setOrganization] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(() => localStorage.getItem('authToken'));

  const logout = useCallback(() => {
    localStorage.removeItem('authToken');
    setToken(null);
    setUser(null);
    setOrganization(null);
  }, []);

  // Check auth on mount
  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    apiRequest('/api/auth/me')
      .then((data) => {
        setUser(data.user);
        setOrganization(data.organization);
      })
      .catch(() => {
        logout();
      })
      .finally(() => {
        setLoading(false);
      });
  }, [token, logout]);

  const loginWithGoogle = useCallback(async () => {
    return new Promise((resolve, reject) => {
      if (typeof google === 'undefined' || !google.accounts) {
        reject(new Error('Google Sign-In is loading. Please try again.'));
        return;
      }

      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response) => {
          try {
            const data = await apiPost('/api/auth/google', {
              credential: response.credential,
            });
            localStorage.setItem('authToken', data.token);
            setToken(data.token);
            setUser(data.user);
            setOrganization(data.organization);
            resolve(data);
          } catch (err) {
            reject(err);
          }
        },
        auto_select: false,
      });

      google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          // Fallback: use popup
          google.accounts.oauth2
            .initTokenClient({
              client_id: GOOGLE_CLIENT_ID,
              scope: 'email profile',
              callback: async (tokenResponse) => {
                try {
                  // Get user info from Google
                  const userInfoRes = await fetch(
                    'https://www.googleapis.com/oauth2/v3/userinfo',
                    { headers: { Authorization: `Bearer ${tokenResponse.access_token}` } }
                  );
                  const userInfo = await userInfoRes.json();

                  const data = await apiPost('/api/auth/google', {
                    email: userInfo.email,
                    name: userInfo.name,
                    googleId: userInfo.sub,
                    picture: userInfo.picture,
                  });

                  localStorage.setItem('authToken', data.token);
                  setToken(data.token);
                  setUser(data.user);
                  setOrganization(data.organization);
                  resolve(data);
                } catch (err) {
                  reject(err);
                }
              },
            })
            .requestAccessToken();
        }
      });
    });
  }, []);

  const createOrganization = useCallback(async (name) => {
    const data = await apiPost('/api/auth/create-organization', { name });
    setOrganization(data.organization);
    return data.organization;
  }, []);

  const updateOrganization = useCallback((org) => {
    setOrganization(org);
  }, []);

  const value = {
    user,
    organization,
    loading,
    token,
    isAuthenticated: !!user,
    isSuperAdmin: user?.isSuperAdmin || false,
    loginWithGoogle,
    logout,
    createOrganization,
    updateOrganization,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
