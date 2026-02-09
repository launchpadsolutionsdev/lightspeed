// ==================== SUPER ADMIN DASHBOARD ====================
// Full platform admin panel for Lightspeed super administrators

let adminDashboardInitialized = false;
let adminData = null;
let adminCharts = {};
let adminAutoRefresh = null;
let adminCurrentTab = 'overview';
let adminUsersPage = 1;
let adminOrgsPage = 1;
let adminUsersSearch = '';
let adminOrgsSearch = '';
let adminOrgsStatusFilter = '';
let adminAllOrgs = null; // cached org list for dropdowns

// Check if current user is super admin
async function checkSuperAdmin() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/dashboard`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
                'Content-Type': 'application/json'
            }
        });
        return response.ok;
    } catch (error) {
        return false;
    }
}

// Initialize admin dashboard if user is super admin
async function initAdminDashboard() {
    if (adminDashboardInitialized) return;

    const isSuperAdmin = await checkSuperAdmin();

    if (isSuperAdmin) {
        const adminNavBtn = document.getElementById('adminNavBtn');
        if (adminNavBtn) {
            adminNavBtn.style.display = 'flex';
        }

        adminNavBtn?.addEventListener('click', () => {
            switchPage('admin');
            loadAdminDashboard();
        });

        adminDashboardInitialized = true;
    }
}

// ==================== MAIN LOAD ====================
async function loadAdminDashboard() {
    const dashboard = document.getElementById('adminDashboard');
    if (!dashboard) return;

    // Show shell with tabs immediately
    dashboard.innerHTML = getAdminShell();
    setupAdminTabListeners();

    // Load overview tab
    await loadAdminTab('overview');
}

function getAdminShell() {
    return `
        <div class="admin-header">
            <div class="admin-header-left">
                <h2>Platform Admin</h2>
                <p class="admin-subtitle">Lightspeed command center</p>
            </div>
            <div class="admin-header-right">
                <label class="admin-auto-refresh">
                    <input type="checkbox" id="adminAutoRefreshToggle">
                    <span>Auto-refresh (30s)</span>
                </label>
                <button onclick="loadAdminTab(adminCurrentTab)" class="admin-btn admin-btn-secondary">
                    <span>↻</span> Refresh
                </button>
            </div>
        </div>

        <div class="admin-tabs">
            <button class="admin-tab active" data-tab="overview">Overview</button>
            <button class="admin-tab" data-tab="users">Users</button>
            <button class="admin-tab" data-tab="organizations">Organizations</button>
            <button class="admin-tab" data-tab="costs">Usage & Costs</button>
            <button class="admin-tab" data-tab="activity">Activity Feed</button>
        </div>

        <div id="adminTabContent" class="admin-tab-content">
            <div class="admin-loading"><div class="loading-spinner"></div><p>Loading...</p></div>
        </div>
    `;
}

function setupAdminTabListeners() {
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            loadAdminTab(tab.dataset.tab);
        });
    });

    const toggle = document.getElementById('adminAutoRefreshToggle');
    if (toggle) {
        toggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                adminAutoRefresh = setInterval(() => loadAdminTab(adminCurrentTab), 30000);
            } else {
                clearInterval(adminAutoRefresh);
                adminAutoRefresh = null;
            }
        });
    }
}

async function loadAdminTab(tab) {
    adminCurrentTab = tab;
    const container = document.getElementById('adminTabContent');
    if (!container) return;

    container.innerHTML = '<div class="admin-loading"><div class="loading-spinner"></div><p>Loading...</p></div>';

    try {
        if (tab === 'overview') await renderOverviewTab(container);
        else if (tab === 'users') await renderUsersTab(container);
        else if (tab === 'organizations') await renderOrgsTab(container);
        else if (tab === 'costs') await renderCostsTab(container);
        else if (tab === 'activity') await renderActivityTab(container);
    } catch (error) {
        console.error(`Admin tab error (${tab}):`, error);
        container.innerHTML = `
            <div class="admin-error">
                <div class="error-icon">⚠️</div>
                <h3>Failed to load ${tab}</h3>
                <p>${error.message}</p>
                <button onclick="loadAdminTab('${tab}')" class="admin-btn admin-btn-primary">Retry</button>
            </div>`;
    }
}

// ==================== OVERVIEW TAB ====================
async function renderOverviewTab(container) {
    const [dashData, engData] = await Promise.all([
        fetchAdminData('/api/admin/dashboard'),
        fetchAdminData('/api/admin/analytics/engagement?period=30')
    ]);

    adminData = { ...dashData, engagement: engData };
    const { overview, toolUsage, subscriptions, engagement } = adminData;

    container.innerHTML = `
        <!-- Key Metrics -->
        <div class="admin-stats-grid">
            ${statCard('👥', 'Total Users', overview.totalUsers, `+${overview.newUsersToday} today`, 'positive')}
            ${statCard('🏢', 'Organizations', overview.totalOrganizations, `+${overview.newOrgsThisWeek} this week`, 'positive')}
            ${statCard('🔥', 'Active (7d)', overview.activeUsers7Days, `${overview.activeUsersToday} today`, '', true)}
            ${statCard('⚡', 'Requests (30d)', overview.totalRequests30Days, `${overview.requestsToday} today`)}
            ${statCard('✅', 'Success Rate', overview.successRate + '%', '')}
        </div>

        <!-- Subscriptions -->
        <div class="admin-section-row">
            <div class="admin-card admin-card-narrow">
                <div class="admin-card-header"><h3>Subscription Breakdown</h3></div>
                <div class="subscription-status-grid">
                    ${Object.entries(subscriptions).map(([status, count]) => `
                        <div class="subscription-status-item ${status}">
                            <span class="status-count">${count}</span>
                            <span class="status-label">${formatSubscriptionStatus(status)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="admin-card admin-card-narrow">
                <div class="admin-card-header"><h3>Tool Usage (30d)</h3></div>
                <div class="admin-tool-bars">
                    ${toolUsage.map(t => {
                        const maxCount = Math.max(...toolUsage.map(x => parseInt(x.count)));
                        const pct = Math.round((parseInt(t.count) / maxCount) * 100);
                        return `
                            <div class="admin-tool-bar-row">
                                <span class="admin-tool-bar-label">${formatToolName(t.tool)}</span>
                                <div class="admin-tool-bar-track">
                                    <div class="admin-tool-bar-fill" style="width:${pct}%"></div>
                                </div>
                                <span class="admin-tool-bar-count">${parseInt(t.count).toLocaleString()}</span>
                            </div>`;
                    }).join('')}
                </div>
            </div>
        </div>

        <!-- Charts Row -->
        <div class="admin-charts-grid">
            <div class="admin-card">
                <div class="admin-card-header">
                    <h3>Daily Active Users</h3>
                    <span class="admin-card-badge">Last 30 days</span>
                </div>
                <div class="admin-chart-container"><canvas id="dauChart"></canvas></div>
            </div>
            <div class="admin-card">
                <div class="admin-card-header">
                    <h3>Peak Usage Hours</h3>
                    <span class="admin-card-badge">Last 30 days</span>
                </div>
                <div class="admin-chart-container"><canvas id="peakHoursChart"></canvas></div>
            </div>
        </div>

        <!-- Engagement -->
        <div class="admin-section-row">
            <div class="admin-card admin-card-narrow">
                <div class="admin-card-header"><h3>Retention</h3></div>
                <div class="admin-retention-display">
                    <div class="admin-big-number">${engagement.retention.retentionRate}%</div>
                    <div class="admin-big-label">Week-over-week</div>
                    <div class="admin-big-detail">${engagement.retention.returnedUsers} of ${engagement.retention.week1Users} users returned</div>
                </div>
            </div>
            <div class="admin-card admin-card-narrow">
                <div class="admin-card-header"><h3>Feature Adoption</h3></div>
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

        <!-- Top Users -->
        <div class="admin-card">
            <div class="admin-card-header">
                <h3>Top Active Users</h3>
                <span class="admin-card-badge">Last 30 days</span>
            </div>
            <div class="admin-table-container">
                <table class="admin-table">
                    <thead>
                        <tr><th>#</th><th>User</th><th>Email</th><th>Requests</th><th>Last Active</th></tr>
                    </thead>
                    <tbody>
                        ${engagement.topUsers.map((user, i) => `
                            <tr>
                                <td class="rank">${i + 1}</td>
                                <td class="name">${user.first_name || ''} ${user.last_name || ''}</td>
                                <td class="email">${user.email}</td>
                                <td><strong>${user.request_count.toLocaleString()}</strong></td>
                                <td>${formatTimeAgo(user.last_active)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    setTimeout(() => initOverviewCharts(engagement), 100);
}

function initOverviewCharts(engagement) {
    Object.values(adminCharts).forEach(c => c?.destroy());
    adminCharts = {};

    const dauCtx = document.getElementById('dauChart');
    if (dauCtx && engagement.dailyActiveUsers.length) {
        const sorted = [...engagement.dailyActiveUsers].sort((a, b) => new Date(a.date) - new Date(b.date));
        adminCharts.dau = new Chart(dauCtx, {
            type: 'line',
            data: {
                labels: sorted.map(d => formatDate(d.date)),
                datasets: [{
                    label: 'Active Users',
                    data: sorted.map(d => d.active_users),
                    borderColor: '#3B82F6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: true, tension: 0.4, pointRadius: 3
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
        });
    }

    const peakCtx = document.getElementById('peakHoursChart');
    if (peakCtx && engagement.peakUsageHours.length) {
        adminCharts.peak = new Chart(peakCtx, {
            type: 'bar',
            data: {
                labels: engagement.peakUsageHours.map(h => `${h.hour}:00`),
                datasets: [{
                    label: 'Requests',
                    data: engagement.peakUsageHours.map(h => parseInt(h.request_count)),
                    backgroundColor: 'rgba(59, 130, 246, 0.6)',
                    borderColor: '#3B82F6', borderWidth: 1
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
        });
    }
}

// ==================== USERS TAB ====================
async function renderUsersTab(container) {
    const data = await fetchAdminData(`/api/admin/users?page=${adminUsersPage}&limit=50${adminUsersSearch ? '&search=' + encodeURIComponent(adminUsersSearch) : ''}`);

    const totalPages = Math.ceil(data.total / 50);

    container.innerHTML = `
        <div class="admin-toolbar">
            <div class="admin-toolbar-left">
                <div class="admin-search-box">
                    <input type="text" id="adminUserSearch" placeholder="Search users by name or email..."
                           value="${adminUsersSearch}" class="admin-search-input">
                    <button onclick="adminSearchUsers()" class="admin-btn admin-btn-primary admin-btn-sm">Search</button>
                    ${adminUsersSearch ? `<button onclick="adminClearUserSearch()" class="admin-btn admin-btn-secondary admin-btn-sm">Clear</button>` : ''}
                </div>
            </div>
            <div class="admin-toolbar-right">
                <span class="admin-count">${data.total} total users</span>
            </div>
        </div>

        <div class="admin-card">
            <div class="admin-table-container">
                <table class="admin-table admin-table-full">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Organization</th>
                            <th>Role</th>
                            <th>Joined</th>
                            <th>Last Login</th>
                            <th>Admin</th>
                            <th>Manage</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.users.length ? data.users.map(user => `
                            <tr>
                                <td class="name">
                                    ${user.picture ? `<img src="${user.picture}" class="admin-user-avatar" alt="">` : `<span class="admin-user-avatar-placeholder">${(user.first_name || user.email)[0].toUpperCase()}</span>`}
                                    ${user.first_name || ''} ${user.last_name || ''}
                                    ${user.is_super_admin ? '<span class="admin-badge-super">ADMIN</span>' : ''}
                                </td>
                                <td class="email">${user.email}</td>
                                <td>${user.organization_name || '<span class="text-muted">None</span>'}</td>
                                <td>${user.role ? `<span class="admin-role-badge admin-role-${user.role}">${user.role}</span>` : '<span class="text-muted">—</span>'}</td>
                                <td>${formatDateShort(user.created_at)}</td>
                                <td>${user.last_login_at ? formatTimeAgo(user.last_login_at) : '<span class="text-muted">Never</span>'}</td>
                                <td>
                                    <button class="admin-toggle-btn ${user.is_super_admin ? 'active' : ''}"
                                            onclick="toggleSuperAdmin('${user.id}', ${!user.is_super_admin})"
                                            title="${user.is_super_admin ? 'Remove super admin' : 'Make super admin'}">
                                        ${user.is_super_admin ? '✓' : '—'}
                                    </button>
                                </td>
                                <td>
                                    <button class="admin-btn admin-btn-secondary admin-btn-sm"
                                            onclick="openUserOrgModal('${user.id}', '${(user.first_name || '').replace(/'/g, "\\'")} ${(user.last_name || '').replace(/'/g, "\\'")}', '${user.organization_id || ''}', '${user.role || ''}')">
                                        Edit
                                    </button>
                                </td>
                            </tr>
                        `).join('') : '<tr><td colspan="8" class="text-center text-muted">No users found</td></tr>'}
                    </tbody>
                </table>
            </div>

            ${totalPages > 1 ? `
                <div class="admin-pagination">
                    <button onclick="adminUsersGoToPage(${adminUsersPage - 1})" class="admin-btn admin-btn-secondary admin-btn-sm" ${adminUsersPage <= 1 ? 'disabled' : ''}>← Prev</button>
                    <span class="admin-page-info">Page ${adminUsersPage} of ${totalPages}</span>
                    <button onclick="adminUsersGoToPage(${adminUsersPage + 1})" class="admin-btn admin-btn-secondary admin-btn-sm" ${adminUsersPage >= totalPages ? 'disabled' : ''}>Next →</button>
                </div>
            ` : ''}
        </div>
    `;

    // Enter key triggers search
    document.getElementById('adminUserSearch')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') adminSearchUsers();
    });
}

// ==================== ORGANIZATIONS TAB ====================
async function renderOrgsTab(container) {
    let url = `/api/admin/organizations?page=${adminOrgsPage}&limit=50`;
    if (adminOrgsSearch) url += `&search=${encodeURIComponent(adminOrgsSearch)}`;
    if (adminOrgsStatusFilter) url += `&status=${adminOrgsStatusFilter}`;

    const data = await fetchAdminData(url);
    const totalPages = Math.ceil(data.total / 50);

    container.innerHTML = `
        <div class="admin-toolbar">
            <div class="admin-toolbar-left">
                <div class="admin-search-box">
                    <input type="text" id="adminOrgSearch" placeholder="Search organizations..."
                           value="${adminOrgsSearch}" class="admin-search-input">
                    <button onclick="adminSearchOrgs()" class="admin-btn admin-btn-primary admin-btn-sm">Search</button>
                    ${adminOrgsSearch || adminOrgsStatusFilter ? `<button onclick="adminClearOrgSearch()" class="admin-btn admin-btn-secondary admin-btn-sm">Clear</button>` : ''}
                </div>
                <select id="adminOrgStatusFilter" class="admin-select" onchange="adminFilterOrgStatus(this.value)">
                    <option value="">All Statuses</option>
                    <option value="trial" ${adminOrgsStatusFilter === 'trial' ? 'selected' : ''}>Trial</option>
                    <option value="active" ${adminOrgsStatusFilter === 'active' ? 'selected' : ''}>Active</option>
                    <option value="cancelled" ${adminOrgsStatusFilter === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                    <option value="past_due" ${adminOrgsStatusFilter === 'past_due' ? 'selected' : ''}>Past Due</option>
                </select>
            </div>
            <div class="admin-toolbar-right">
                <span class="admin-count">${data.total} organizations</span>
            </div>
        </div>

        <div class="admin-card">
            <div class="admin-table-container">
                <table class="admin-table admin-table-full">
                    <thead>
                        <tr>
                            <th>Organization</th>
                            <th>Status</th>
                            <th>Plan</th>
                            <th>Members</th>
                            <th>Tokens Used</th>
                            <th>Trial Ends</th>
                            <th>Created</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.organizations.length ? data.organizations.map(org => `
                            <tr class="admin-org-row" onclick="toggleOrgDetail(this, '${org.id}')" style="cursor:pointer">
                                <td class="name">
                                    <strong>${org.name}</strong>
                                    ${org.slug ? `<span class="text-muted small-text">${org.slug}</span>` : ''}
                                </td>
                                <td><span class="admin-status-pill admin-status-${org.subscription_status}">${formatSubscriptionStatus(org.subscription_status)}</span></td>
                                <td>${org.subscription_plan || '<span class="text-muted">—</span>'}</td>
                                <td>${parseInt(org.member_count).toLocaleString()}</td>
                                <td>${org.total_tokens_used ? parseInt(org.total_tokens_used).toLocaleString() : '0'}</td>
                                <td>${org.trial_ends_at ? formatDateShort(org.trial_ends_at) : '<span class="text-muted">—</span>'}</td>
                                <td>${formatDateShort(org.created_at)}</td>
                            </tr>
                            <tr class="admin-org-detail-row" style="display:none">
                                <td colspan="7">
                                    <div class="admin-org-detail">
                                        <div class="admin-org-detail-grid">
                                            <div><strong>Website:</strong> ${org.website_url || 'Not set'}</div>
                                            <div><strong>Support Email:</strong> ${org.support_email || 'Not set'}</div>
                                            <div><strong>Licence #:</strong> ${org.licence_number || 'Not set'}</div>
                                            <div><strong>CEO:</strong> ${org.ceo_name ? `${org.ceo_name}${org.ceo_title ? ', ' + org.ceo_title : ''}` : 'Not set'}</div>
                                            <div><strong>Store Location:</strong> ${org.store_location || 'Not set'}</div>
                                            <div><strong>Timezone:</strong> ${org.timezone || 'Not set'}</div>
                                            <div><strong>Brand Voice:</strong> ${org.brand_voice ? org.brand_voice.substring(0, 100) + (org.brand_voice.length > 100 ? '...' : '') : 'Not set'}</div>
                                            <div><strong>Stripe Customer:</strong> ${org.stripe_customer_id || 'Not connected'}</div>
                                        </div>
                                        ${org.mission ? `<div class="admin-org-mission"><strong>Mission:</strong> ${org.mission.substring(0, 200)}${org.mission.length > 200 ? '...' : ''}</div>` : ''}
                                    </div>
                                </td>
                            </tr>
                        `).join('') : '<tr><td colspan="7" class="text-center text-muted">No organizations found</td></tr>'}
                    </tbody>
                </table>
            </div>

            ${totalPages > 1 ? `
                <div class="admin-pagination">
                    <button onclick="adminOrgsGoToPage(${adminOrgsPage - 1})" class="admin-btn admin-btn-secondary admin-btn-sm" ${adminOrgsPage <= 1 ? 'disabled' : ''}>← Prev</button>
                    <span class="admin-page-info">Page ${adminOrgsPage} of ${totalPages}</span>
                    <button onclick="adminOrgsGoToPage(${adminOrgsPage + 1})" class="admin-btn admin-btn-secondary admin-btn-sm" ${adminOrgsPage >= totalPages ? 'disabled' : ''}>Next →</button>
                </div>
            ` : ''}
        </div>
    `;

    document.getElementById('adminOrgSearch')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') adminSearchOrgs();
    });
}

// ==================== USAGE & COSTS TAB ====================
async function renderCostsTab(container) {
    const costData = await fetchAdminData('/api/admin/cost-estimate');

    container.innerHTML = `
        <!-- Cost Summary -->
        <div class="admin-stats-grid">
            ${costStatCard('Today', costData.summary.today)}
            ${costStatCard('This Week', costData.summary.week)}
            ${costStatCard('This Month', costData.summary.month)}
            ${costStatCard('All Time', costData.summary.allTime)}
        </div>

        <div class="admin-charts-grid">
            <div class="admin-card">
                <div class="admin-card-header">
                    <h3>Daily API Spend</h3>
                    <span class="admin-card-badge">Last 30 days</span>
                </div>
                <div class="admin-chart-container"><canvas id="costTrendChart"></canvas></div>
            </div>
            <div class="admin-card">
                <div class="admin-card-header">
                    <h3>Cost by Tool</h3>
                    <span class="admin-card-badge">Last 30 days</span>
                </div>
                <div class="admin-chart-container"><canvas id="costByToolChart"></canvas></div>
            </div>
        </div>

        <!-- Cost by Tool Table -->
        <div class="admin-section-row">
            <div class="admin-card admin-card-narrow">
                <div class="admin-card-header"><h3>Cost by Tool (30d)</h3></div>
                <div class="admin-table-container">
                    <table class="admin-table">
                        <thead><tr><th>Tool</th><th>Requests</th><th>Tokens</th><th>Est. Cost</th></tr></thead>
                        <tbody>
                            ${costData.byTool.map(t => `
                                <tr>
                                    <td>${formatToolName(t.tool)}</td>
                                    <td>${parseInt(t.requests).toLocaleString()}</td>
                                    <td>${parseInt(t.tokens).toLocaleString()}</td>
                                    <td class="cost">$${parseFloat(t.cost).toFixed(2)}</td>
                                </tr>
                            `).join('')}
                            <tr class="admin-table-total">
                                <td><strong>Total</strong></td>
                                <td><strong>${costData.byTool.reduce((s, t) => s + parseInt(t.requests), 0).toLocaleString()}</strong></td>
                                <td><strong>${costData.byTool.reduce((s, t) => s + parseInt(t.tokens), 0).toLocaleString()}</strong></td>
                                <td class="cost"><strong>$${costData.byTool.reduce((s, t) => s + parseFloat(t.cost), 0).toFixed(2)}</strong></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
            <div class="admin-card admin-card-narrow">
                <div class="admin-card-header"><h3>Cost by Organization (30d)</h3></div>
                <div class="admin-table-container">
                    <table class="admin-table">
                        <thead><tr><th>Organization</th><th>Requests</th><th>Tokens</th><th>Est. Cost</th></tr></thead>
                        <tbody>
                            ${costData.byOrg.length ? costData.byOrg.map(o => `
                                <tr>
                                    <td>${o.name}</td>
                                    <td>${parseInt(o.requests).toLocaleString()}</td>
                                    <td>${parseInt(o.tokens).toLocaleString()}</td>
                                    <td class="cost">$${parseFloat(o.cost).toFixed(2)}</td>
                                </tr>
                            `).join('') : '<tr><td colspan="4" class="text-center text-muted">No usage data</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <div class="admin-cost-note">
            <strong>Note:</strong> Cost estimates are based on Claude Sonnet 4 pricing ($3/1M input, $15/1M output tokens) with an estimated 40/60 input/output split. Actual costs may vary.
        </div>
    `;

    setTimeout(() => initCostCharts(costData), 100);
}

function initCostCharts(costData) {
    const trendCtx = document.getElementById('costTrendChart');
    if (trendCtx && costData.dailyTrend.length) {
        adminCharts.costTrend = new Chart(trendCtx, {
            type: 'bar',
            data: {
                labels: costData.dailyTrend.map(d => formatDate(d.date)),
                datasets: [{
                    label: 'Est. Cost ($)',
                    data: costData.dailyTrend.map(d => parseFloat(d.cost)),
                    backgroundColor: 'rgba(59, 130, 246, 0.5)',
                    borderColor: '#3B82F6', borderWidth: 1
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, ticks: { callback: v => '$' + v.toFixed(2) } } }
            }
        });
    }

    const toolCtx = document.getElementById('costByToolChart');
    if (toolCtx && costData.byTool.length) {
        const colors = ['#3B82F6', '#6366F1', '#8B5CF6', '#06B6D4', '#10B981'];
        adminCharts.costByTool = new Chart(toolCtx, {
            type: 'doughnut',
            data: {
                labels: costData.byTool.map(t => formatToolName(t.tool)),
                datasets: [{ data: costData.byTool.map(t => parseFloat(t.cost)), backgroundColor: colors, borderWidth: 0 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' } }
            }
        });
    }
}

// ==================== ACTIVITY FEED TAB ====================
async function renderActivityTab(container) {
    const data = await fetchAdminData('/api/admin/recent-activity?limit=30');

    // Merge and sort all activities by time
    const activities = [];
    data.recentSignups.forEach(u => activities.push({
        type: 'signup', time: u.created_at,
        text: `<strong>${u.first_name || ''} ${u.last_name || ''}</strong> signed up`,
        detail: u.email, icon: '🆕'
    }));
    data.recentLogins.forEach(u => activities.push({
        type: 'login', time: u.last_login_at,
        text: `<strong>${u.first_name || ''} ${u.last_name || ''}</strong> logged in`,
        detail: u.email, icon: '🔑'
    }));
    data.recentUsage.forEach(u => activities.push({
        type: 'usage', time: u.created_at,
        text: `<strong>${u.first_name || ''} ${u.last_name || ''}</strong> used <strong>${formatToolName(u.tool)}</strong>`,
        detail: `${u.organization_name || 'No org'} · ${(u.total_tokens || 0).toLocaleString()} tokens`,
        icon: '⚡'
    }));

    activities.sort((a, b) => new Date(b.time) - new Date(a.time));
    const limited = activities.slice(0, 100);

    container.innerHTML = `
        <div class="admin-toolbar">
            <div class="admin-toolbar-left">
                <div class="admin-filter-pills">
                    <button class="admin-filter-pill active" onclick="filterActivity(this, 'all')">All</button>
                    <button class="admin-filter-pill" onclick="filterActivity(this, 'signup')">Signups</button>
                    <button class="admin-filter-pill" onclick="filterActivity(this, 'login')">Logins</button>
                    <button class="admin-filter-pill" onclick="filterActivity(this, 'usage')">Usage</button>
                </div>
            </div>
            <div class="admin-toolbar-right">
                <span class="admin-count">${limited.length} events</span>
            </div>
        </div>

        <div class="admin-card">
            <div class="admin-activity-feed" id="adminActivityFeed">
                ${limited.map(a => `
                    <div class="admin-activity-item" data-type="${a.type}">
                        <span class="admin-activity-icon">${a.icon}</span>
                        <div class="admin-activity-content">
                            <div class="admin-activity-text">${a.text}</div>
                            <div class="admin-activity-detail">${a.detail}</div>
                        </div>
                        <span class="admin-activity-time">${formatTimeAgo(a.time)}</span>
                    </div>
                `).join('')}
                ${limited.length === 0 ? '<div class="text-center text-muted" style="padding:2rem">No activity yet</div>' : ''}
            </div>
        </div>
    `;
}

// ==================== HELPER FUNCTIONS ====================
async function fetchAdminData(endpoint) {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
            'Content-Type': 'application/json'
        }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

function statCard(icon, label, value, change, changeClass, highlight) {
    return `
        <div class="admin-stat-card${highlight ? ' highlight' : ''}">
            <div class="admin-stat-icon">${icon}</div>
            <div class="admin-stat-content">
                <div class="admin-stat-value">${typeof value === 'number' ? value.toLocaleString() : value}</div>
                <div class="admin-stat-label">${label}</div>
                ${change ? `<div class="admin-stat-change ${changeClass || ''}">${change}</div>` : ''}
            </div>
        </div>`;
}

function costStatCard(label, data) {
    return `
        <div class="admin-stat-card">
            <div class="admin-stat-icon">💰</div>
            <div class="admin-stat-content">
                <div class="admin-stat-value">$${data.cost}</div>
                <div class="admin-stat-label">${label}</div>
                <div class="admin-stat-change">${data.tokens.toLocaleString()} tokens</div>
            </div>
        </div>`;
}

function formatToolName(tool) {
    const names = {
        'draft_assistant': 'Draft Assistant',
        'response_assistant': 'Response Assistant',
        'insights_engine': 'Insights Engine',
        'list_normalizer': 'List Normalizer',
        'ask_lightspeed': 'Ask Lightspeed'
    };
    return names[tool] || tool;
}

function formatSubscriptionStatus(status) {
    const names = { 'trialing': 'Trial', 'trial': 'Trial', 'active': 'Active', 'past_due': 'Past Due', 'canceled': 'Canceled', 'cancelled': 'Cancelled', 'incomplete': 'Incomplete' };
    return names[status] || status;
}

function formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateShort(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTimeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return formatDateShort(dateStr);
}

// ==================== INTERACTIVE HANDLERS ====================
function adminSearchUsers() {
    adminUsersSearch = document.getElementById('adminUserSearch')?.value || '';
    adminUsersPage = 1;
    loadAdminTab('users');
}

function adminClearUserSearch() {
    adminUsersSearch = '';
    adminUsersPage = 1;
    loadAdminTab('users');
}

function adminUsersGoToPage(page) {
    adminUsersPage = page;
    loadAdminTab('users');
}

function adminSearchOrgs() {
    adminOrgsSearch = document.getElementById('adminOrgSearch')?.value || '';
    adminOrgsPage = 1;
    loadAdminTab('organizations');
}

function adminClearOrgSearch() {
    adminOrgsSearch = '';
    adminOrgsStatusFilter = '';
    adminOrgsPage = 1;
    loadAdminTab('organizations');
}

function adminFilterOrgStatus(value) {
    adminOrgsStatusFilter = value;
    adminOrgsPage = 1;
    loadAdminTab('organizations');
}

function adminOrgsGoToPage(page) {
    adminOrgsPage = page;
    loadAdminTab('organizations');
}

function toggleOrgDetail(row, orgId) {
    const detailRow = row.nextElementSibling;
    if (detailRow && detailRow.classList.contains('admin-org-detail-row')) {
        detailRow.style.display = detailRow.style.display === 'none' ? 'table-row' : 'none';
    }
}

async function toggleSuperAdmin(userId, makeAdmin) {
    if (!confirm(`Are you sure you want to ${makeAdmin ? 'grant' : 'revoke'} super admin access?`)) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/users/${userId}/super-admin`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ isSuperAdmin: makeAdmin })
        });

        if (response.ok) {
            showToast(`Super admin status updated`, 'success');
            loadAdminTab('users');
        } else {
            const err = await response.json();
            showToast(err.error || 'Failed to update', 'error');
        }
    } catch (error) {
        showToast('Failed to update super admin status', 'error');
    }
}

function filterActivity(btn, type) {
    document.querySelectorAll('.admin-filter-pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');

    document.querySelectorAll('.admin-activity-item').forEach(item => {
        if (type === 'all' || item.dataset.type === type) {
            item.style.display = '';
        } else {
            item.style.display = 'none';
        }
    });
}

// Export admin report
async function exportAdminReport() {
    if (!adminData) {
        showToast('Load the overview tab first', 'error');
        return;
    }

    const blob = new Blob([JSON.stringify(adminData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lightspeed-admin-report-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Report exported!', 'success');
}

// ==================== USER-ORG ASSIGNMENT MODAL ====================

async function fetchAllOrgs() {
    if (adminAllOrgs) return adminAllOrgs;
    const data = await fetchAdminData('/api/admin/organizations-list');
    adminAllOrgs = data.organizations;
    return adminAllOrgs;
}

async function openUserOrgModal(userId, userName, currentOrgId, currentRole) {
    // Fetch orgs list for dropdown
    let orgs;
    try {
        orgs = await fetchAllOrgs();
    } catch (error) {
        showToast('Failed to load organizations', 'error');
        return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'admin-modal-overlay';
    overlay.id = 'userOrgModal';
    overlay.onclick = (e) => { if (e.target === overlay) closeUserOrgModal(); };

    overlay.innerHTML = `
        <div class="admin-modal">
            <div class="admin-modal-header">
                <h3>Manage User Assignment</h3>
                <button class="admin-modal-close" onclick="closeUserOrgModal()">&times;</button>
            </div>
            <div class="admin-modal-body">
                <div class="admin-modal-user-name">${userName.trim() || 'Unnamed User'}</div>

                <div class="admin-modal-field">
                    <label>Organization</label>
                    <select id="modalOrgSelect" class="admin-select admin-select-full">
                        <option value="">-- No Organization --</option>
                        ${orgs.map(org => `
                            <option value="${org.id}" ${org.id === currentOrgId ? 'selected' : ''}>${org.name}</option>
                        `).join('')}
                    </select>
                </div>

                <div class="admin-modal-field">
                    <label>Role</label>
                    <select id="modalRoleSelect" class="admin-select admin-select-full">
                        <option value="member" ${currentRole === 'member' ? 'selected' : ''}>Member</option>
                        <option value="admin" ${currentRole === 'admin' ? 'selected' : ''}>Admin</option>
                        <option value="owner" ${currentRole === 'owner' ? 'selected' : ''}>Owner</option>
                    </select>
                </div>
            </div>
            <div class="admin-modal-footer">
                ${currentOrgId ? `<button class="admin-btn admin-btn-danger admin-btn-sm" onclick="removeUserFromOrg('${userId}')">Remove from Org</button>` : '<div></div>'}
                <div class="admin-modal-footer-right">
                    <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="closeUserOrgModal()">Cancel</button>
                    <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="saveUserOrgAssignment('${userId}')">Save</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    // Trigger animation
    requestAnimationFrame(() => overlay.classList.add('visible'));
}

function closeUserOrgModal() {
    const modal = document.getElementById('userOrgModal');
    if (modal) {
        modal.classList.remove('visible');
        setTimeout(() => modal.remove(), 200);
    }
}

async function saveUserOrgAssignment(userId) {
    const orgId = document.getElementById('modalOrgSelect').value;
    const role = document.getElementById('modalRoleSelect').value;

    if (!orgId) {
        // If no org selected, remove from org
        await removeUserFromOrg(userId);
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/users/${userId}/organization`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ organizationId: orgId, role: role })
        });

        if (response.ok) {
            showToast('User organization updated', 'success');
            closeUserOrgModal();
            adminAllOrgs = null; // invalidate cache
            loadAdminTab('users');
        } else {
            const err = await response.json();
            showToast(err.error || 'Failed to update', 'error');
        }
    } catch (error) {
        showToast('Failed to update user organization', 'error');
    }
}

async function removeUserFromOrg(userId) {
    if (!confirm('Remove this user from their organization?')) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/users/${userId}/organization`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('authToken')}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            showToast('User removed from organization', 'success');
            closeUserOrgModal();
            adminAllOrgs = null;
            loadAdminTab('users');
        } else {
            const err = await response.json();
            showToast(err.error || 'Failed to remove', 'error');
        }
    } catch (error) {
        showToast('Failed to remove user from organization', 'error');
    }
}

// ==================== GLOBAL EXPORTS ====================
window.loadAdminDashboard = loadAdminDashboard;
window.loadAdminTab = loadAdminTab;
window.exportAdminReport = exportAdminReport;
window.initAdminDashboard = initAdminDashboard;
window.adminSearchUsers = adminSearchUsers;
window.adminClearUserSearch = adminClearUserSearch;
window.adminUsersGoToPage = adminUsersGoToPage;
window.adminSearchOrgs = adminSearchOrgs;
window.adminClearOrgSearch = adminClearOrgSearch;
window.adminFilterOrgStatus = adminFilterOrgStatus;
window.adminOrgsGoToPage = adminOrgsGoToPage;
window.toggleOrgDetail = toggleOrgDetail;
window.toggleSuperAdmin = toggleSuperAdmin;
window.filterActivity = filterActivity;
window.openUserOrgModal = openUserOrgModal;
window.closeUserOrgModal = closeUserOrgModal;
window.saveUserOrgAssignment = saveUserOrgAssignment;
window.removeUserFromOrg = removeUserFromOrg;

// Auto-init on page load
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initAdminDashboard, 1000);
});
