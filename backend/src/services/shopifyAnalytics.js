/**
 * Shopify Analytics Sync Service
 * Uses ShopifyQL for aggregated metrics and GraphQL for recent orders.
 * All data stored locally for instant dashboard loads.
 *
 * IMPORTANT: This service NEVER paginates individual orders via REST API.
 * Stores can have 100k+ orders — fetching them individually would OOM.
 * All aggregate metrics come from ShopifyQL (server-side aggregation).
 * Only the 50 most recent orders are fetched via GraphQL for the order list.
 */

const pool = require('../../config/database');
const shopifyService = require('./shopify');

const SHOPIFY_API_VERSION = '2025-04';

// ─── ShopifyQL / GraphQL Helpers ────────────────────────────────────

/**
 * Sanitize shop domain: strip protocol, trailing slashes/paths.
 */
function cleanShopDomain(domain) {
    if (!domain) return domain;
    return domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
}

/**
 * Execute a GraphQL query against the Shopify Admin API.
 */
async function shopifyGraphQL(shopDomain, accessToken, query, variables = {}) {
    const domain = cleanShopDomain(shopDomain);
    const url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'X-Shopify-Access-Token': accessToken,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query, variables }),
            signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            console.error(`Shopify GraphQL ${response.status} at ${url}`);
            throw new Error(`Shopify GraphQL error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        if (data.errors && data.errors.length > 0) {
            throw new Error(`ShopifyQL error: ${data.errors.map(e => e.message).join(', ')}`);
        }
        return data.data;
    } catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') {
            throw new Error('Shopify API request timed out');
        }
        throw err;
    }
}

/**
 * Run a ShopifyQL query and return parsed table data.
 */
async function runShopifyQL(shopDomain, accessToken, shopifyqlQuery) {
    const graphql = `{
        shopifyqlQuery(query: "${shopifyqlQuery.replace(/"/g, '\\"')}") {
            __typename
            ... on TableResponse {
                tableData {
                    rowData
                    columns { name dataType }
                }
            }
            ... on PolarisVizResponse {
                data {
                    key
                    data { key value }
                }
            }
        }
    }`;

    const data = await shopifyGraphQL(shopDomain, accessToken, graphql);
    const result = data?.shopifyqlQuery;

    if (!result) return [];

    if (result.__typename === 'TableResponse' && result.tableData) {
        const columns = result.tableData.columns.map(c => c.name);
        return result.tableData.rowData.map(row => {
            const parsed = typeof row === 'string' ? JSON.parse(row) : row;
            const obj = {};
            columns.forEach((col, i) => {
                obj[col] = parsed[i];
            });
            return obj;
        });
    }

    if (result.__typename === 'PolarisVizResponse' && result.data) {
        return result.data;
    }

    return [];
}

// ─── Full Sync ──────────────────────────────────────────────────────

/**
 * Run a full historical sync for a store.
 * Uses ShopifyQL aggregate queries — never paginates individual orders.
 */
async function runFullSync(organizationId) {
    const store = await shopifyService.getStoreConnection(organizationId);
    if (!store) throw new Error('No Shopify store connected');

    const logId = await createSyncLog(organizationId, 'full');

    try {
        await pool.query(
            `UPDATE shopify_stores SET analytics_sync_status = 'syncing', analytics_sync_error = NULL, updated_at = NOW() WHERE organization_id = $1`,
            [organizationId]
        );

        // Pre-flight: verify GraphQL API is reachable before starting sync
        try {
            await shopifyGraphQL(store.shop_domain, store.access_token, '{ shop { name currencyCode } }');
        } catch (preflight) {
            throw new Error(`Cannot reach Shopify GraphQL API for ${cleanShopDomain(store.shop_domain)}: ${preflight.message}. Check that the access token has Admin API access and the store domain is correct (must be yourstore.myshopify.com).`);
        }

        let totalRecords = 0;

        // All of these use ShopifyQL (server-side aggregation) — no individual order fetching
        totalRecords += await syncDailySales(store, organizationId, 365);
        totalRecords += await syncProductSales(store, organizationId, 365);
        totalRecords += await syncSalesByChannel(store, organizationId, 365);
        totalRecords += await syncSalesByRegion(store, organizationId, 365);

        // Fetch only 50 recent orders via GraphQL (not REST pagination)
        totalRecords += await syncRecentOrders(store, organizationId);

        // Customer metrics via GraphQL (aggregated, not per-order)
        totalRecords += await syncCustomerMetrics(store, organizationId);

        // Store currency from shop info
        await syncStoreCurrency(store, organizationId);

        await pool.query(
            `UPDATE shopify_stores SET analytics_sync_status = 'synced', last_full_sync_at = NOW(), last_incremental_sync_at = NOW(), updated_at = NOW() WHERE organization_id = $1`,
            [organizationId]
        );

        await completeSyncLog(logId, 'completed', totalRecords);
        return { success: true, records: totalRecords };
    } catch (error) {
        await pool.query(
            `UPDATE shopify_stores SET analytics_sync_status = 'error', analytics_sync_error = $2, updated_at = NOW() WHERE organization_id = $1`,
            [organizationId, error.message]
        );
        await completeSyncLog(logId, 'failed', 0, error.message);
        throw error;
    }
}

/**
 * Run an incremental sync — only data since last sync.
 */
async function runIncrementalSync(organizationId) {
    const store = await shopifyService.getStoreConnection(organizationId);
    if (!store) throw new Error('No Shopify store connected');

    // If never synced, do a full sync
    if (!store.last_full_sync_at) {
        return runFullSync(organizationId);
    }

    const logId = await createSyncLog(organizationId, 'incremental');

    try {
        let totalRecords = 0;

        // Re-sync last 2 days to catch late-arriving data
        totalRecords += await syncDailySales(store, organizationId, 2);
        totalRecords += await syncProductSales(store, organizationId, 2);
        totalRecords += await syncSalesByChannel(store, organizationId, 2);
        totalRecords += await syncSalesByRegion(store, organizationId, 2);
        totalRecords += await syncRecentOrders(store, organizationId);
        totalRecords += await syncCustomerMetrics(store, organizationId);

        await pool.query(
            `UPDATE shopify_stores SET last_incremental_sync_at = NOW(), analytics_sync_status = 'synced', analytics_sync_error = NULL, updated_at = NOW() WHERE organization_id = $1`,
            [organizationId]
        );

        await completeSyncLog(logId, 'completed', totalRecords);
        return { success: true, records: totalRecords };
    } catch (error) {
        await completeSyncLog(logId, 'failed', 0, error.message);
        throw error;
    }
}

// ─── Sync Helpers (all use ShopifyQL — server-side aggregation) ─────

async function syncDailySales(store, organizationId, days) {
    try {
        const rows = await runShopifyQL(
            store.shop_domain,
            store.access_token,
            `FROM sales SHOW sum(gross_sales) AS gross_sales, sum(net_sales) AS net_sales, sum(returns) AS refunds, sum(discounts) AS discounts, sum(taxes) AS taxes, sum(shipping) AS shipping, count(*) AS total_orders GROUP BY day SINCE -${days}d UNTIL today ORDER BY day ASC`
        );

        for (const row of rows) {
            const date = row.day || row.date;
            if (!date) continue;

            await pool.query(
                `INSERT INTO daily_sales_metrics (organization_id, date, gross_sales_cents, net_sales_cents, refunds_cents, discounts_cents, taxes_cents, shipping_cents, total_orders, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                 ON CONFLICT (organization_id, date) DO UPDATE SET
                    gross_sales_cents = EXCLUDED.gross_sales_cents,
                    net_sales_cents = EXCLUDED.net_sales_cents,
                    refunds_cents = EXCLUDED.refunds_cents,
                    discounts_cents = EXCLUDED.discounts_cents,
                    taxes_cents = EXCLUDED.taxes_cents,
                    shipping_cents = EXCLUDED.shipping_cents,
                    total_orders = EXCLUDED.total_orders,
                    updated_at = NOW()`,
                [
                    organizationId,
                    date,
                    toCents(row.gross_sales),
                    toCents(row.net_sales),
                    Math.abs(toCents(row.refunds)),
                    Math.abs(toCents(row.discounts)),
                    toCents(row.taxes),
                    toCents(row.shipping),
                    parseInt(row.total_orders) || 0,
                ]
            );
        }

        // Also sync fulfillment / customer breakdowns via orders ShopifyQL
        try {
            const orderRows = await runShopifyQL(
                store.shop_domain,
                store.access_token,
                `FROM orders SHOW count(*) AS order_count, financial_status GROUP BY day, financial_status SINCE -${days}d UNTIL today ORDER BY day ASC`
            );

            const dayStatusMap = {};
            for (const row of orderRows) {
                const date = row.day || row.date;
                if (!date) continue;
                if (!dayStatusMap[date]) dayStatusMap[date] = {};
                dayStatusMap[date][row.financial_status] = parseInt(row.order_count) || 0;
            }

            for (const [date, statuses] of Object.entries(dayStatusMap)) {
                await pool.query(
                    `UPDATE daily_sales_metrics SET
                        cancelled_orders = $3,
                        refunded_orders = $4,
                        updated_at = NOW()
                     WHERE organization_id = $1 AND date = $2`,
                    [
                        organizationId,
                        date,
                        statuses.cancelled || statuses.voided || 0,
                        statuses.refunded || statuses.partially_refunded || 0,
                    ]
                );
            }
        } catch (err) {
            console.error('syncDailySales order status error (non-fatal):', err.message);
        }

        return rows.length;
    } catch (error) {
        console.error('syncDailySales error:', error.message);
        // If ShopifyQL is not available, use GraphQL order count as minimal fallback
        return await syncDailySalesMinimalFallback(store, organizationId, days);
    }
}

/**
 * Minimal fallback when ShopifyQL is not available.
 * Uses GraphQL ordersCount instead of paginating all orders via REST.
 */
async function syncDailySalesMinimalFallback(store, organizationId, days) {
    try {
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - days);
        const sinceISO = sinceDate.toISOString().substring(0, 10);

        const query = `{
            ordersCount(query: "created_at:>=${sinceISO}") { count }
            currentAppInstallation { activeSubscriptions { name } }
        }`;

        const data = await shopifyGraphQL(store.shop_domain, store.access_token, query);
        const totalOrders = data?.ordersCount?.count || 0;

        // Insert a single summary row for today with order count
        const today = new Date().toISOString().substring(0, 10);
        await pool.query(
            `INSERT INTO daily_sales_metrics (organization_id, date, total_orders, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (organization_id, date) DO UPDATE SET
                total_orders = EXCLUDED.total_orders,
                updated_at = NOW()`,
            [organizationId, today, totalOrders]
        );

        return 1;
    } catch (err) {
        console.error('syncDailySalesMinimalFallback error:', err.message);
        return 0;
    }
}

async function syncProductSales(store, organizationId, days) {
    try {
        const rows = await runShopifyQL(
            store.shop_domain,
            store.access_token,
            `FROM sales SHOW product_title, sum(net_sales) AS revenue, sum(quantity) AS units_sold GROUP BY product_title, day SINCE -${days}d UNTIL today ORDER BY day ASC`
        );

        for (const row of rows) {
            const date = row.day || row.date;
            if (!date || !row.product_title) continue;

            await pool.query(
                `INSERT INTO product_sales_metrics (organization_id, date, product_id, product_title, revenue_cents, units_sold, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())
                 ON CONFLICT (organization_id, date, product_id) DO UPDATE SET
                    product_title = EXCLUDED.product_title,
                    revenue_cents = EXCLUDED.revenue_cents,
                    units_sold = EXCLUDED.units_sold,
                    updated_at = NOW()`,
                [organizationId, date, row.product_title, row.product_title, toCents(row.revenue), parseInt(row.units_sold) || 0]
            );
        }
        return rows.length;
    } catch {
        return 0;
    }
}

async function syncSalesByChannel(store, organizationId, days) {
    try {
        const rows = await runShopifyQL(
            store.shop_domain,
            store.access_token,
            `FROM sales SHOW sum(net_sales) AS revenue, count(*) AS order_count GROUP BY channel_name, day SINCE -${days}d UNTIL today ORDER BY day ASC`
        );

        for (const row of rows) {
            const date = row.day || row.date;
            const channel = row.channel_name || 'Online Store';
            if (!date) continue;

            await pool.query(
                `INSERT INTO sales_by_channel (organization_id, date, channel_name, revenue_cents, order_count)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (organization_id, date, channel_name) DO UPDATE SET
                    revenue_cents = EXCLUDED.revenue_cents,
                    order_count = EXCLUDED.order_count`,
                [organizationId, date, channel, toCents(row.revenue), parseInt(row.order_count) || 0]
            );
        }
        return rows.length;
    } catch {
        return 0;
    }
}

async function syncSalesByRegion(store, organizationId, days) {
    try {
        const rows = await runShopifyQL(
            store.shop_domain,
            store.access_token,
            `FROM sales SHOW sum(net_sales) AS revenue, count(*) AS order_count GROUP BY billing_region, billing_country, day SINCE -${days}d UNTIL today ORDER BY day ASC`
        );

        for (const row of rows) {
            const date = row.day || row.date;
            if (!date) continue;

            await pool.query(
                `INSERT INTO sales_by_region (organization_id, date, province, country, revenue_cents, order_count)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (organization_id, date, province, country) DO UPDATE SET
                    revenue_cents = EXCLUDED.revenue_cents,
                    order_count = EXCLUDED.order_count`,
                [organizationId, date, row.billing_region || 'Unknown', row.billing_country || 'Unknown', toCents(row.revenue), parseInt(row.order_count) || 0]
            );
        }
        return rows.length;
    } catch {
        return 0;
    }
}

async function syncRecentOrders(store, organizationId) {
    const query = `{
        orders(first: 50, sortKey: CREATED_AT, reverse: true) {
            edges {
                node {
                    id
                    name
                    createdAt
                    totalPriceSet { shopMoney { amount currencyCode } }
                    financialStatus
                    displayFulfillmentStatus
                    customer { firstName lastName email }
                    shippingAddress { province country }
                    lineItems(first: 5) {
                        edges {
                            node { title quantity originalUnitPriceSet { shopMoney { amount } } }
                        }
                    }
                }
            }
        }
    }`;

    const data = await shopifyGraphQL(store.shop_domain, store.access_token, query);
    const orders = data?.orders?.edges || [];

    // Clear old orders and insert new ones
    await pool.query('DELETE FROM dashboard_recent_orders WHERE organization_id = $1', [organizationId]);

    for (const { node: order } of orders) {
        const lineItems = (order.lineItems?.edges || []).map(e => ({
            title: e.node.title,
            quantity: e.node.quantity,
            price_cents: toCents(e.node.originalUnitPriceSet?.shopMoney?.amount),
        }));

        await pool.query(
            `INSERT INTO dashboard_recent_orders (organization_id, shopify_order_id, order_number, created_at, total_price_cents, currency_code, financial_status, fulfillment_status, customer_name, customer_email, province, country, line_items_summary)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             ON CONFLICT (organization_id, shopify_order_id) DO UPDATE SET
                order_number = EXCLUDED.order_number,
                total_price_cents = EXCLUDED.total_price_cents,
                financial_status = EXCLUDED.financial_status,
                fulfillment_status = EXCLUDED.fulfillment_status,
                customer_name = EXCLUDED.customer_name,
                updated_at = NOW()`,
            [
                organizationId,
                order.id,
                order.name,
                order.createdAt,
                toCents(order.totalPriceSet?.shopMoney?.amount),
                order.totalPriceSet?.shopMoney?.currencyCode || 'CAD',
                order.financialStatus,
                order.displayFulfillmentStatus,
                [order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(' ') || 'Guest',
                order.customer?.email,
                order.shippingAddress?.province,
                order.shippingAddress?.country,
                JSON.stringify(lineItems),
            ]
        );
    }

    return orders.length;
}

/**
 * Sync customer metrics using GraphQL customers query.
 * Uses GraphQL to fetch top customers by order count — no REST pagination.
 */
async function syncCustomerMetrics(store, organizationId) {
    try {
        const query = `{
            customers(first: 50, sortKey: TOTAL_SPENT, reverse: true) {
                edges {
                    node {
                        email
                        firstName
                        lastName
                        ordersCount
                        totalSpentV2 { amount currencyCode }
                        lastOrder { createdAt }
                    }
                }
            }
        }`;

        const data = await shopifyGraphQL(store.shop_domain, store.access_token, query);
        const customers = data?.customers?.edges || [];

        await pool.query('DELETE FROM shopify_top_customers WHERE organization_id = $1', [organizationId]);
        for (const { node: c } of customers) {
            if (!c.email) continue;
            const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email;
            await pool.query(
                `INSERT INTO shopify_top_customers (organization_id, customer_email, customer_name, total_spent_cents, order_count, last_order_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())
                 ON CONFLICT (organization_id, customer_email) DO UPDATE SET
                    customer_name = EXCLUDED.customer_name, total_spent_cents = EXCLUDED.total_spent_cents,
                    order_count = EXCLUDED.order_count, last_order_at = EXCLUDED.last_order_at, updated_at = NOW()`,
                [organizationId, c.email, name, toCents(c.totalSpentV2?.amount), parseInt(c.ordersCount) || 0, c.lastOrder?.createdAt]
            );
        }
        return customers.length;
    } catch (err) {
        console.error('syncCustomerMetrics error:', err.message);
        return 0;
    }
}

async function syncStoreCurrency(store, organizationId) {
    try {
        const query = `{ shop { currencyCode } }`;
        const data = await shopifyGraphQL(store.shop_domain, store.access_token, query);
        const currency = data?.shop?.currencyCode || 'CAD';
        await pool.query(
            'UPDATE shopify_stores SET currency_code = $2, updated_at = NOW() WHERE organization_id = $1',
            [organizationId, currency]
        );
    } catch {
        // Non-fatal
    }
}

function priceBucket(price) {
    if (price <= 0) return '$0';
    if (price < 10) return '$1-9';
    if (price < 25) return '$10-24';
    if (price < 50) return '$25-49';
    if (price < 100) return '$50-99';
    if (price < 250) return '$100-249';
    if (price < 500) return '$250-499';
    return '$500+';
}

// ─── Webhook Handlers for Analytics ─────────────────────────────────

/**
 * Handle an order webhook event by updating analytics tables.
 */
async function handleOrderWebhook(organizationId, topic, payload) {
    const date = payload.created_at?.substring(0, 10);
    if (!date) return;

    const totalPrice = parseFloat(payload.total_price) || 0;
    const subtotal = parseFloat(payload.subtotal_price) || 0;
    const tax = parseFloat(payload.total_tax) || 0;
    const discount = parseFloat(payload.total_discounts) || 0;
    const shipping = (payload.shipping_lines || []).reduce((s, l) => s + (parseFloat(l.price) || 0), 0);
    const units = (payload.line_items || []).reduce((s, li) => s + (li.quantity || 0), 0);

    if (topic === 'orders/create') {
        // Upsert daily metrics (increment)
        await pool.query(
            `INSERT INTO daily_sales_metrics (organization_id, date, gross_sales_cents, net_sales_cents, taxes_cents, discounts_cents, shipping_cents, total_orders, total_units_sold, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, NOW())
             ON CONFLICT (organization_id, date) DO UPDATE SET
                gross_sales_cents = daily_sales_metrics.gross_sales_cents + EXCLUDED.gross_sales_cents,
                net_sales_cents = daily_sales_metrics.net_sales_cents + EXCLUDED.net_sales_cents,
                taxes_cents = daily_sales_metrics.taxes_cents + EXCLUDED.taxes_cents,
                discounts_cents = daily_sales_metrics.discounts_cents + EXCLUDED.discounts_cents,
                shipping_cents = daily_sales_metrics.shipping_cents + EXCLUDED.shipping_cents,
                total_orders = daily_sales_metrics.total_orders + 1,
                total_units_sold = daily_sales_metrics.total_units_sold + EXCLUDED.total_units_sold,
                updated_at = NOW()`,
            [organizationId, date, toCents(subtotal + discount), toCents(subtotal), toCents(tax), toCents(discount), toCents(shipping), units]
        );

        // Update product metrics
        for (const item of (payload.line_items || [])) {
            const revenue = (parseFloat(item.price) || 0) * (item.quantity || 0);
            await pool.query(
                `INSERT INTO product_sales_metrics (organization_id, date, product_id, product_title, revenue_cents, units_sold, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())
                 ON CONFLICT (organization_id, date, product_id) DO UPDATE SET
                    revenue_cents = product_sales_metrics.revenue_cents + EXCLUDED.revenue_cents,
                    units_sold = product_sales_metrics.units_sold + EXCLUDED.units_sold,
                    updated_at = NOW()`,
                [organizationId, date, String(item.product_id || 'unknown'), item.title || 'Unknown', toCents(revenue), item.quantity || 0]
            );
        }

        // Update region
        const addr = payload.shipping_address || payload.billing_address;
        if (addr) {
            await pool.query(
                `INSERT INTO sales_by_region (organization_id, date, province, country, revenue_cents, order_count)
                 VALUES ($1, $2, $3, $4, $5, 1)
                 ON CONFLICT (organization_id, date, province, country) DO UPDATE SET
                    revenue_cents = sales_by_region.revenue_cents + EXCLUDED.revenue_cents,
                    order_count = sales_by_region.order_count + 1`,
                [organizationId, date, addr.province || 'Unknown', addr.country || addr.country_code || 'Unknown', toCents(totalPrice)]
            );
        }

        // Add to recent orders
        const customerName = payload.customer
            ? `${payload.customer.first_name || ''} ${payload.customer.last_name || ''}`.trim()
            : 'Guest';

        const lineItemsSummary = (payload.line_items || []).slice(0, 5).map(li => ({
            title: li.title, quantity: li.quantity, price_cents: toCents(li.price),
        }));

        await pool.query(
            `INSERT INTO dashboard_recent_orders (organization_id, shopify_order_id, order_number, created_at, total_price_cents, currency_code, financial_status, fulfillment_status, customer_name, customer_email, province, country, line_items_summary)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             ON CONFLICT (organization_id, shopify_order_id) DO UPDATE SET
                financial_status = EXCLUDED.financial_status,
                fulfillment_status = EXCLUDED.fulfillment_status,
                updated_at = NOW()`,
            [
                organizationId,
                String(payload.id),
                payload.name || `#${payload.order_number}`,
                payload.created_at,
                toCents(totalPrice),
                payload.currency || 'CAD',
                payload.financial_status,
                payload.fulfillment_status,
                customerName,
                payload.customer?.email || payload.email,
                (payload.shipping_address || payload.billing_address)?.province,
                (payload.shipping_address || payload.billing_address)?.country,
                JSON.stringify(lineItemsSummary),
            ]
        );

        // Trim to 100 recent orders
        await pool.query(
            `DELETE FROM dashboard_recent_orders WHERE organization_id = $1 AND id NOT IN (
                SELECT id FROM dashboard_recent_orders WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 100
            )`,
            [organizationId]
        );
    }

    if (topic === 'orders/cancelled') {
        await pool.query(
            `UPDATE daily_sales_metrics SET cancelled_orders = cancelled_orders + 1, updated_at = NOW() WHERE organization_id = $1 AND date = $2`,
            [organizationId, date]
        );
    }

    if (topic === 'refunds/create') {
        const refundAmount = (payload.refund_line_items || []).reduce((s, ri) => s + (parseFloat(ri.subtotal) || 0), 0);
        await pool.query(
            `UPDATE daily_sales_metrics SET refunds_cents = refunds_cents + $3, refunded_orders = refunded_orders + 1, updated_at = NOW() WHERE organization_id = $1 AND date = $2`,
            [organizationId, date, toCents(refundAmount)]
        );
    }

    if (topic === 'fulfillments/create' || topic === 'fulfillments/update') {
        const orderId = String(payload.order_id);
        await pool.query(
            `UPDATE dashboard_recent_orders SET fulfillment_status = $3, updated_at = NOW() WHERE organization_id = $1 AND shopify_order_id = $2`,
            [organizationId, orderId, payload.status]
        );
    }

    if (topic === 'orders/updated') {
        await pool.query(
            `UPDATE dashboard_recent_orders SET financial_status = $3, fulfillment_status = $4, updated_at = NOW() WHERE organization_id = $1 AND shopify_order_id = $2`,
            [organizationId, String(payload.id), payload.financial_status, payload.fulfillment_status]
        );
    }
}

