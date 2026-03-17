/**
 * Shopify Analytics Dashboard
 * Reads from local pre-computed API — loads instantly.
 */

(function () {
    'use strict';

    const API_BASE = window.API_BASE || (
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
            ? 'http://localhost:3001'
            : 'https://lightspeed-backend.onrender.com'
    );
    let sdCharts = {};
    let sdCurrentPreset = 'last_30_days';
    let sdCompare = false;
    let sdCurrency = 'CAD';
    let sdRefreshTimer = null;
    let sdSalesMetric = 'net_sales'; // net_sales | gross_sales | orders
    let sdCustomStartDate = '';
    let sdCustomEndDate = '';
    let sdSearchDebounce = null;
    let sdAlsConversation = [];
    let sdAlsStreaming = false;

    // ─── Helpers ────────────────────────────────────────────────────

    function sdAuthHeaders() {
        const token = localStorage.getItem('authToken') || localStorage.getItem('token');
        return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    }

    async function sdFetch(endpoint, params = {}) {
        const qs = new URLSearchParams(params).toString();
        const url = `${API_BASE}/api/dashboard/${endpoint}${qs ? '?' + qs : ''}`;
        const resp = await fetch(url, { headers: sdAuthHeaders() });
        if (!resp.ok) throw new Error(`API error: ${resp.status}`);
        return resp.json();
    }

    function sdFormatCurrency(amount) {
        return new Intl.NumberFormat('en-CA', { style: 'currency', currency: sdCurrency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
    }

    function sdFormatCurrencyFull(amount) {
        return new Intl.NumberFormat('en-CA', { style: 'currency', currency: sdCurrency }).format(amount);
    }

    function sdFormatNumber(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return n.toLocaleString();
    }

    function sdFormatPct(v) {
        if (v === null || v === undefined) return '';
        const sign = v > 0 ? '+' : '';
        return `${sign}${v.toFixed(1)}%`;
    }

    function sdTimeAgo(dateStr) {
        if (!dateStr) return '';
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'Just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        const days = Math.floor(hrs / 24);
        return `${days}d ago`;
    }

    function sdGetDateParams() {
        if (sdCurrentPreset === 'custom' && sdCustomStartDate && sdCustomEndDate) {
            const params = { start_date: sdCustomStartDate, end_date: sdCustomEndDate };
            if (sdCompare) params.compare = 'previous_period';
            return params;
        }
        const params = { preset: sdCurrentPreset };
        if (sdCompare) params.compare = 'previous_period';
        return params;
    }

    function sdStatusBadge(status, type) {
        if (!status) return '';
        const s = status.toLowerCase().replace(/_/g, '');
        let cls = '';
        if (type === 'financial') {
            if (s === 'paid' || s === 'authorized') cls = 'sd-badge-paid';
            else if (s === 'pending') cls = 'sd-badge-pending';
            else if (s.includes('refund')) cls = 'sd-badge-refunded';
            else cls = 'sd-badge-pending';
        } else {
            if (s === 'fulfilled') cls = 'sd-badge-fulfilled';
            else if (s === 'partial' || s.includes('partial')) cls = 'sd-badge-partial';
            else cls = 'sd-badge-unfulfilled';
        }
        const label = status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return `<span class="sd-order-badge ${cls}">${label}</span>`;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function sdGetInitials(name) {
        if (!name) return '?';
        return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    }

    // ─── Skeleton Loaders ───────────────────────────────────────────

    function sdShowSkeletons() {
        const kpiRow = document.getElementById('sdKpiRow');
        if (kpiRow) {
            kpiRow.innerHTML = Array(4).fill('<div class="sd-kpi-card"><div class="sd-skeleton sd-skeleton-kpi"></div></div>').join('');
        }

        const chartWrap = document.getElementById('sdSalesChartWrap');
        if (chartWrap) chartWrap.innerHTML = '<div class="sd-skeleton sd-skeleton-chart"></div>';

        const tableWrap = document.getElementById('sdProductsTableWrap');
        if (tableWrap) tableWrap.innerHTML = Array(5).fill('<div class="sd-skeleton sd-skeleton-row"></div>').join('');

        const feedWrap = document.getElementById('sdOrderFeedWrap');
        if (feedWrap) feedWrap.innerHTML = Array(5).fill('<div class="sd-skeleton sd-skeleton-row"></div>').join('');

        const custWrap = document.getElementById('sdTopCustomersWrap');
        if (custWrap) custWrap.innerHTML = Array(5).fill('<div class="sd-skeleton sd-skeleton-row"></div>').join('');

        const cityWrap = document.getElementById('sdCityWrap');
        if (cityWrap) cityWrap.innerHTML = Array(5).fill('<div class="sd-skeleton sd-skeleton-row"></div>').join('');

    }

    // ─── Data Loading ───────────────────────────────────────────────

    async function sdLoadDashboard() {
        sdShowSkeletons();

        // Load sync status first to check connection
        try {
            const syncStatus = await sdFetch('sync-status');
            sdUpdateSyncIndicator(syncStatus);
            if (!syncStatus.connected) {
                sdShowEmptyState();
                return;
            }
            sdCurrency = syncStatus.currency || 'CAD';

            // If never synced, trigger initial sync
            if (!syncStatus.last_full_sync && syncStatus.sync_status !== 'syncing') {
                sdTriggerSync();
            }
        } catch {
            sdShowEmptyState();
            return;
        }

        // Load all data in parallel
        const params = sdGetDateParams();
        const [summary, salesTime, products, orders, customers, cities] = await Promise.allSettled([
            sdFetch('summary', params),
            sdFetch('sales-over-time', params),
            sdFetch('top-products', params),
            sdFetch('recent-orders', { limit: 20 }),
            sdFetch('top-customers', { limit: 10 }),
            sdFetch('sales-by-city', params),
        ]);

        if (summary.status === 'fulfilled') sdRenderKPIs(summary.value);
        if (salesTime.status === 'fulfilled') sdRenderSalesChart(salesTime.value);
        if (products.status === 'fulfilled') sdRenderProductsTable(products.value);
        if (orders.status === 'fulfilled') sdRenderOrderFeed(orders.value);
        if (customers.status === 'fulfilled') sdRenderTopCustomers(customers.value);
        if (cities.status === 'fulfilled') sdRenderCityBreakdown(cities.value);

        // Load AI insights (separate, slower call)
        sdLoadInsights();

        // Auto-refresh orders every 30s
        if (sdRefreshTimer) clearInterval(sdRefreshTimer);
        sdRefreshTimer = setInterval(sdRefreshOrders, 30000);
    }

    // ─── Render: KPI Cards ──────────────────────────────────────────

    function sdRenderKPIs(data) {
        const kpiRow = document.getElementById('sdKpiRow');
        if (!kpiRow) return;

        const cp = data.current_period;
        const changes = data.changes || {};

        const cards = [
            { label: 'Total Sales', value: sdFormatCurrency(cp.total_sales), change: changes.total_sales_pct },
            { label: 'Total Orders', value: sdFormatNumber(cp.total_orders), change: changes.total_orders_pct },
            { label: 'Avg Order Value', value: sdFormatCurrencyFull(cp.average_order_value), change: changes.average_order_value_pct },
            { label: 'Returning Rate', value: Math.round(cp.returning_customer_rate * 100) + '%', change: changes.returning_customer_rate_pct },
        ];

        kpiRow.innerHTML = cards.map(card => {
            let changeHtml = '';
            if (card.change !== undefined && card.change !== null && sdCompare) {
                const cls = card.change > 0 ? 'positive' : card.change < 0 ? 'negative' : 'neutral';
                const arrow = card.change > 0 ? '&#9650;' : card.change < 0 ? '&#9660;' : '';
                changeHtml = `<div class="sd-kpi-change ${cls}">${arrow} ${sdFormatPct(card.change)} vs prev period</div>`;
            }
            return `<div class="sd-kpi-card">
                <div class="sd-kpi-label">${card.label}</div>
                <div class="sd-kpi-value">${card.value}</div>
                ${changeHtml}
            </div>`;
        }).join('');
    }

    // ─── Render: Sales Over Time Chart ──────────────────────────────

    function sdRenderSalesChart(data) {
        const wrap = document.getElementById('sdSalesChartWrap');
        if (!wrap) return;

        wrap.innerHTML = '<canvas id="sdSalesCanvas"></canvas>';
        const ctx = document.getElementById('sdSalesCanvas').getContext('2d');

        const labels = data.data.map(d => {
            const date = new Date(d.date + 'T00:00:00');
            return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
        });

        let values, label;
        if (sdSalesMetric === 'orders') {
            values = data.data.map(d => d.orders);
            label = 'Orders';
        } else if (sdSalesMetric === 'gross_sales') {
            values = data.data.map(d => d.gross_sales);
            label = 'Gross Sales';
        } else {
            values = data.data.map(d => d.net_sales);
            label = 'Net Sales';
        }

        if (sdCharts.sales) sdCharts.sales.destroy();
        sdCharts.sales = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label,
                    data: values,
                    borderColor: '#635BFF',
                    backgroundColor: 'rgba(99, 91, 255, 0.08)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    borderWidth: 2,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (ctx) {
                                if (sdSalesMetric === 'orders') return `${ctx.parsed.y.toLocaleString()} orders`;
                                return sdFormatCurrencyFull(ctx.parsed.y);
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { maxTicksLimit: 10, font: { size: 11 }, color: '#6B7C93' },
                    },
                    y: {
                        grid: { color: '#E3E8EE' },
                        ticks: {
                            font: { size: 11 },
                            color: '#6B7C93',
                            callback: function (v) {
                                if (sdSalesMetric === 'orders') return sdFormatNumber(v);
                                return sdFormatCurrency(v);
                            },
                        },
                    },
                },
            },
        });
    }

    // ─── Render: Products Table ─────────────────────────────────────

    function sdCleanProductTitle(title) {
        if (!title) return 'Unknown';
        // Clean up titles like "Product for 700" → "Product - $7.00" or "Gift Card for 50" → "Gift Card - $50"
        const match = title.match(/^(.+?)\s+for\s+(\d+)$/i);
        if (match) {
            const name = match[1].trim();
            const val = parseInt(match[2]);
            // Determine if value is cents or dollars based on magnitude
            const price = val >= 1000 ? val / 100 : val;
            return `${name} - ${sdFormatCurrency(price)}`;
        }
        return title;
    }

    function sdRenderProductsTable(data) {
        const wrap = document.getElementById('sdProductsTableWrap');
        if (!wrap) return;

        if (!data.products || data.products.length === 0) {
            wrap.innerHTML = '<div style="text-align:center;padding:20px;color:#6B7C93;font-size:13px;">No product data for this period</div>';
            return;
        }

        const rows = data.products.map((p, i) => `
            <tr>
                <td class="sd-rank">${i + 1}</td>
                <td>${escapeHtml(sdCleanProductTitle(p.title))}</td>
                <td class="sd-amount">${sdFormatCurrencyFull(p.revenue)}</td>
                <td style="text-align:right">${p.units_sold.toLocaleString()}</td>
                <td class="sd-pct">${p.pct_of_total}%</td>
            </tr>
        `).join('');

        wrap.innerHTML = `<table class="sd-table">
            <thead><tr>
                <th>#</th>
                <th>Product</th>
                <th style="text-align:right">Revenue</th>
                <th style="text-align:right">Units</th>
                <th style="text-align:right">% Total</th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    }

    // ─── Render: Channel Donut ──────────────────────────────────────

    function sdRenderChannelChart(data) {
        const wrap = document.getElementById('sdChannelChartWrap');
        if (!wrap) return;

        if (!data.channels || data.channels.length === 0) {
            wrap.innerHTML = '<div style="text-align:center;padding:40px;color:#6B7C93;font-size:13px;">No channel data</div>';
            return;
        }

        wrap.innerHTML = '<canvas id="sdChannelCanvas"></canvas>';
        const ctx = document.getElementById('sdChannelCanvas').getContext('2d');

        const colors = ['#635BFF', '#E91E8C', '#F47B3A', '#F5C623', '#30B130', '#47C1BF', '#0A2540', '#6B7C93'];

        if (sdCharts.channel) sdCharts.channel.destroy();
        sdCharts.channel = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: data.channels.map(c => c.channel || 'Unknown'),
                datasets: [{
                    data: data.channels.map(c => c.revenue),
                    backgroundColor: colors.slice(0, data.channels.length),
                    borderWidth: 2,
                    borderColor: '#fff',
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12 } },
                    tooltip: {
                        callbacks: {
                            label: function (ctx) {
                                return `${ctx.label}: ${sdFormatCurrencyFull(ctx.parsed)}`;
                            },
                        },
                    },
                },
            },
        });
    }

    // ─── Render: Region Bars ────────────────────────────────────────

    function sdRenderRegionBars(data) {
        const wrap = document.getElementById('sdRegionWrap');
        if (!wrap) return;

        if (!data.regions || data.regions.length === 0) {
            wrap.innerHTML = '<div style="text-align:center;padding:20px;color:#6B7C93;font-size:13px;">No region data</div>';
            return;
        }

        const maxRev = Math.max(...data.regions.map(r => r.revenue));

        wrap.innerHTML = data.regions.map(r => {
            const pct = maxRev > 0 ? (r.revenue / maxRev * 100) : 0;
            const label = r.province && r.province !== 'Unknown' ? r.province : r.country;
            return `<div class="sd-region-bar">
                <div class="sd-region-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
                <div class="sd-region-track"><div class="sd-region-fill" style="width:${pct}%"></div></div>
                <div class="sd-region-value">${sdFormatCurrency(r.revenue)}</div>
            </div>`;
        }).join('');
    }

    // ─── Render: Order Feed ─────────────────────────────────────────

    function sdRenderOrderFeed(data) {
        const wrap = document.getElementById('sdOrderFeedWrap');
        if (!wrap) return;

        if (!data.orders || data.orders.length === 0) {
            wrap.innerHTML = '<div style="text-align:center;padding:20px;color:#6B7C93;font-size:13px;">No recent orders</div>';
            return;
        }

        wrap.innerHTML = '<div class="sd-order-feed">' + data.orders.map(o => `
            <div class="sd-order-item">
                <div class="sd-order-info">
                    <div class="sd-order-number">${escapeHtml(o.order_number || '--')}</div>
                    <div class="sd-order-customer">${escapeHtml(o.customer_name || 'Guest')}</div>
                </div>
                <div style="text-align:right">
                    <div class="sd-order-amount">${sdFormatCurrencyFull(o.total_price)}</div>
                    <div class="sd-order-time">${sdTimeAgo(o.created_at)}</div>
                </div>
                <div>${sdStatusBadge(o.financial_status, 'financial')}</div>
            </div>
        `).join('') + '</div>';
    }

    // ─── Render: Top Customers ──────────────────────────────────────

    function sdRenderTopCustomers(data) {
        const wrap = document.getElementById('sdTopCustomersWrap');
        if (!wrap) return;

        if (!data.customers || data.customers.length === 0) {
            wrap.innerHTML = '<div style="text-align:center;padding:20px;color:#6B7C93;font-size:13px;">No customer data yet</div>';
            return;
        }

        wrap.innerHTML = data.customers.map(c => `
            <div class="sd-customer-row">
                <div class="sd-avatar">${sdGetInitials(c.customer_name)}</div>
                <div class="sd-customer-info">
                    <div class="sd-customer-name">${escapeHtml(c.customer_name || c.customer_email || 'Unknown')}</div>
                    <div class="sd-customer-meta">${c.order_count} order${c.order_count !== 1 ? 's' : ''} &middot; Last: ${sdTimeAgo(c.last_order_at)}</div>
                </div>
                <div class="sd-customer-amount">${sdFormatCurrencyFull(c.total_spent)}</div>
            </div>
        `).join('');
    }

    // ─── Render: Sales by City ──────────────────────────────────────

    function sdRenderCityBreakdown(data) {
        const wrap = document.getElementById('sdCityWrap');
        if (!wrap) return;

        if (!data.cities || data.cities.length === 0) {
            wrap.innerHTML = '<div style="text-align:center;padding:20px;color:#6B7C93;font-size:13px;">No city data</div>';
            return;
        }

        const maxRev = Math.max(...data.cities.map(c => c.revenue));

        wrap.innerHTML = data.cities.map(c => {
            const pct = maxRev > 0 ? (c.revenue / maxRev * 100) : 0;
            const label = c.city + (c.province ? `, ${c.province}` : '');
            return `<div class="sd-region-bar">
                <div class="sd-region-label" title="${escapeHtml(label)}">${escapeHtml(c.city || 'Unknown')}</div>
                <div class="sd-region-track"><div class="sd-region-fill" style="width:${pct}%"></div></div>
                <div class="sd-region-value">${sdFormatCurrency(c.revenue)}</div>
            </div>`;
        }).join('');
    }

    // ─── Render: Price Points ───────────────────────────────────────

    function sdRenderPricePoints(data) {
        const wrap = document.getElementById('sdPricePointsWrap');
        if (!wrap) return;

        if (!data.buckets || data.buckets.length === 0) {
            wrap.innerHTML = '<div style="text-align:center;padding:40px;color:#6B7C93;font-size:13px;">No price point data</div>';
            return;
        }

        wrap.innerHTML = '<canvas id="sdPriceCanvas"></canvas>';
        const ctx = document.getElementById('sdPriceCanvas').getContext('2d');

        const colors = ['#635BFF', '#E91E8C', '#F47B3A', '#F5C623', '#30B130', '#47C1BF'];

        if (sdCharts.pricePoints) sdCharts.pricePoints.destroy();
        sdCharts.pricePoints = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.buckets.map(b => b.bucket),
                datasets: [{
                    label: 'Revenue',
                    data: data.buckets.map(b => b.revenue),
                    backgroundColor: colors.slice(0, data.buckets.length),
                    borderRadius: 6,
                    borderSkipped: false,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (ctx) {
                                return `Revenue: ${sdFormatCurrencyFull(ctx.parsed.y)}`;
                            },
                            afterLabel: function (ctx) {
                                const b = data.buckets[ctx.dataIndex];
                                return b ? `${b.units_sold} units sold` : '';
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: { font: { size: 11 }, color: '#6B7C93' },
                    },
                    y: {
                        grid: { color: '#E3E8EE' },
                        ticks: {
                            font: { size: 11 },
                            color: '#6B7C93',
                            callback: function (v) { return sdFormatCurrency(v); },
                        },
                    },
                },
            },
        });
    }

    // ─── AI Insights ────────────────────────────────────────────────

    async function sdLoadInsights() {
        const wrap = document.getElementById('sdInsightsWrap');
        if (!wrap) return;

        wrap.innerHTML = '<div class="sd-insight-loading">Analyzing your data...</div>';

        try {
            const params = sdGetDateParams();
            const data = await sdFetch('ai-insights', params);

            if (!data.insights || data.insights.length === 0) {
                wrap.innerHTML = '<div style="text-align:center;padding:20px;color:#6B7C93;font-size:13px;">No insights available for this period</div>';
                return;
            }

            const iconMap = {
                revenue: '&#128200;',
                trend: '&#128200;',
                aov: '&#128176;',
                retention: '&#128101;',
                product: '&#11088;',
                region: '&#127758;',
                whale: '&#128051;',
                refund: '&#9888;&#65039;',
            };

            wrap.innerHTML = '<div class="sd-insights-list">' + data.insights.map(insight => {
                const icon = iconMap[insight.type] || '&#128161;';
                return `<div class="sd-insight-item">
                    <div class="sd-insight-icon">${icon}</div>
                    <div class="sd-insight-text">${insight.text}</div>
                </div>`;
            }).join('') + '</div>';
        } catch {
            wrap.innerHTML = '<div style="text-align:center;padding:20px;color:#6B7C93;font-size:13px;">Unable to generate insights</div>';
        }
    }

    // ─── Order Search ───────────────────────────────────────────────

    async function sdSearchOrders(query) {
        const resultsPanel = document.getElementById('sdSearchResults');
        const resultsWrap = document.getElementById('sdSearchResultsWrap');
        if (!resultsPanel || !resultsWrap) return;

        if (!query || query.length < 2) {
            resultsPanel.style.display = 'none';
            return;
        }

        resultsPanel.style.display = 'block';
        resultsWrap.innerHTML = '<div class="sd-skeleton sd-skeleton-row"></div><div class="sd-skeleton sd-skeleton-row"></div>';

        try {
            const data = await sdFetch('search-orders', { q: query });

            if (!data.orders || data.orders.length === 0) {
                resultsWrap.innerHTML = '<div style="text-align:center;padding:20px;color:#6B7C93;font-size:13px;">No orders found</div>';
                return;
            }

            resultsWrap.innerHTML = '<div class="sd-order-feed">' + data.orders.map(o => `
                <div class="sd-order-item">
                    <div class="sd-order-info">
                        <div class="sd-order-number">${escapeHtml(o.order_number || '--')}</div>
                        <div class="sd-order-customer">${escapeHtml(o.customer_name || 'Guest')} &middot; ${escapeHtml(o.customer_email || '')}</div>
                    </div>
                    <div style="text-align:right">
                        <div class="sd-order-amount">${sdFormatCurrencyFull(o.total_price)}</div>
                        <div class="sd-order-time">${sdTimeAgo(o.created_at)}</div>
                    </div>
                    <div>${sdStatusBadge(o.financial_status, 'financial')}</div>
                </div>
            `).join('') + '</div>';
        } catch {
            resultsWrap.innerHTML = '<div style="text-align:center;padding:20px;color:#6B7C93;font-size:13px;">Search failed</div>';
        }
    }

    // ─── Export ──────────────────────────────────────────────────────

    function sdExportCSV() {
        // Gather all visible data from the DOM tables
        const tables = document.querySelectorAll('#sdDashboardContent .sd-table');
        let csv = '';

        tables.forEach(table => {
            const rows = table.querySelectorAll('tr');
            rows.forEach(row => {
                const cells = row.querySelectorAll('th, td');
                const values = Array.from(cells).map(c => '"' + c.textContent.trim().replace(/"/g, '""') + '"');
                csv += values.join(',') + '\n';
            });
            csv += '\n';
        });

        // Also export KPI values
        const kpis = document.querySelectorAll('.sd-kpi-card');
        if (kpis.length) {
            csv += 'KPI,Value\n';
            kpis.forEach(card => {
                const label = card.querySelector('.sd-kpi-label');
                const value = card.querySelector('.sd-kpi-value');
                if (label && value) {
                    csv += `"${label.textContent.trim()}","${value.textContent.trim()}"\n`;
                }
            });
        }

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `shopify-analytics-${new Date().toISOString().substring(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    function sdExportPDF() {
        const content = document.getElementById('sdDashboardContent');
        if (!content || typeof html2pdf === 'undefined') return;

        html2pdf().set({
            margin: 10,
            filename: `shopify-analytics-${new Date().toISOString().substring(0, 10)}.pdf`,
            image: { type: 'jpeg', quality: 0.95 },
            html2canvas: { scale: 2, useCORS: true },
            jsPDF: { unit: 'mm', format: 'a3', orientation: 'landscape' },
        }).from(content).save();
    }

    // ─── Ask Lightspeed (Embedded) ──────────────────────────────────

    async function sdAlsSendMessage() {
        const input = document.getElementById('sdAlsInput');
        const messagesEl = document.getElementById('sdAlsMessages');
        const sendBtn = document.getElementById('sdAlsSend');
        if (!input || !messagesEl || sdAlsStreaming) return;

        const message = input.value.trim();
        if (!message) return;

        // Clear empty state
        const emptyEl = messagesEl.querySelector('.sd-als-empty');
        if (emptyEl) emptyEl.remove();

        // Add user message
        const userDiv = document.createElement('div');
        userDiv.className = 'sd-als-msg user';
        userDiv.textContent = message;
        messagesEl.appendChild(userDiv);

        input.value = '';
        sdAlsStreaming = true;
        if (sendBtn) sendBtn.disabled = true;

        // Add conversation context
        sdAlsConversation.push({ role: 'user', content: message });

        // Add streaming response placeholder
        const assistantDiv = document.createElement('div');
        assistantDiv.className = 'sd-als-msg assistant';
        assistantDiv.textContent = '';
        messagesEl.appendChild(assistantDiv);
        messagesEl.scrollTop = messagesEl.scrollHeight;

        try {
            const token = localStorage.getItem('authToken') || localStorage.getItem('token');
            const formData = new FormData();
            formData.append('message', message);
            formData.append('conversation', JSON.stringify(sdAlsConversation.slice(-10)));

            const response = await fetch(`${API_BASE}/api/ask-lightspeed/agent`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData,
            });

            if (!response.ok) throw new Error('Request failed');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullText = '';
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const payload = JSON.parse(line.substring(6));
                            if (payload.type === 'text') {
                                fullText += payload.content;
                                assistantDiv.textContent = fullText;
                                messagesEl.scrollTop = messagesEl.scrollHeight;
                            } else if (payload.type === 'status') {
                                // Show status briefly
                            } else if (payload.type === 'error') {
                                assistantDiv.textContent = payload.content || 'An error occurred.';
                            }
                        } catch {
                            // Skip malformed SSE lines
                        }
                    }
                }
            }

            if (!fullText) {
                assistantDiv.textContent = 'No response received.';
            }

            sdAlsConversation.push({ role: 'assistant', content: fullText });
        } catch (e) {
            assistantDiv.textContent = 'Failed to get a response. Please try again.';
        }

        sdAlsStreaming = false;
        if (sendBtn) sendBtn.disabled = false;
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // ─── Sync Controls ──────────────────────────────────────────────

    function sdUpdateSyncIndicator(status) {
        const indicator = document.getElementById('sdSyncIndicator');
        if (!indicator) return;

        if (!status.connected) {
            indicator.innerHTML = '<span class="sd-sync-dot error"></span> Not connected';
            return;
        }

        const syncClass = status.sync_status === 'syncing' ? 'syncing' : status.sync_status === 'error' ? 'error' : '';
        const lastSync = status.last_incremental_sync || status.last_full_sync;
        const timeStr = lastSync ? sdTimeAgo(lastSync) : 'Never';
        indicator.innerHTML = `<span class="sd-sync-dot ${syncClass}"></span> Last updated: ${timeStr}`;

        const banner = document.getElementById('sdSyncBanner');
        if (banner && status.sync_error) {
            banner.style.display = 'block';
            banner.textContent = `Data may be delayed — ${status.sync_error}. Last updated: ${timeStr}`;
        } else if (banner) {
            banner.style.display = 'none';
        }
    }

    async function sdTriggerSync() {
        try {
            const resp = await fetch(`${API_BASE}/api/dashboard/sync`, {
                method: 'POST',
                headers: sdAuthHeaders(),
            });
            if (resp.ok) {
                const indicator = document.getElementById('sdSyncIndicator');
                if (indicator) indicator.innerHTML = '<span class="sd-sync-dot syncing"></span> Syncing...';
                sdPollSyncStatus(0);
            } else {
                const indicator = document.getElementById('sdSyncIndicator');
                if (indicator) indicator.innerHTML = '<span class="sd-sync-dot error"></span> Sync failed to start';
            }
        } catch (e) {
            console.error('Sync trigger failed:', e);
            const indicator = document.getElementById('sdSyncIndicator');
            if (indicator) indicator.innerHTML = '<span class="sd-sync-dot error"></span> Sync failed';
        }
    }

    function sdPollSyncStatus(attempt) {
        if (attempt > 30) return;
        var delay = attempt < 3 ? 3000 : 5000;
        setTimeout(async () => {
            try {
                var status = await sdFetch('sync-status');
                sdUpdateSyncIndicator(status);
                if (status.sync_status === 'synced') {
                    sdLoadDashboard();
                } else if (status.sync_status === 'error') {
                    // Stop polling on error
                } else {
                    sdPollSyncStatus(attempt + 1);
                }
            } catch {
                // Stop polling on fetch error
            }
        }, delay);
    }

    async function sdRefreshOrders() {
        try {
            const data = await sdFetch('recent-orders', { limit: 20 });
            sdRenderOrderFeed(data);
        } catch {
            // Silent failure on auto-refresh
        }
    }

    // ─── Empty State ────────────────────────────────────────────────

    function sdShowEmptyState() {
        const container = document.getElementById('sdDashboardContent');
        if (!container) return;

        container.innerHTML = `
            <div class="sd-empty-state">
                <div class="sd-empty-icon">&#128202;</div>
                <div class="sd-empty-title">Connect your Shopify store to see analytics</div>
                <div class="sd-empty-desc">Once connected, your sales data will sync automatically and appear here.</div>
                <button class="sd-btn-gradient" onclick="if(typeof switchPage==='function')switchPage('teams')">Go to Settings</button>
            </div>`;
    }

    // ─── Event Handlers ─────────────────────────────────────────────

    function sdSetupEvents() {
        // Date range preset
        const dateSelect = document.getElementById('sdDatePreset');
        if (dateSelect) {
            dateSelect.addEventListener('change', function () {
                sdCurrentPreset = this.value;
                const customDates = document.getElementById('sdCustomDates');
                if (customDates) {
                    if (this.value === 'custom') {
                        customDates.classList.add('visible');
                    } else {
                        customDates.classList.remove('visible');
                        sdLoadDashboard();
                    }
                }
            });
        }

        // Custom date range apply
        const applyDates = document.getElementById('sdApplyDates');
        if (applyDates) {
            applyDates.addEventListener('click', function () {
                const startInput = document.getElementById('sdStartDate');
                const endInput = document.getElementById('sdEndDate');
                if (startInput && endInput && startInput.value && endInput.value) {
                    sdCustomStartDate = startInput.value;
                    sdCustomEndDate = endInput.value;
                    sdLoadDashboard();
                }
            });
        }

        // Compare toggle
        const compareCheck = document.getElementById('sdCompareCheck');
        if (compareCheck) {
            compareCheck.addEventListener('change', function () {
                sdCompare = this.checked;
                sdLoadDashboard();
            });
        }

        // Refresh button
        const refreshBtn = document.getElementById('sdRefreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function () {
                sdTriggerSync();
            });
        }

        // Sales metric toggles
        document.querySelectorAll('.sd-sales-metric-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                document.querySelectorAll('.sd-sales-metric-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                sdSalesMetric = this.dataset.metric;
                sdFetch('sales-over-time', sdGetDateParams()).then(data => sdRenderSalesChart(data)).catch(() => {});
            });
        });

        // Order search
        const searchInput = document.getElementById('sdOrderSearch');
        if (searchInput) {
            searchInput.addEventListener('input', function () {
                clearTimeout(sdSearchDebounce);
                const q = this.value.trim();
                sdSearchDebounce = setTimeout(() => sdSearchOrders(q), 400);
            });
        }

        // Clear search
        const clearSearch = document.getElementById('sdClearSearch');
        if (clearSearch) {
            clearSearch.addEventListener('click', function () {
                const searchInput = document.getElementById('sdOrderSearch');
                if (searchInput) searchInput.value = '';
                const resultsPanel = document.getElementById('sdSearchResults');
                if (resultsPanel) resultsPanel.style.display = 'none';
            });
        }

        // Export button
        const exportBtn = document.getElementById('sdExportBtn');
        const exportMenu = document.getElementById('sdExportMenu');
        if (exportBtn && exportMenu) {
            exportBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                exportMenu.classList.toggle('open');
            });
            document.addEventListener('click', function () {
                exportMenu.classList.remove('open');
            });
            exportMenu.querySelectorAll('.sd-export-option').forEach(opt => {
                opt.addEventListener('click', function () {
                    const format = this.dataset.format;
                    exportMenu.classList.remove('open');
                    if (format === 'csv') sdExportCSV();
                    else if (format === 'pdf') sdExportPDF();
                });
            });
        }

        // Refresh insights
        const refreshInsights = document.getElementById('sdRefreshInsights');
        if (refreshInsights) {
            refreshInsights.addEventListener('click', function () {
                sdLoadInsights();
            });
        }

        // Ask Lightspeed
        const alsInput = document.getElementById('sdAlsInput');
        const alsSend = document.getElementById('sdAlsSend');
        if (alsSend) {
            alsSend.addEventListener('click', sdAlsSendMessage);
        }
        if (alsInput) {
            alsInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sdAlsSendMessage();
                }
            });
        }
    }

    // ─── Public API ─────────────────────────────────────────────────

    window.sdInitDashboard = function () {
        sdAlsConversation = [];
        sdAlsStreaming = false;
        sdSetupEvents();
        sdLoadDashboard();
    };

    window.sdCleanup = function () {
        if (sdRefreshTimer) {
            clearInterval(sdRefreshTimer);
            sdRefreshTimer = null;
        }
        if (sdSearchDebounce) {
            clearTimeout(sdSearchDebounce);
            sdSearchDebounce = null;
        }
        Object.values(sdCharts).forEach(c => { try { c.destroy(); } catch {} });
        sdCharts = {};
        sdAlsConversation = [];
        sdAlsStreaming = false;
    };

})();
