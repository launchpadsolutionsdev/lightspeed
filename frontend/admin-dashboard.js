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
let adminOrgSetupData = null; // cached setup data for currently open org

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
                <button onclick="showCreateOrgModal()" class="admin-btn admin-btn-primary admin-btn-sm">+ New Organization</button>
                <span class="admin-count">${data.total} organizations</span>
            </div>
        </div>

        <div class="admin-card">
            <div class="admin-table-container">
                <table class="admin-table admin-table-full">
                    <thead>
                        <tr>
                            <th>Organization</th>
                            <th>Setup</th>
                            <th>Status</th>
                            <th>Members</th>
                            <th>Tokens Used</th>
                            <th>Created</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.organizations.length ? data.organizations.map(org => {
                            const progress = getQuickSetupProgress(org);
                            return `
                            <tr class="admin-org-row">
                                <td class="name">
                                    <strong>${org.name}</strong>
                                    ${org.slug ? `<span class="text-muted small-text">${org.slug}</span>` : ''}
                                </td>
                                <td>
                                    <span class="admin-setup-pill ${progress.done === progress.total ? 'complete' : progress.done >= progress.total / 2 ? 'partial' : 'empty'}" title="${progress.label}">
                                        ${progress.done}/${progress.total}
                                    </span>
                                </td>
                                <td><span class="admin-status-pill admin-status-${org.subscription_status}">${formatSubscriptionStatus(org.subscription_status)}</span></td>
                                <td>${parseInt(org.member_count).toLocaleString()}</td>
                                <td>${org.total_tokens_used ? parseInt(org.total_tokens_used).toLocaleString() : '0'}</td>
                                <td>${formatDateShort(org.created_at)}</td>
                                <td><button class="admin-btn admin-btn-primary admin-btn-sm" onclick="openOrgSetup('${org.id}')">Setup</button></td>
                            </tr>`;
                        }).join('') : '<tr><td colspan="7" class="text-center text-muted">No organizations found</td></tr>'}
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

        <!-- Org Setup Panel (injected when an org is opened) -->
        <div id="adminOrgSetupPanel"></div>
    `;

    document.getElementById('adminOrgSearch')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') adminSearchOrgs();
    });
}

// Quick setup progress from the org list data (no extra API call)
function getQuickSetupProgress(org) {
    let done = 1; // org created
    const total = 7;
    if (org.website_url) done++;
    if (org.licence_number) done++;
    if (org.mission) done++;
    if (org.brand_terminology) done++;
    if (org.email_addons) done++;
    if (org.support_email && org.ceo_name) done++;
    const remaining = total - done;
    const label = remaining === 0 ? 'Setup complete!' : `${remaining} item${remaining > 1 ? 's' : ''} remaining`;
    return { done, total, label };
}

// ==================== CREATE ORG MODAL ====================
function showCreateOrgModal() {
    const overlay = document.createElement('div');
    overlay.className = 'admin-modal-overlay';
    overlay.id = 'createOrgModal';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    overlay.innerHTML = `
        <div class="admin-modal">
            <div class="admin-modal-header">
                <h3>Create New Organization</h3>
                <button class="admin-modal-close" onclick="document.getElementById('createOrgModal').remove()">&times;</button>
            </div>
            <div class="admin-modal-body">
                <div class="admin-modal-field">
                    <label>Organization Name</label>
                    <input type="text" id="newOrgNameInput" class="admin-search-input" placeholder="e.g., ABC Foundation" style="width:100%">
                </div>
            </div>
            <div class="admin-modal-footer">
                <div></div>
                <div class="admin-modal-footer-right">
                    <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="document.getElementById('createOrgModal').remove()">Cancel</button>
                    <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="createOrganization()">Create</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
        overlay.classList.add('visible');
        document.getElementById('newOrgNameInput')?.focus();
    });
    document.getElementById('newOrgNameInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') createOrganization();
    });
}