// ─── Dashboard Query Functions ──────────────────────────────────────

async function getDashboardSummary(organizationId, startDate, endDate, compare) {
    const current = await pool.query(
        `SELECT
            COALESCE(SUM(net_sales_cents), 0) AS total_sales_cents,
            COALESCE(SUM(total_orders), 0) AS total_orders,
            COALESCE(SUM(total_units_sold), 0) AS total_units_sold,
            COALESCE(SUM(refunds_cents), 0) AS total_refunds_cents,
            COALESCE(SUM(new_customers), 0) AS new_customers,
            COALESCE(SUM(returning_customers), 0) AS returning_customers
         FROM daily_sales_metrics
         WHERE organization_id = $1 AND date >= $2 AND date <= $3`,
        [organizationId, startDate, endDate]
    );

    const c = current.rows[0];
    const totalSales = parseInt(c.total_sales_cents) || 0;
    const totalOrders = parseInt(c.total_orders) || 0;
    const totalUnits = parseInt(c.total_units_sold) || 0;
    const totalRefunds = parseInt(c.total_refunds_cents) || 0;
    const newCust = parseInt(c.new_customers) || 0;
    const retCust = parseInt(c.returning_customers) || 0;
    const aov = totalOrders > 0 ? Math.round(totalSales / totalOrders) : 0;
    const returningRate = (newCust + retCust) > 0 ? retCust / (newCust + retCust) : 0;
    const refundRate = totalSales > 0 ? totalRefunds / totalSales : 0;

    const result = {
        current_period: {
            total_sales: totalSales / 100,
            total_orders: totalOrders,
            average_order_value: aov / 100,
            returning_customer_rate: Math.round(returningRate * 100) / 100,
            total_units_sold: totalUnits,
            refund_rate: Math.round(refundRate * 100) / 100,
        },
    };

    // Comparison period
    if (compare) {
        const daysDiff = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;
        let compStart, compEnd;

        if (compare === 'previous_year') {
            compStart = new Date(startDate);
            compStart.setFullYear(compStart.getFullYear() - 1);
            compEnd = new Date(endDate);
            compEnd.setFullYear(compEnd.getFullYear() - 1);
        } else {
            compEnd = new Date(startDate);
            compEnd.setDate(compEnd.getDate() - 1);
            compStart = new Date(compEnd);
            compStart.setDate(compStart.getDate() - daysDiff + 1);
        }

        const compStartStr = compStart.toISOString().substring(0, 10);
        const compEndStr = compEnd.toISOString().substring(0, 10);

        const prev = await pool.query(
            `SELECT
                COALESCE(SUM(net_sales_cents), 0) AS total_sales_cents,
                COALESCE(SUM(total_orders), 0) AS total_orders,
                COALESCE(SUM(total_units_sold), 0) AS total_units_sold,
                COALESCE(SUM(new_customers), 0) AS new_customers,
                COALESCE(SUM(returning_customers), 0) AS returning_customers
             FROM daily_sales_metrics
             WHERE organization_id = $1 AND date >= $2 AND date <= $3`,
            [organizationId, compStartStr, compEndStr]
        );

        const p = prev.rows[0];
        const prevSales = parseInt(p.total_sales_cents) || 0;
        const prevOrders = parseInt(p.total_orders) || 0;
        const prevAov = prevOrders > 0 ? Math.round(prevSales / prevOrders) : 0;
        const prevNewCust = parseInt(p.new_customers) || 0;
        const prevRetCust = parseInt(p.returning_customers) || 0;
        const prevRetRate = (prevNewCust + prevRetCust) > 0 ? prevRetCust / (prevNewCust + prevRetCust) : 0;

        result.comparison_period = {
            total_sales: prevSales / 100,
            total_orders: prevOrders,
            average_order_value: prevAov / 100,
            returning_customer_rate: Math.round(prevRetRate * 100) / 100,
            total_units_sold: parseInt(p.total_units_sold) || 0,
        };

        result.changes = {
            total_sales_pct: pctChange(totalSales, prevSales),
            total_orders_pct: pctChange(totalOrders, prevOrders),
            average_order_value_pct: pctChange(aov, prevAov),
            returning_customer_rate_pct: pctChange(returningRate, prevRetRate),
        };
    }

    return result;
}

