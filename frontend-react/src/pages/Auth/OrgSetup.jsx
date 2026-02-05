import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/common/Toast';

export default function OrgSetup() {
  const navigate = useNavigate();
  const { createOrganization } = useAuth();
  const showToast = useToast();
  const [orgName, setOrgName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const name = orgName.trim();
    if (!name) return;

    setSubmitting(true);

    try {
      await createOrganization(name);
      navigate('/tools');
    } catch (err) {
      showToast(err.message || 'Failed to create organization. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <img src="/launchpad-logo.svg" alt="Launchpad" />
          <span>Lightspeed</span>
        </div>

        <h1>Set up your organization</h1>
        <p className="auth-subtitle">Create your team workspace to get started</p>

        <form onSubmit={handleSubmit}>
          <input
            type="text"
            className="auth-input"
            placeholder="Organization name"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            required
            autoFocus
          />

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={submitting || !orgName.trim()}
          >
            {submitting ? 'Creating...' : 'Create Organization'}
          </button>
        </form>
      </div>
    </div>
  );
}