async function createOrganization() {
    const name = document.getElementById('newOrgNameInput')?.value.trim();
    if (!name) { showToast('Enter an organization name', 'error'); return; }

    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/organizations`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        if (!response.ok) { const err = await response.json(); throw new Error(err.error || 'Failed'); }
        const data = await response.json();
        showToast(`"${name}" created!`, 'success');
        document.getElementById('createOrgModal')?.remove();
        adminAllOrgs = null; // invalidate cache
        // Reload orgs tab then open setup for the new org
        await loadAdminTab('organizations');
        openOrgSetup(data.organization.id);
    } catch (error) {
        showToast('Failed to create organization: ' + error.message, 'error');
    }
}

// ==================== ORG SETUP PANEL ====================
async function openOrgSetup(orgId) {
    const panel = document.getElementById('adminOrgSetupPanel');
    if (!panel) return;

    panel.innerHTML = '<div class="admin-loading" style="padding:2rem"><div class="loading-spinner"></div><p>Loading setup...</p></div>';
    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth' });

    try {
        const setupData = await fetchAdminData(`/api/admin/organizations/${orgId}/setup`);
        adminOrgSetupData = setupData;
        renderOrgSetupPanel(panel, setupData);
    } catch (error) {
        panel.innerHTML = `<div class="admin-error"><p>Failed to load: ${error.message}</p><button onclick="openOrgSetup('${orgId}')" class="admin-btn admin-btn-primary admin-btn-sm">Retry</button></div>`;
    }
}

function renderOrgSetupPanel(panel, data) {
    const org = data.organization;
    const cl = data.checklist;
    const sp = data.setupProgress;

    const checkIcon = (done) => done ? '<span style="color:#16a34a">✓</span>' : '<span style="color:#d1d5db">○</span>';

    // Parse JSON fields safely
    let brandTermNotes = '';
    if (org.brand_terminology) {
        try {
            const bt = typeof org.brand_terminology === 'string' ? JSON.parse(org.brand_terminology) : org.brand_terminology;
            brandTermNotes = (bt.notes || []).join('\n');
        } catch (e) {}
    }
    let emailAddons = {};
    if (org.email_addons) {
        try { emailAddons = typeof org.email_addons === 'string' ? JSON.parse(org.email_addons) : org.email_addons; } catch (e) {}
    }

    panel.innerHTML = `
        <div class="admin-card" style="margin-top: 1rem; border: 2px solid #3B82F6;">
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid #e5e7eb;">
                <div>
                    <h3 style="margin:0; font-size: 1.1rem;">Setup: ${escapeHtmlAdmin(org.name)}</h3>
                    <span class="text-muted" style="font-size: 0.8rem;">ID: ${org.id}</span>
                </div>
                <div style="display:flex; align-items:center; gap:0.75rem;">
                    <span class="admin-setup-pill ${sp.completed === sp.total ? 'complete' : sp.completed >= sp.total / 2 ? 'partial' : 'empty'}" style="font-size:0.85rem; padding: 0.3rem 0.75rem;">
                        ${sp.completed}/${sp.total} Complete
                    </span>
                    <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="document.getElementById('adminOrgSetupPanel').innerHTML=''; document.getElementById('adminOrgSetupPanel').style.display='none';">Close</button>
                </div>
            </div>

            <!-- Onboarding Checklist -->
            <div style="padding: 1rem 1.25rem; background: #f9fafb; border-bottom: 1px solid #e5e7eb;">
                <div style="display: flex; flex-wrap: wrap; gap: 0.5rem 1.5rem; font-size: 0.85rem;">
                    <span>${checkIcon(cl.orgCreated)} Created</span>
                    <span>${checkIcon(cl.websiteSet)} Website</span>
                    <span>${checkIcon(cl.licenceSet)} Licence</span>
                    <span>${checkIcon(cl.missionSet)} Mission</span>
                    <span>${checkIcon(cl.kbPopulated)} KB (${data.kbCount})</span>
                    <span>${checkIcon(cl.templatesImported)} Templates (${data.templateCount})</span>
                    <span>${checkIcon(cl.drawScheduleUploaded)} Draw Schedule</span>
                    <span>${checkIcon(cl.brandTerminologySet)} Brand Rules</span>
                    <span>${checkIcon(cl.emailAddonsSet)} Email Add-Ons</span>
                    <span>${checkIcon(cl.membersAdded)} Members (${data.memberCount})</span>
                </div>
            </div>

            <!-- Profile Section -->
            <div style="padding: 1.25rem;">
                <h4 style="margin: 0 0 1rem 0; font-size: 0.95rem; color: #374151;">Organization Profile</h4>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                    ${orgField('adminOrgName', 'Name', org.name)}
                    ${orgField('adminOrgWebsite', 'Website URL', org.website_url)}
                    ${orgField('adminOrgLicence', 'Licence Number', org.licence_number)}
                    ${orgField('adminOrgSupportEmail', 'Support Email', org.support_email)}
                    ${orgField('adminOrgStoreLocation', 'In-Person Location', org.store_location)}
                    ${orgField('adminOrgCtaWebsite', 'Catch The Ace Website', org.cta_website_url)}
                    ${orgField('adminOrgCeoName', 'CEO/President Name', org.ceo_name)}
                    ${orgField('adminOrgCeoTitle', 'CEO/President Title', org.ceo_title)}
                    ${orgField('adminOrgMediaName', 'Media Contact Name', org.media_contact_name)}
                    ${orgField('adminOrgMediaEmail', 'Media Contact Email', org.media_contact_email)}
                    ${orgField('adminOrgDrawTime', 'Default Draw Time', org.default_draw_time, 'e.g., 11:00 AM')}
                    ${orgField('adminOrgDeadlineTime', 'Ticket Deadline Time', org.ticket_deadline_time, 'e.g., 11:59 PM')}
                </div>
                <div style="margin-top: 0.75rem;">
                    ${orgTextarea('adminOrgMission', 'Mission', org.mission, 2)}
                    ${orgTextarea('adminOrgSocialLine', 'Social Media Required Line', org.social_required_line, 1, 'e.g., Purchase tickets online at www.yoursite.ca!')}
                    ${orgTextarea('adminOrgBrandTerm', 'Brand Terminology Rules (one per line)', brandTermNotes, 2, "e.g., NEVER use 'jackpot' - always use 'Grand Prize'")}
                </div>

                <!-- Email Add-Ons -->
                <div style="border-top: 1px solid #e5e7eb; margin-top: 1rem; padding-top: 1rem;">
                    <h4 style="margin: 0 0 0.75rem 0; font-size: 0.9rem; color: #374151;">Email Add-Ons</h4>
                    ${orgTextarea('adminOrgAddonSub', 'Subscriptions', emailAddons.subscriptions, 2, 'Subscription promo copy...')}
                    ${orgTextarea('adminOrgAddonCTA', 'Catch The Ace', emailAddons.catchTheAce, 2, 'Catch The Ace promo copy...')}
                    ${orgTextarea('adminOrgAddonOther', 'Other Program(s)', emailAddons.other, 2, 'Any additional program or promotion to highlight in emails...')}
                </div>

                <div style="margin-top: 1rem;">
                    <button class="admin-btn admin-btn-primary" onclick="saveAdminOrgProfile('${org.id}')">Save Profile</button>
                </div>
            </div>

            <!-- Knowledge Base Section -->
            <div style="padding: 1.25rem; border-top: 1px solid #e5e7eb;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                    <h4 style="margin: 0; font-size: 0.95rem; color: #374151;">Knowledge Base <span class="text-muted" style="font-weight:400;">(${data.kbCount} entries)</span></h4>
                    <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="toggleAdminKBForm('${org.id}')">+ Add Entry</button>
                </div>

                <!-- Add KB Form (hidden) -->
                <div id="adminKBForm" style="display:none; border: 1px solid #d1d5db; border-radius: 8px; padding: 0.75rem; margin-bottom: 0.75rem;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-bottom: 0.5rem;">
                        <input type="text" id="adminKBTitle" class="admin-search-input" placeholder="Title / Question" style="width:100%">
                        <select id="adminKBCategory" class="admin-select" style="width:100%">
                            <option value="faqs">FAQ</option>
                            <option value="policies">Policy</option>
                            <option value="products">Product</option>
                            <option value="other">Other</option>
                        </select>
                    </div>
                    <textarea id="adminKBContent" class="admin-search-input" rows="3" placeholder="Content / Answer" style="width:100%; resize:vertical;"></textarea>
                    <div style="margin-top: 0.5rem; display: flex; gap: 0.5rem;">
                        <button class="admin-btn admin-btn-primary admin-btn-sm" onclick="addAdminKBEntry('${org.id}')">Add</button>
                        <button class="admin-btn admin-btn-secondary admin-btn-sm" onclick="document.getElementById('adminKBForm').style.display='none'">Cancel</button>
                    </div>
                </div>

                <div id="adminKBList" style="max-height: 300px; overflow-y: auto;">
                    <div class="text-muted" style="padding: 0.5rem; font-size: 0.85rem;">Loading KB entries...</div>
                </div>
            </div>

            <!-- Content Templates Section -->
            <div style="padding: 1.25rem; border-top: 1px solid #e5e7eb;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                    <h4 style="margin: 0; font-size: 0.95rem; color: #374151;">Content Templates <span class="text-muted" style="font-weight:400;">(${data.templateCount} templates)</span></h4>
                </div>
                <div id="adminTemplateList" style="max-height: 200px; overflow-y: auto;">
                    <div class="text-muted" style="padding: 0.5rem; font-size: 0.85rem;">Loading templates...</div>
                </div>
            </div>

            <!-- Draw Schedule Section -->
            <div style="padding: 1.25rem; border-top: 1px solid #e5e7eb;">
                <h4 style="margin: 0 0 0.5rem 0; font-size: 0.95rem; color: #374151;">Draw Schedule</h4>
                ${data.drawSchedule
                    ? `<div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 0.75rem;">
                        <span style="color: #16a34a; font-weight: 600;">${escapeHtmlAdmin(data.drawSchedule.draw_name)}</span>
                        <span class="text-muted" style="margin-left: 0.5rem; font-size: 0.8rem;">Active</span>
                       </div>`
                    : `<div style="color: #9ca3af; font-size: 0.9rem;">No draw schedule uploaded. The org admin can upload one from their Settings tab.</div>`
                }
            </div>
        </div>
    `;

    // Load KB entries and templates
    loadAdminKBEntries(org.id);
    loadAdminTemplateList(org.id);
}

function orgField(id, label, value, placeholder) {
    return `
        <div>
            <label style="font-size: 0.8rem; color: #6b7280; display: block; margin-bottom: 0.2rem;">${label}</label>
            <input type="text" id="${id}" class="admin-search-input" value="${escapeAttr(value || '')}" placeholder="${placeholder || ''}" style="width:100%">
        </div>`;
}

function orgTextarea(id, label, value, rows, placeholder) {
    return `
        <div style="margin-bottom: 0.5rem;">
            <label style="font-size: 0.8rem; color: #6b7280; display: block; margin-bottom: 0.2rem;">${label}</label>
            <textarea id="${id}" class="admin-search-input" rows="${rows || 2}" placeholder="${placeholder || ''}" style="width:100%; resize:vertical;">${escapeHtmlAdmin(value || '')}</textarea>
        </div>`;
}

function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlAdmin(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ==================== SAVE ORG PROFILE (ADMIN) ====================
async function saveAdminOrgProfile(orgId) {
    const v = (id) => document.getElementById(id)?.value?.trim() || '';

    // Build brand terminology JSON
    const brandTermRaw = v('adminOrgBrandTerm');
    let brandTerminology = null;
    if (brandTermRaw) {
        brandTerminology = JSON.stringify({ notes: brandTermRaw.split('\n').map(l => l.trim()).filter(Boolean) });
    }

    // Build email add-ons JSON
    const subText = v('adminOrgAddonSub');
    const ctaText = v('adminOrgAddonCTA');
    const otherText = v('adminOrgAddonOther');
    let emailAddons = null;
    if (subText || ctaText || otherText) {
        const obj = {};
        if (subText) obj.subscriptions = subText;
        if (ctaText) obj.catchTheAce = ctaText;
        if (otherText) obj.other = otherText;
        emailAddons = JSON.stringify(obj);
    }

    const payload = {
        name: v('adminOrgName') || undefined,
        websiteUrl: v('adminOrgWebsite') || null,
        licenceNumber: v('adminOrgLicence') || null,
        supportEmail: v('adminOrgSupportEmail') || null,
        storeLocation: v('adminOrgStoreLocation') || null,
        ctaWebsiteUrl: v('adminOrgCtaWebsite') || null,
        ceoName: v('adminOrgCeoName') || null,
        ceoTitle: v('adminOrgCeoTitle') || null,
        mediaContactName: v('adminOrgMediaName') || null,
        mediaContactEmail: v('adminOrgMediaEmail') || null,
        defaultDrawTime: v('adminOrgDrawTime') || null,
        ticketDeadlineTime: v('adminOrgDeadlineTime') || null,
        mission: v('adminOrgMission') || null,
        socialRequiredLine: v('adminOrgSocialLine') || null,
        brandTerminology,
        emailAddons
    };

    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/organizations/${orgId}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) { const err = await response.json(); throw new Error(err.error || 'Failed'); }
        showToast('Profile saved!', 'success');
        // Reload setup panel to refresh checklist
        openOrgSetup(orgId);
    } catch (error) {
        showToast('Failed to save: ' + error.message, 'error');
    }
}

// ==================== ADMIN KB MANAGEMENT ====================
function toggleAdminKBForm(orgId) {
    const form = document.getElementById('adminKBForm');
    if (form) {
        form.style.display = form.style.display === 'none' ? 'block' : 'none';
        if (form.style.display === 'block') {
            document.getElementById('adminKBTitle').value = '';
            document.getElementById('adminKBContent').value = '';
            document.getElementById('adminKBTitle')?.focus();
        }
    }
}

async function loadAdminKBEntries(orgId) {
    const container = document.getElementById('adminKBList');
    if (!container) return;

    try {
        const data = await fetchAdminData(`/api/admin/organizations/${orgId}/knowledge-base`);
        const entries = data.entries || [];

        if (entries.length === 0) {
            container.innerHTML = '<div style="padding: 0.75rem; text-align: center; color: #9ca3af; font-size: 0.85rem;">No knowledge base entries yet.</div>';
            return;
        }

        container.innerHTML = entries.map(e => {
            const isFromFeedback = (e.tags || []).includes('source:feedback');
            return `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; padding: 0.5rem 0; border-bottom: 1px solid #f3f4f6;">
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
                        <strong style="font-size: 0.85rem;">${escapeHtmlAdmin(e.title)}</strong>
                        <span style="font-size: 0.65rem; background: #f3f4f6; padding: 0.1rem 0.3rem; border-radius: 3px; color: #6b7280;">${e.category}</span>
                        ${isFromFeedback ? '<span style="font-size: 0.6rem; background: #fef3c7; color: #92400e; padding: 0.1rem 0.35rem; border-radius: 3px; font-weight: 600;">From feedback</span>' : ''}
                    </div>
                    <div style="font-size: 0.8rem; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtmlAdmin((e.content || '').substring(0, 120))}</div>
                </div>
                <button class="admin-btn admin-btn-secondary admin-btn-sm" style="color:#dc2626; border-color:#fecaca; flex-shrink:0; margin-left:0.5rem; font-size:0.7rem; padding:0.15rem 0.4rem;" onclick="deleteAdminKBEntry('${orgId}','${e.id}')">Delete</button>
            </div>`;
        }).join('');
    } catch (error) {
        container.innerHTML = '<div style="padding: 0.5rem; color: #ef4444; font-size: 0.85rem;">Failed to load KB entries</div>';
    }
}

async function addAdminKBEntry(orgId) {
    const title = document.getElementById('adminKBTitle')?.value.trim();
    const content = document.getElementById('adminKBContent')?.value.trim();
    const category = document.getElementById('adminKBCategory')?.value || 'faqs';

    if (!title || !content) { showToast('Title and content are required', 'error'); return; }

    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/organizations/${orgId}/knowledge-base`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, content, category })
        });
        if (!response.ok) throw new Error('Failed');
        showToast('KB entry added!', 'success');
        document.getElementById('adminKBForm').style.display = 'none';
        loadAdminKBEntries(orgId);
        // Update count in the header
        const countEl = document.querySelector('#adminOrgSetupPanel h4 .text-muted');
        if (adminOrgSetupData) {
            adminOrgSetupData.kbCount++;
        }
    } catch (error) {
        showToast('Failed to add entry: ' + error.message, 'error');
    }
}