async function getSalesOverTime(organizationId, startDate, endDate, granularity = 'day') {
    let groupBy, dateExpr;
    if (granularity === 'week') {
        dateExpr = "date_trunc('week', date)::date";
        groupBy = dateExpr;
    } else if (granularity === 'month') {
        dateExpr = "date_trunc('month', date)::date";
        groupBy = dateExpr;
    } else {
        dateExpr = 'date';
        groupBy = 'date';
    }

    const result = await pool.query(
        `SELECT ${dateExpr} AS period_date,
                SUM(net_sales_cents) AS net_sales_cents,
                SUM(gross_sales_cents) AS gross_sales_cents,
                SUM(total_orders) AS orders
         FROM daily_sales_metrics
         WHERE organization_id = $1 AND date >= $2 AND date <= $3
         GROUP BY ${groupBy}
         ORDER BY period_date ASC`,
        [organizationId, startDate, endDate]
    );

    return {
        granularity,
        data: result.rows.map(r => ({
            date: r.period_date instanceof Date ? r.period_date.toISOString().substring(0, 10) : r.period_date,
            net_sales: (parseInt(r.net_sales_cents) || 0) / 100,
            gross_sales: (parseInt(r.gross_sales_cents) || 0) / 100,
            orders: parseInt(r.orders) || 0,
        })),
    };
}

