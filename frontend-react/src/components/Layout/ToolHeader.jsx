import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function ToolHeader({ title, children }) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  return (
    <header className="header">
      <div className="header-inner">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button className="back-to-menu" onClick={() => navigate('/tools')}>
            <span className="back-to-menu-icon">&larr;</span>
            Back to Menu
          </button>
          <div className="logo-section">
            <img className="logo" src="/launchpad-logo.svg" alt="Launchpad Logo" onError={(e) => (e.target.style.display = 'none')} />
            <div className="brand">
              <div className="brand-name">{title}</div>
              <div className="brand-tagline">Lightspeed by Launchpad</div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {children}
          <div className="user-menu">
            <div className="user-avatar">
              {user?.picture ? (
                <img src={user.picture} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%' }} />
              ) : (
                (user?.firstName?.[0] || 'U').toUpperCase()
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
