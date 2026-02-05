import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import Footer from '../../components/Layout/Footer';

export default function ToolsPage() {
  const navigate = useNavigate();
  const { user, isSuperAdmin, logout } = useAuth();

  const handleSignOut = () => {
    logout();
    navigate('/');
  };

  return (
    <div className="tool-menu-page">
      <div className="tool-menu-bg" />

      <header className="tool-menu-header">
        <div className="tool-menu-header-left">
          <img src="/launchpad-logo.svg" alt="Launchpad" />
          <span className="tool-menu-brand">Lightspeed</span>
        </div>
        <div className="tool-menu-header-right">
          {isSuperAdmin && (
            <button className="admin-dashboard-btn" onClick={() => navigate('/admin')}>
              Admin Dashboard
            </button>
          )}
          <div className="tool-menu-user-info">
            <span className="tool-menu-user-name">{user?.name}</span>
            <span className="tool-menu-user-email">{user?.email}</span>
          </div>
          <button className="sign-out-btn" onClick={handleSignOut}>
            Sign Out
          </button>
        </div>
      </header>

      <div className="tool-menu-content">
        <div className="tool-menu-hero">
          <h1>Let's get to work.</h1>
          <p>Lightspeed's suite of tools help get your work done, fast.</p>
        </div>

        <div className="tool-cards-grid">
          <div className="tool-card" onClick={() => navigate('/tools/draft-assistant')}>
            <div className="tool-card-icon draft">&#x270D;&#xFE0F;</div>
            <h3 className="tool-card-title">Draft Assistant</h3>
            <p className="tool-card-description">
              Create on-brand social media posts, emails, media releases, newsletters, and ads with AI assistance.
            </p>
            <span className="tool-card-badge">AI-Powered</span>
          </div>

          <div className="tool-card" onClick={() => navigate('/tools/response-assistant')}>
            <div className="tool-card-icon response">&#x1F4E7;</div>
            <h3 className="tool-card-title">Response Assistant</h3>
            <p className="tool-card-description">
              Generate professional, AI-powered responses to customer inquiries with customizable tone and templates.
            </p>
            <span className="tool-card-badge">AI-Powered</span>
          </div>

          <div className="tool-card" onClick={() => navigate('/tools/insights-engine')}>
            <div className="tool-card-icon data">&#x1F4CA;</div>
            <h3 className="tool-card-title">Insights Engine</h3>
            <p className="tool-card-description">
              Upload Excel files and instantly generate visual dashboards with charts, metrics, and key insights.
            </p>
            <span className="tool-card-badge">Visual Analytics</span>
          </div>

          <div className="tool-card" onClick={() => navigate('/tools/list-normalizer')}>
            <div className="tool-card-icon normalizer">&#x1F504;</div>
            <h3 className="tool-card-title">List Normalizer</h3>
            <p className="tool-card-description">
              Transform BUMP customer reports into clean, formatted lists ready for Mailchimp and other platforms.
            </p>
            <span className="tool-card-badge">Data Export</span>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