async function deleteAdminKBEntry(orgId, entryId) {
    if (!confirm('Delete this KB entry?')) return;
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/organizations/${orgId}/knowledge-base/${entryId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}`, 'Content-Type': 'application/json' }
        });
        if (!response.ok) throw new Error('Failed');
        showToast('Entry deleted', 'success');
        loadAdminKBEntries(orgId);
    } catch (error) {
        showToast('Failed to delete: ' + error.message, 'error');
    }
}

// ==================== ADMIN TEMPLATE MANAGEMENT ====================
async function loadAdminTemplateList(orgId) {
    const container = document.getElementById('adminTemplateList');
    if (!container) return;

    try {
        const data = await fetchAdminData(`/api/admin/organizations/${orgId}/content-templates`);
        const templates = data.templates || [];

        if (templates.length === 0) {
            container.innerHTML = '<div style="padding: 0.75rem; text-align: center; color: #9ca3af; font-size: 0.85rem;">No content templates. Click "Import All from Library" to seed templates.</div>';
            return;
        }

        // Group by type
        const grouped = {};
        templates.forEach(t => {
            const type = t.template_type;
            if (!grouped[type]) grouped[type] = [];
            grouped[type].push(t);
        });

        const typeLabels = {
            'social': 'Social Media', 'email-new-draw': 'Email: New Draw', 'email-reminder': 'Email: Reminder',
            'email-winners': 'Email: Winners', 'email-impact': 'Email: Impact', 'email-last-chance': 'Email: Last Chance',
            'media-release': 'Media Release', 'social-ads': 'Social Ads'
        };

        container.innerHTML = Object.entries(grouped).map(([type, items]) => `
            <div style="margin-bottom: 0.5rem;">
                <div style="font-size: 0.75rem; font-weight: 600; color: #6b7280; text-transform: uppercase; margin-bottom: 0.2rem;">${typeLabels[type] || type} (${items.length})</div>
                ${items.map(t => `
                    <div style="font-size: 0.8rem; color: #374151; padding: 0.15rem 0; padding-left: 0.75rem;">- ${escapeHtmlAdmin(t.name)}</div>
                `).join('')}
            </div>
        `).join('');
    } catch (error) {
        container.innerHTML = '<div style="padding: 0.5rem; color: #ef4444; font-size: 0.85rem;">Failed to load templates</div>';
    }
}

async function adminImportAllTemplates(orgId) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/organizations/${orgId}/content-templates/import-all`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken')}`, 'Content-Type': 'application/json' }
        });
        if (!response.ok) throw new Error('Failed');
        const data = await response.json();
        showToast(`${data.count} templates imported!`, 'success');
        loadAdminTemplateList(orgId);
    } catch (error) {
        showToast('Failed to import: ' + error.message, 'error');
    }
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
window.toggleSuperAdmin = toggleSuperAdmin;
window.filterActivity = filterActivity;
window.openUserOrgModal = openUserOrgModal;
window.closeUserOrgModal = closeUserOrgModal;
window.saveUserOrgAssignment = saveUserOrgAssignment;
window.removeUserFromOrg = removeUserFromOrg;
// Org setup exports
window.showCreateOrgModal = showCreateOrgModal;
window.createOrganization = createOrganization;
window.openOrgSetup = openOrgSetup;
window.saveAdminOrgProfile = saveAdminOrgProfile;
window.toggleAdminKBForm = toggleAdminKBForm;
window.addAdminKBEntry = addAdminKBEntry;
window.deleteAdminKBEntry = deleteAdminKBEntry;
window.adminImportAllTemplates = adminImportAllTemplates;

// Auto-init on page load
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initAdminDashboard, 1000);
});
