// ==================== SUPER ADMIN DASHBOARD ====================
// Platform-level analytics for Lightspeed super administrators

let adminDashboardInitialized = false;
let adminData = null;
let adminCharts = {};

// Check if current user is super admin
async function checkSuperAdmin() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/dashboard`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            return true;
        }
        return false;
    } catch (error) {
        return false;
    }
}

// Initialize admin dashboard if user is super admin
async function initAdminDashboard() {
    if (adminDashboardInitialized) return;

    const isSuperAdmin = await checkSuperAdmin();

    if (isSuperAdmin) {
        // Show admin nav button
        const adminNavBtn = document.getElementById('adminNavBtn');
        if (adminNavBtn) {
            adminNavBtn.style.display = 'flex';
        }

        // Add event listener for admin nav
        adminNavBtn?.addEventListener('click', () => {
            switchPage('admin');
            loadAdminDashboard();
        });

        adminDashboardInitialized = true;
        console.log('Admin dashboard initialized');
    }
}

// Load admin dashboard data
async function loadAdminDashboard() {
    const dashboard = document.getElementById('adminDashboard');
    if (!dashboard) return;

    // Show loading state
    dashboard.innerHTML = `
        <div class="admin-loading">
            <div class="loading-spinner"></div>
            <p>Loading platform analytics...</p>
        </div>
    `;

    try {
        const [dashboardData, engagementData] = await Promise.all([
            fetchAdminData('/api/admin/dashboard'),
            fetchAdminData('/api/admin/analytics/engagement?period=30')
        ]);

        if (dashboardData && engagementData) {
            adminData = { ...dashboardData, engagement: engagementData };
            renderAdminDashboard();
        } else {
            throw new Error('Failed to load admin data');
        }
    } catch (error) {
        console.error('Admin dashboard error:', error);
        dashboard.innerHTML = `
            <div class="admin-error">
                <div class="error-icon">⚠️</div>
                <h3>Unable to load admin dashboard</h3>
                <p>${error.message}</p>
                <button onclick="loadAdminDashboard()" class="btn btn-primary">Retry</button>
            </div>
        `;
    }
}

// Fetch admin data helper
async function fetchAdminData(endpoint) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
}

// Render the admin dashboard
function renderAdminDashboard() {
    const dashboard = document.getElementById('adminDashboard');
    if (!dashboard || !adminData) return;

    const { overview, toolUsage, dailyActivity, subscriptions, engagement } = adminData;

    dashboard.innerHTML = `
        <div class="admin-header">
            <h2>🛡️ Platform Admin Dashboard</h2>
            <p class="admin-subtitle">Real-time platform analytics and user engagement metrics</p>
            <div class="admin-actions">
                <button onclick="loadAdminDashboard()" class="btn btn-secondary btn-sm">
                    🔄 Refresh
                </button>
                <button onclick="exportAdminReport()" class="btn btn-secondary btn-sm">
                    📥 Export Report
                </button>
            </div>
        </div>

        <!-- Key Metrics -->
        <div class="admin-stats-grid">
            <div class="admin-stat-card">
                <div class="admin-stat-icon">👥</div>
                <div class="admin-stat-content">
                    <div class="admin-stat-value">${overview.totalUsers.toLocaleString()}</div>
                    <div class="admin-stat-label">Total Users</div>
                    <div class="admin-stat-change positive">+${overview.newUsersToday} today</div>
                </div>
            </div>
            <div class="admin-stat-card">
                <div class="admin-stat-icon">🏢</div>
                <div class="admin-stat-content">
                    <div class="admin-stat-value">${overview.totalOrganizations.toLocaleString()}</div>
                    <div class="admin-stat-label">Organizations</div>
                    <div class="admin-stat-change positive">+${overview.newOrgsThisWeek} this week</div>
                </div>
            </div>
            <div class="admin-stat-card highlight">
                <div class="admin-stat-icon">🔥</div>
                <div class="admin-stat-content">
                    <div class="admin-stat-value">${overview.activeUsers7Days.toLocaleString()}</div>
                    <div class="admin-stat-label">Active Users (7d)</div>
                    <div class="admin-stat-change">${overview.activeUsersToday} today</div>
                </div>
            </div>
            <div class="admin-stat-card">
                <div class="admin-stat-icon">⚡</div>
                <div class="admin-stat-content">
                    <div class="admin-stat-value">${overview.totalRequests30Days.toLocaleString()}</div>
                    <div class="admin-stat-label">Requests (30d)</div>
                    <div class="admin-stat-change">${overview.requestsToday} today</div>
                </div>
            </div>
            <div class="admin-stat-card">
                <div class="admin-stat-icon">⏱️</div>
                <div class="admin-stat-content">
                    <div class="admin-stat-value">${overview.avgResponseTimeMs}ms</div>
                    <div class="admin-stat-label">Avg Response Time</div>
                </div>
            </div>
            <div class="admin-stat-card ${overview.successRate >= 95 ? 'success' : overview.successRate >= 90 ? '' : 'warning'}">
                <div class="admin-stat-icon">✅</div>
                <div class="admin-stat-content">
                    <div class="admin-stat-value">${overview.successRate}%</div>
                    <div class="admin-stat-label">Success Rate</div>
                </div>
            </div>
        </div>

        <!-- Charts Row -->
        <div class="admin-charts-grid">
            <div class="admin-card">
                <div class="admin-card-header">
                    <h3>📈 Daily Active Users</h3>
                    <span class="admin-card-badge">Last 14 days</span>
                </div>
                <div class="admin-chart-container">
                    <canvas id="dauChart"></canvas>
                </div>
            </div>

            <div class="admin-card">
                <div class="admin-card-header">
                    <h3>🧰 Tool Usage</h3>
                    <span class="admin-card-badge">Last 30 days</span>
                </div>
                <div class="admin-chart-container">
                    <canvas id="toolUsageChart"></canvas>
                </div>
            </div>
        </div>

        <!-- Engagement Metrics -->
        <div class="admin-engagement-section">
            <h3>📊 User Engagement Metrics</h3>
            <div class="admin-engagement-grid">
                <div class="admin-engagement-card">
                    <div class="engagement-metric">
                        <span class="engagement-value">${engagement.retention.retentionRate}%</span>
                        <span class="engagement-label">Week-over-Week Retention</span>
                    </div>
                    <div class="engagement-detail">
                        ${engagement.retention.returnedUsers} of ${engagement.retention.week1Users} users returned
                    </div>
                </div>

                <div class="admin-engagement-card">
                    <h4>Feature Adoption</h4>
                    <div class="feature-adoption-list">
                        ${engagement.featureAdoption.map(f => `
                            <div class="feature-adoption-item">
                                <span class="feature-name">${formatToolName(f.tool)}</span>
                                <div class="feature-bar-container">
                                    <div class="feature-bar" style="width: ${f.adoption_rate}%"></div>
                                </div>
                                <span class="feature-rate">${f.adoption_rate}%</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>

        <!-- Top Users & Peak Hours -->
        <div class="admin-details-grid">
            <div class="admin-card">
                <div class="admin-card-header">
                    <h3>🏆 Top Active Users</h3>
                    <span class="admin-card-badge">Last 30 days</span>
                </div>
                <div class="admin-table-container">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>User</th>
                                <th>Requests</th>
                                <th>Last Active</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${engagement.topUsers.map((user, i) => `
                                <tr>
                                    <td>
                                        <div class="user-info">
                                            <span class="user-rank">#${i + 1}</span>
                                            <span class="user-name">${user.first_name || ''} ${user.last_name || ''}</span>
                                            <span class="user-email">${user.email}</span>
                                        </div>
                                    </td>
                                    <td><strong>${user.request_count.toLocaleString()}</strong></td>
                                    <td>${formatTimeAgo(user.last_active)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="admin-card">
                <div class="admin-card-header">
                    <h3>🕐 Peak Usage Hours</h3>
                    <span class="admin-card-badge">Last 7 days</span>
                </div>
                <div class="admin-chart-container">
                    <canvas id="peakHoursChart"></canvas>
                </div>
            </div>
        </div>

        <!-- Subscription Status -->
        <div class="admin-card">
            <div class="admin-card-header">
                <h3>💳 Subscription Status</h3>
            </div>
            <div class="subscription-status-grid">
                ${Object.entries(subscriptions).map(([status, count]) => `
                    <div class="subscription-status-item ${status}">
                        <span class="status-count">${count}</span>
                        <span class="status-label">${formatSubscriptionStatus(status)}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    // Initialize charts
    setTimeout(() => {
        initAdminCharts();
    }, 100);
}

// Initialize Chart.js charts
function initAdminCharts() {
    // Destroy existing charts
    Object.values(adminCharts).forEach(chart => chart?.destroy());
    adminCharts = {};

    const { dailyActivity, toolUsage, engagement } = adminData;

    // Daily Active Users Chart
    const dauCtx = document.getElementById('dauChart');
    if (dauCtx) {
        adminCharts.dau = new Chart(dauCtx, {
            type: 'line',
            data: {
                labels: engagement.dailyActiveUsers.map(d => formatDate(d.date)),
                datasets: [{
                    label: 'Active Users',
                    data: engagement.dailyActiveUsers.map(d => d.active_users),
                    borderColor: '#7c3aed',
                    backgroundColor: 'rgba(124, 58, 237, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    }

    // Tool Usage Chart
    const toolCtx = document.getElementById('toolUsageChart');
    if (toolCtx) {
        const colors = ['#7c3aed', '#a78bfa', '#c4b5fd', '#ddd6fe'];
        adminCharts.tools = new Chart(toolCtx, {
            type: 'doughnut',
            data: {
                labels: toolUsage.map(t => formatToolName(t.tool)),
                datasets: [{
                    data: toolUsage.map(t => parseInt(t.count)),
                    backgroundColor: colors,
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' }
                }
            }
        });
    }

    // Peak Hours Chart
    const peakCtx = document.getElementById('peakHoursChart');
    if (peakCtx && engagement.peakUsageHours) {
        adminCharts.peak = new Chart(peakCtx, {
            type: 'bar',
            data: {
                labels: engagement.peakUsageHours.map(h => `${h.hour}:00`),
                datasets: [{
                    label: 'Requests',
                    data: engagement.peakUsageHours.map(h => parseInt(h.request_count)),
                    backgroundColor: 'rgba(124, 58, 237, 0.6)',
                    borderColor: '#7c3aed',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    }
}

// Helper functions
function formatToolName(tool) {
    const names = {
        'draft_assistant': 'Draft Assistant',
        'response_assistant': 'Response Assistant',
        'insights_engine': 'Insights Engine',
        'list_normalizer': 'List Normalizer'
    };
    return names[tool] || tool;
}

function formatSubscriptionStatus(status) {
    const names = {
        'trialing': 'Trial',
        'active': 'Active',
        'past_due': 'Past Due',
        'canceled': 'Canceled',
        'incomplete': 'Incomplete'
    };
    return names[status] || status;
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTimeAgo(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
}

// Export admin report
async function exportAdminReport() {
    if (!adminData) {
        showToast('No data to export', 'error');
        return;
    }

    const report = {
        generatedAt: new Date().toISOString(),
        overview: adminData.overview,
        toolUsage: adminData.toolUsage,
        subscriptions: adminData.subscriptions,
        engagement: adminData.engagement
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lightspeed-admin-report-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Report exported successfully!', 'success');
}

// Expose functions globally
window.loadAdminDashboard = loadAdminDashboard;
window.exportAdminReport = exportAdminReport;
window.initAdminDashboard = initAdminDashboard;

// Auto-init on page load
document.addEventListener('DOMContentLoaded', () => {
    // Check super admin status after auth
    setTimeout(initAdminDashboard, 1000);
});
