import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { apiPatch, apiRequest } from '../../api/client';
import { useToast } from '../../components/common/Toast';
import ToolHeader from '../../components/Layout/ToolHeader';
import Footer from '../../components/Layout/Footer';

export default function SettingsPage() {
  const { user, organization, updateOrganization, logout } = useAuth();
  const navigate = useNavigate();
  const showToast = useToast();
  const [orgName, setOrgName] = useState('');
  const [brandVoice, setBrandVoice] = useState('');
  const [timezone, setTimezone] = useState('America/Toronto');
  const [saving, setSaving] = useState(false);
  const [subscription, setSubscription] = useState(null);

  useEffect(() => {
    if (organization) {
      setOrgName(organization.name || '');
      setBrandVoice(organization.brand_voice || '');
      setTimezone(organization.timezone || 'America/Toronto');
    }
  }, [organization]);

  useEffect(() => {
    apiRequest('/api/billing/subscription')
      .then(setSubscription)
      .catch(() => {});
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!organization) return;
    setSaving(true);
    try {
      const data = await apiPatch(`/api/organizations/${organization.id}`, {
        name: orgName,
        brandVoice,
        timezone,
      });
      updateOrganization(data.organization);
      showToast('Settings saved!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app">
      <ToolHeader title="Settings" />

      <div className="container">
        <div className="settings-page">
          {/* Account Info */}
          <div className="settings-card">
            <h3>Account</h3>
            <div className="settings-info-row">
              <label>Name</label>
              <span>{user?.firstName} {user?.lastName}</span>
            </div>
            <div className="settings-info-row">
              <label>Email</label>
              <span>{user?.email}</span>
            </div>
            <div className="settings-info-row">
              <label>Sign-in Method</label>
              <span>Google</span>
            </div>
          </div>

          {/* Organization Settings */}
          <div className="settings-card">
            <h3>Organization</h3>
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label>Organization Name</label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Your organization name"
                />
              </div>
              <div className="form-group">
                <label>Brand Voice</label>
                <textarea
                  value={brandVoice}
                  onChange={(e) => setBrandVoice(e.target.value)}
                  placeholder="Describe your organization's brand voice and tone. This will be used by AI tools to generate content that matches your style."
                  rows={4}
                />
                <span className="form-hint">This helps the AI match your organization's tone in generated content.</span>
              </div>
              <div className="form-group">
                <label>Timezone</label>
                <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  <option value="America/Toronto">Eastern (Toronto)</option>
                  <option value="America/Chicago">Central (Chicago)</option>
                  <option value="America/Denver">Mountain (Denver)</option>
                  <option value="America/Los_Angeles">Pacific (Los Angeles)</option>
                  <option value="America/Vancouver">Pacific (Vancouver)</option>
                  <option value="America/Winnipeg">Central (Winnipeg)</option>
                  <option value="America/Halifax">Atlantic (Halifax)</option>
                </select>
              </div>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </form>
          </div>

          {/* Subscription */}
          <div className="settings-card">
            <h3>Subscription</h3>
            <div className="settings-info-row">
              <label>Status</label>
              <span className={`subscription-badge status-${subscription?.status || 'trial'}`}>
                {(subscription?.status || 'trial').charAt(0).toUpperCase() + (subscription?.status || 'trial').slice(1)}
              </span>
            </div>
            {subscription?.trialEndsAt && (
              <div className="settings-info-row">
                <label>Trial Ends</label>
                <span>{new Date(subscription.trialEndsAt).toLocaleDateString()}</span>
              </div>
            )}
            <div className="settings-pricing-info">
              <p>Plans start at <strong>$499/month</strong> or <strong>$449/month</strong> billed annually.</p>
              <a href="mailto:hello@launchpadsolutions.ca?subject=Lightspeed%20Subscription" className="btn-primary">
                Contact Us to Upgrade
              </a>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="settings-card settings-danger">
            <h3>Account Actions</h3>
            <button className="btn-danger" onClick={() => { logout(); navigate('/'); }}>
              Sign Out
            </button>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