async function getTopProducts(organizationId, startDate, endDate, limit = 10) {
    const result = await pool.query(
        `SELECT product_title,
                SUM(revenue_cents) AS revenue_cents,
                SUM(units_sold) AS units_sold
         FROM product_sales_metrics
         WHERE organization_id = $1 AND date >= $2 AND date <= $3
         GROUP BY product_title
         ORDER BY revenue_cents DESC
         LIMIT $4`,
        [organizationId, startDate, endDate, limit]
    );

    const totalRevenue = result.rows.reduce((s, r) => s + (parseInt(r.revenue_cents) || 0), 0);

    return {
        products: result.rows.map(r => {
            const rev = parseInt(r.revenue_cents) || 0;
            return {
                title: r.product_title,
                revenue: rev / 100,
                units_sold: parseInt(r.units_sold) || 0,
                pct_of_total: totalRevenue > 0 ? Math.round((rev / totalRevenue) * 1000) / 10 : 0,
            };
        }),
    };
}

async function getSalesByChannel(organizationId, startDate, endDate) {
    const result = await pool.query(
        `SELECT channel_name,
                SUM(revenue_cents) AS revenue_cents,
                SUM(order_count) AS order_count
         FROM sales_by_channel
         WHERE organization_id = $1 AND date >= $2 AND date <= $3
         GROUP BY channel_name
         ORDER BY revenue_cents DESC`,
        [organizationId, startDate, endDate]
    );

    return {
        channels: result.rows.map(r => ({
            channel: r.channel_name,
            revenue: (parseInt(r.revenue_cents) || 0) / 100,
            orders: parseInt(r.order_count) || 0,
        })),
    };
}

