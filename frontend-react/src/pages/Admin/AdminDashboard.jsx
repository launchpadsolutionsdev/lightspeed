import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import { useToast } from '../../components/common/Toast';
import ToolHeader from '../../components/Layout/ToolHeader';
import Footer from '../../components/Layout/Footer';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const showToast = useToast();
  const [activeTab, setActiveTab] = useState('overview');
  const [dashboard, setDashboard] = useState(null);
  const [engagement, setEngagement] = useState(null);
  const [users, setUsers] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userSearch, setUserSearch] = useState('');
  const [orgSearch, setOrgSearch] = useState('');
  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    if (activeTab === 'users') loadUsers();
    if (activeTab === 'organizations') loadOrgs();
    if (activeTab === 'engagement') loadEngagement();
  }, [activeTab]);

  const loadDashboard = async () => {
    try {
      const data = await apiRequest('/api/admin/dashboard');
      setDashboard(data);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadEngagement = async () => {
    try {
      const data = await apiRequest('/api/admin/analytics/engagement?period=30');
      setEngagement(data);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const loadUsers = async () => {
    try {
      const params = userSearch ? `?search=${encodeURIComponent(userSearch)}` : '';
      const data = await apiRequest(`/api/admin/users${params}`);
      setUsers(data.users || []);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const loadOrgs = async () => {
    try {
      const params = orgSearch ? `?search=${encodeURIComponent(orgSearch)}` : '';
      const data = await apiRequest(`/api/admin/organizations${params}`);
      setOrganizations(data.organizations || []);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Render chart when dashboard data is available
  useEffect(() => {
    if (dashboard?.dailyActivity && chartRef.current && activeTab === 'overview') {
      if (chartInstance.current) chartInstance.current.destroy();
      const labels = dashboard.dailyActivity.map((d) => new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })).reverse();
      const requests = dashboard.dailyActivity.map((d) => parseInt(d.requests)).reverse();
      const usersData = dashboard.dailyActivity.map((d) => parseInt(d.users)).reverse();

      chartInstance.current = new window.Chart(chartRef.current, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Requests', data: requests, backgroundColor: 'rgba(139, 92, 246, 0.7)', borderRadius: 4 },
            { label: 'Active Users', data: usersData, backgroundColor: 'rgba(167, 139, 250, 0.5)', borderRadius: 4 },
          ],
        },
        options: {
          responsive: true,
          plugins: { legend: { position: 'top' } },
          scales: { y: { beginAtZero: true } },
        },
      });
    }
    return () => { if (chartInstance.current) chartInstance.current.destroy(); };
  }, [dashboard, activeTab]);

  if (loading) {
    return (
      <div className="app">
        <ToolHeader title="Admin Dashboard" />
        <div className="container"><div className="loading-screen"><div className="loading-spinner" /><p>Loading dashboard...</p></div></div>
        <Footer />
      </div>
    );
  }

  const ov = dashboard?.overview || {};
  const subs = dashboard?.subscriptions || {};

  return (
    <div className="app">
      <ToolHeader title="Admin Dashboard" />

      <div className="container">
        <div className="admin-dashboard">
          {/* Tab Navigation */}
          <div className="admin-tabs">
            {['overview', 'engagement', 'users', 'organizations'].map((tab) => (
              <button
                key={tab}
                className={`admin-tab ${activeTab === tab ? 'active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <>
              <div className="admin-stats-grid">
                <div className="admin-stat-card">
                  <div className="admin-stat-value">{ov.totalUsers || 0}</div>
                  <div className="admin-stat-label">Total Users</div>
                  <div className="admin-stat-sub">+{ov.newUsersToday || 0} today</div>
                </div>
                <div className="admin-stat-card">
                  <div className="admin-stat-value">{ov.totalOrganizations || 0}</div>
                  <div className="admin-stat-label">Organizations</div>
                  <div className="admin-stat-sub">+{ov.newOrgsThisWeek || 0} this week</div>
                </div>
                <div className="admin-stat-card">
                  <div className="admin-stat-value">{ov.activeUsers7Days || 0}</div>
                  <div className="admin-stat-label">Active Users (7d)</div>
                  <div className="admin-stat-sub">{ov.activeUsersToday || 0} today</div>
                </div>
                <div className="admin-stat-card">
                  <div className="admin-stat-value">{ov.totalRequests30Days || 0}</div>
                  <div className="admin-stat-label">Requests (30d)</div>
                  <div className="admin-stat-sub">{ov.requestsToday || 0} today</div>
                </div>
              </div>

              {/* Subscription breakdown */}
              <div className="admin-stats-grid" style={{ marginTop: '16px' }}>
                <div className="admin-stat-card">
                  <div className="admin-stat-value">{subs.trial || 0}</div>
                  <div className="admin-stat-label">Trial</div>
                </div>
                <div className="admin-stat-card">
                  <div className="admin-stat-value">{subs.active || 0}</div>
                  <div className="admin-stat-label">Active</div>
                </div>
                <div className="admin-stat-card">
                  <div className="admin-stat-value">{subs.cancelled || 0}</div>
                  <div className="admin-stat-label">Cancelled</div>
                </div>
                <div className="admin-stat-card">
                  <div className="admin-stat-value">{ov.avgResponseTimeMs || 0}ms</div>
                  <div className="admin-stat-label">Avg Response</div>
                </div>
              </div>

              {/* Tool Usage */}
              {dashboard?.toolUsage?.length > 0 && (
                <div className="admin-card" style={{ marginTop: '24px' }}>
                  <h3>Tool Usage (30 days)</h3>
                  <table className="admin-table">
                    <thead>
                      <tr><th>Tool</th><th>Requests</th><th>Tokens</th></tr>
                    </thead>
                    <tbody>
                      {dashboard.toolUsage.map((t) => (
                        <tr key={t.tool}>
                          <td>{t.tool.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</td>
                          <td>{parseInt(t.count).toLocaleString()}</td>
                          <td>{parseInt(t.tokens || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Daily Activity Chart */}
              <div className="admin-card" style={{ marginTop: '24px' }}>
                <h3>Daily Activity (14 days)</h3>
                <canvas ref={chartRef} />
              </div>
            </>
          )}

          {/* Engagement Tab */}
          {activeTab === 'engagement' && engagement && (
            <>
              <div className="admin-stats-grid">
                <div className="admin-stat-card">
                  <div className="admin-stat-value">{engagement.retention?.retentionRate || 0}%</div>
                  <div className="admin-stat-label">Week-over-Week Retention</div>
                </div>
                <div className="admin-stat-card">
                  <div className="admin-stat-value">{engagement.retention?.returnedUsers || 0}</div>
                  <div className="admin-stat-label">Returned Users</div>
                </div>
              </div>

              {engagement.featureAdoption?.length > 0 && (
                <div className="admin-card" style={{ marginTop: '24px' }}>
                  <h3>Feature Adoption</h3>
                  <table className="admin-table">
                    <thead>
                      <tr><th>Tool</th><th>Adoption Rate</th></tr>
                    </thead>
                    <tbody>
                      {engagement.featureAdoption.map((f) => (
                        <tr key={f.tool}>
                          <td>{f.tool.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</td>
                          <td>{f.adoption_rate}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {engagement.topUsers?.length > 0 && (
                <div className="admin-card" style={{ marginTop: '24px' }}>
                  <h3>Top Users</h3>
                  <table className="admin-table">
                    <thead>
                      <tr><th>User</th><th>Email</th><th>Requests</th><th>Last Active</th></tr>
                    </thead>
                    <tbody>
                      {engagement.topUsers.map((u) => (
                        <tr key={u.id}>
                          <td>{u.first_name} {u.last_name}</td>
                          <td>{u.email}</td>
                          <td>{u.request_count}</td>
                          <td>{new Date(u.last_active).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* Users Tab */}
          {activeTab === 'users' && (
            <>
              <div className="admin-search-bar">
                <input
                  type="text"
                  placeholder="Search users..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadUsers()}
                />
                <button className="btn-primary" onClick={loadUsers}>Search</button>
              </div>
              <div className="admin-card">
                <table className="admin-table">
                  <thead>
                    <tr><th>Name</th><th>Email</th><th>Organization</th><th>Role</th><th>Joined</th></tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td>{u.first_name} {u.last_name} {u.is_super_admin && <span className="admin-badge">Admin</span>}</td>
                        <td>{u.email}</td>
                        <td>{u.organization_name || '—'}</td>
                        <td>{u.role || '—'}</td>
                        <td>{new Date(u.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Organizations Tab */}
          {activeTab === 'organizations' && (
            <>
              <div className="admin-search-bar">
                <input
                  type="text"
                  placeholder="Search organizations..."
                  value={orgSearch}
                  onChange={(e) => setOrgSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadOrgs()}
                />
                <button className="btn-primary" onClick={loadOrgs}>Search</button>
              </div>
              <div className="admin-card">
                <table className="admin-table">
                  <thead>
                    <tr><th>Name</th><th>Status</th><th>Members</th><th>Tokens Used</th><th>Created</th></tr>
                  </thead>
                  <tbody>
                    {organizations.map((o) => (
                      <tr key={o.id}>
                        <td>{o.name}</td>
                        <td><span className={`subscription-badge status-${o.subscription_status}`}>{o.subscription_status}</span></td>
                        <td>{o.member_count || 0}</td>
                        <td>{parseInt(o.total_tokens_used || 0).toLocaleString()}</td>
                        <td>{new Date(o.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}
