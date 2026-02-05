import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { apiRequest, apiPost, apiDelete, apiPatch } from '../../api/client';
import { useToast } from '../../components/common/Toast';
import ToolHeader from '../../components/Layout/ToolHeader';
import Footer from '../../components/Layout/Footer';
import Modal from '../../components/common/Modal';

export default function TeamsPage() {
  const { user, organization } = useAuth();
  const showToast = useToast();
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState(null);

  const loadMembers = useCallback(async () => {
    if (!organization) return;
    try {
      const data = await apiRequest(`/api/organizations/${organization.id}/members`);
      setMembers(data.members || []);
      setInvitations(data.invitations || []);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [organization, showToast]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail) return;
    setInviting(true);
    try {
      const data = await apiPost(`/api/organizations/${organization.id}/invite`, {
        email: inviteEmail,
        role: inviteRole,
      });
      setInviteLink(data.inviteLink);
      setInviteEmail('');
      showToast('Invitation created!', 'success');
      loadMembers();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveMember = async (memberId) => {
    if (!confirm('Remove this member?')) return;
    try {
      await apiDelete(`/api/organizations/${organization.id}/members/${memberId}`);
      showToast('Member removed', 'success');
      loadMembers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleCancelInvite = async (inviteId) => {
    try {
      await apiDelete(`/api/organizations/${organization.id}/invitations/${inviteId}`);
      showToast('Invitation cancelled', 'success');
      loadMembers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleChangeRole = async (memberId, newRole) => {
    try {
      await apiPatch(`/api/organizations/${organization.id}/members/${memberId}`, { role: newRole });
      showToast('Role updated', 'success');
      loadMembers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(inviteLink);
    showToast('Link copied to clipboard!', 'success');
  };

  return (
    <div className="app">
      <ToolHeader title="Team Management" />

      <div className="container">
        <div className="teams-page">
          <div className="teams-header">
            <h2>{organization?.name || 'Your Organization'}</h2>
            <p>{members.length} member{members.length !== 1 ? 's' : ''}</p>
          </div>

          {/* Invite Section */}
          <div className="teams-card">
            <h3>Invite a Team Member</h3>
            <form onSubmit={handleInvite} className="invite-form">
              <div className="invite-form-row">
                <input
                  type="email"
                  placeholder="Email address"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  required
                />
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button type="submit" className="btn-primary" disabled={inviting}>
                  {inviting ? 'Sending...' : 'Send Invite'}
                </button>
              </div>
            </form>
          </div>

          {/* Members List */}
          <div className="teams-card">
            <h3>Team Members</h3>
            {loading ? (
              <div className="loading-screen"><div className="loading-spinner" /><p>Loading...</p></div>
            ) : (
              <div className="members-list">
                {members.map((member) => (
                  <div key={member.id} className="member-row">
                    <div className="member-info">
                      <div className="member-avatar">
                        {member.picture ? (
                          <img src={member.picture} alt="" />
                        ) : (
                          (member.first_name?.[0] || 'U').toUpperCase()
                        )}
                      </div>
                      <div>
                        <div className="member-name">{member.first_name} {member.last_name}</div>
                        <div className="member-email">{member.email}</div>
                      </div>
                    </div>
                    <div className="member-actions">
                      <span className={`role-badge role-${member.role}`}>{member.role}</span>
                      {member.id !== user?.id && member.role !== 'owner' && (
                        <>
                          <select
                            value={member.role}
                            onChange={(e) => handleChangeRole(member.id, e.target.value)}
                            className="role-select"
                          >
                            <option value="member">Member</option>
                            <option value="admin">Admin</option>
                          </select>
                          <button className="btn-sm btn-danger-sm" onClick={() => handleRemoveMember(member.id)}>Remove</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pending Invitations */}
          {invitations.length > 0 && (
            <div className="teams-card">
              <h3>Pending Invitations</h3>
              <div className="invitations-list">
                {invitations.map((inv) => (
                  <div key={inv.id} className="invitation-row">
                    <div>
                      <div className="invitation-email">{inv.email}</div>
                      <div className="invitation-meta">Role: {inv.role} &middot; Expires: {new Date(inv.expires_at).toLocaleDateString()}</div>
                    </div>
                    <button className="btn-sm btn-danger-sm" onClick={() => handleCancelInvite(inv.id)}>Cancel</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Invite Link Modal */}
      <Modal show={!!inviteLink} onClose={() => setInviteLink(null)} className="invite-link-modal">
        <h2>Share This Invite Link</h2>
        <p>Copy and send this link to the invited team member:</p>
        <div className="invite-link-box">
          <input type="text" readOnly value={inviteLink || ''} />
          <button className="btn-primary" onClick={copyInviteLink}>Copy</button>
        </div>
        <p className="invite-link-note">This link will expire in 7 days.</p>
        <button className="btn-secondary" onClick={() => setInviteLink(null)} style={{ width: '100%', marginTop: '12px' }}>Done</button>
      </Modal>

      <Footer />
    </div>
  );
}