async function getSalesByRegion(organizationId, startDate, endDate, limit = 10) {
    const result = await pool.query(
        `SELECT province, country,
                SUM(revenue_cents) AS revenue_cents,
                SUM(order_count) AS order_count
         FROM sales_by_region
         WHERE organization_id = $1 AND date >= $2 AND date <= $3
         GROUP BY province, country
         ORDER BY revenue_cents DESC
         LIMIT $4`,
        [organizationId, startDate, endDate, limit]
    );

    return {
        regions: result.rows.map(r => ({
            province: r.province,
            country: r.country,
            revenue: (parseInt(r.revenue_cents) || 0) / 100,
            orders: parseInt(r.order_count) || 0,
        })),
    };
}

async function getRecentOrders(organizationId, limit = 20) {
    const result = await pool.query(
        `SELECT * FROM dashboard_recent_orders
         WHERE organization_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [organizationId, limit]
    );

    return {
        orders: result.rows.map(r => ({
            order_number: r.order_number,
            created_at: r.created_at,
            total_price: (parseInt(r.total_price_cents) || 0) / 100,
            currency: r.currency_code || 'CAD',
            financial_status: r.financial_status,
            fulfillment_status: r.fulfillment_status,
            customer_name: r.customer_name,
            customer_email: r.customer_email,
            province: r.province,
            country: r.country,
            line_items: r.line_items_summary,
        })),
    };
}

async function getSyncStatus(organizationId) {
    const result = await pool.query(
        `SELECT analytics_sync_status, analytics_sync_error, last_full_sync_at, last_incremental_sync_at, currency_code
         FROM shopify_stores WHERE organization_id = $1 AND is_active = TRUE`,
        [organizationId]
    );

    if (result.rows.length === 0) {
        return { connected: false };
    }

    const store = result.rows[0];
    return {
        connected: true,
        sync_status: store.analytics_sync_status,
        sync_error: store.analytics_sync_error,
        last_full_sync: store.last_full_sync_at,
        last_incremental_sync: store.last_incremental_sync_at,
        currency: store.currency_code || 'CAD',
    };
}

// ─── Extended Query Functions ────────────────────────────────────────

async function getTopCustomers(organizationId, limit = 10) {
    const result = await pool.query(
        `SELECT customer_email, customer_name, total_spent_cents, order_count, last_order_at
         FROM shopify_top_customers
         WHERE organization_id = $1
         ORDER BY total_spent_cents DESC
         LIMIT $2`,
        [organizationId, limit]
    );
    return {
        customers: result.rows.map(r => ({
            email: r.customer_email,
            name: r.customer_name,
            total_spent: (parseInt(r.total_spent_cents) || 0) / 100,
            order_count: parseInt(r.order_count) || 0,
            last_order: r.last_order_at,
        })),
    };
}

async function getSalesByCity(organizationId, startDate, endDate, limit = 15) {
    const result = await pool.query(
        `SELECT city, province, country,
                SUM(revenue_cents) AS revenue_cents,
                SUM(order_count) AS order_count,
                SUM(customer_count) AS customer_count
         FROM sales_by_city
         WHERE organization_id = $1 AND date >= $2 AND date <= $3
         GROUP BY city, province, country
         ORDER BY revenue_cents DESC
         LIMIT $4`,
        [organizationId, startDate, endDate, limit]
    );
    return {
        cities: result.rows.map(r => ({
            city: r.city,
            province: r.province,
            country: r.country,
            revenue: (parseInt(r.revenue_cents) || 0) / 100,
            orders: parseInt(r.order_count) || 0,
            customers: parseInt(r.customer_count) || 0,
        })),
    };
}

async function getPricePoints(organizationId, startDate, endDate) {
    const result = await pool.query(
        `SELECT price_bucket,
                SUM(units_sold) AS units_sold,
                SUM(revenue_cents) AS revenue_cents
         FROM price_point_metrics
         WHERE organization_id = $1 AND date >= $2 AND date <= $3
         GROUP BY price_bucket
         ORDER BY MIN(unit_price_cents) ASC`,
        [organizationId, startDate, endDate]
    );
    return {
        buckets: result.rows.map(r => ({
            bucket: r.price_bucket,
            units_sold: parseInt(r.units_sold) || 0,
            revenue: (parseInt(r.revenue_cents) || 0) / 100,
        })),
    };
}

async function searchOrders(organizationId, query) {
    const q = `%${query}%`;
    const result = await pool.query(
        `SELECT * FROM dashboard_recent_orders
         WHERE organization_id = $1
           AND (order_number ILIKE $2 OR customer_name ILIKE $2 OR customer_email ILIKE $2)
         ORDER BY created_at DESC
         LIMIT 20`,
        [organizationId, q]
    );
    return {
        orders: result.rows.map(r => ({
            order_number: r.order_number,
            created_at: r.created_at,
            total_price: (parseInt(r.total_price_cents) || 0) / 100,
            currency: r.currency_code || 'CAD',
            financial_status: r.financial_status,
            fulfillment_status: r.fulfillment_status,
            customer_name: r.customer_name,
            customer_email: r.customer_email,
            province: r.province,
            country: r.country,
            line_items: r.line_items_summary,
        })),
    };
}

async function generateAIInsights(organizationId, startDate, endDate) {
    const summary = await getDashboardSummary(organizationId, startDate, endDate, 'previous_period');
    const topProducts = await getTopProducts(organizationId, startDate, endDate, 5);
    const regions = await getSalesByRegion(organizationId, startDate, endDate, 5);
    const topCustomers = await getTopCustomers(organizationId, 5);

    const cp = summary.current_period;
    const changes = summary.changes || {};

    const insights = [];

    // Revenue trend
    if (changes.total_sales_pct > 5) {
        insights.push({ type: 'positive', text: `Revenue is up ${changes.total_sales_pct.toFixed(1)}% compared to the previous period.` });
    } else if (changes.total_sales_pct < -5) {
        insights.push({ type: 'negative', text: `Revenue is down ${Math.abs(changes.total_sales_pct).toFixed(1)}% compared to the previous period.` });
    } else {
        insights.push({ type: 'neutral', text: `Revenue is stable compared to the previous period.` });
    }

    // AOV trend
    if (changes.average_order_value_pct > 3) {
        insights.push({ type: 'positive', text: `Average order value increased ${changes.average_order_value_pct.toFixed(1)}% — customers are spending more per order.` });
    } else if (changes.average_order_value_pct < -3) {
        insights.push({ type: 'negative', text: `Average order value dropped ${Math.abs(changes.average_order_value_pct).toFixed(1)}% — consider bundling or upsell strategies.` });
    }

    // Top product
    if (topProducts.products.length > 0) {
        const top = topProducts.products[0];
        insights.push({ type: 'info', text: `Top seller: "${top.title}" driving ${top.pct_of_total}% of revenue with ${top.units_sold} units sold.` });
    }

    // Customer retention
    if (cp.returning_customer_rate > 0.3) {
        insights.push({ type: 'positive', text: `Strong retention — ${Math.round(cp.returning_customer_rate * 100)}% returning customer rate.` });
    } else if (cp.returning_customer_rate < 0.15 && cp.total_orders > 10) {
        insights.push({ type: 'negative', text: `Low returning customer rate (${Math.round(cp.returning_customer_rate * 100)}%). Consider loyalty programs or email follow-ups.` });
    }

    // Top region
    if (regions.regions.length > 0) {
        const topRegion = regions.regions[0];
        const regionLabel = topRegion.province !== 'Unknown' ? topRegion.province : topRegion.country;
        insights.push({ type: 'info', text: `Top market: ${regionLabel} with ${topRegion.orders} orders.` });
    }

    // Whale customer
    if (topCustomers.customers.length > 0) {
        const whale = topCustomers.customers[0];
        insights.push({ type: 'info', text: `Top customer: ${whale.name} with ${whale.order_count} orders totaling $${whale.total_spent.toFixed(2)}.` });
    }

    // Refund rate
    if (cp.refund_rate > 0.05) {
        insights.push({ type: 'negative', text: `Refund rate is ${(cp.refund_rate * 100).toFixed(1)}% — investigate product quality or description accuracy.` });
    }

    return { insights };
}

// ─── Scheduled Sync ─────────────────────────────────────────────────

/**
 * Run incremental sync for all active stores. Called by scheduler.
 */
async function syncAllStores() {
    try {
        const result = await pool.query(
            `SELECT organization_id FROM shopify_stores WHERE is_active = TRUE AND last_full_sync_at IS NOT NULL`
        );

        for (const row of result.rows) {
            try {
                await runIncrementalSync(row.organization_id);
            } catch (error) {
                console.error(`Incremental sync failed for org ${row.organization_id}:`, error.message);
            }
        }
    } catch (error) {
        console.error('syncAllStores error:', error.message);
    }
}

// ─── Utility ────────────────────────────────────────────────────────

function toCents(value) {
    if (value === null || value === undefined) return 0;
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) return 0;
    return Math.round(num * 100);
}

function pctChange(current, previous) {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 10000) / 100;
}

async function createSyncLog(organizationId, syncType) {
    const result = await pool.query(
        `INSERT INTO analytics_sync_log (organization_id, sync_type, status, started_at)
         VALUES ($1, $2, 'running', NOW()) RETURNING id`,
        [organizationId, syncType]
    );
    return result.rows[0].id;
}

async function completeSyncLog(logId, status, records, errorMessage = null) {
    await pool.query(
        `UPDATE analytics_sync_log SET status = $2, records_processed = $3, error_message = $4, completed_at = NOW() WHERE id = $1`,
        [logId, status, records, errorMessage]
    );
}

module.exports = {
    runFullSync,
    runIncrementalSync,
    syncAllStores,
    handleOrderWebhook,
    getDashboardSummary,
    getSalesOverTime,
    getTopProducts,
    getSalesByChannel,
    getSalesByRegion,
    getRecentOrders,
    getSyncStatus,
    getTopCustomers,
    getSalesByCity,
    getPricePoints,
    searchOrders,
    generateAIInsights,
    shopifyGraphQL,
    runShopifyQL,
};
