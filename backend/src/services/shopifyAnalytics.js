/**
 * Shopify Analytics Sync Service
 * Uses ShopifyQL for aggregated metrics and GraphQL for recent orders.
 * All data stored locally for instant dashboard loads.
 */

const pool = require('../../config/database');
const shopifyService = require('./shopify');

const SHOPIFY_API_VERSION = '2024-01';

// ─── ShopifyQL / GraphQL Helpers ────────────────────────────────────

/**
 * Execute a GraphQL query against the Shopify Admin API.
 */
async function shopifyGraphQL(shopDomain, accessToken, query, variables = {}) {
    const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

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
            throw new Error('Shopify GraphQL request timed out');
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

        let totalRecords = 0;

        // Sync daily sales (last 365 days)
        totalRecords += await syncDailySales(store, organizationId, 365);

        // Sync product sales (last 365 days)
        totalRecords += await syncProductSales(store, organizationId, 365);

        // Sync sales by channel (last 365 days)
        totalRecords += await syncSalesByChannel(store, organizationId, 365);

        // Sync sales by region (last 365 days)
        totalRecords += await syncSalesByRegion(store, organizationId, 365);

        // Sync recent orders via GraphQL
        totalRecords += await syncRecentOrders(store, organizationId);

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

// ─── Sync Helpers ───────────────────────────────────────────────────

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

        // Also sync fulfillment / customer breakdowns via orders table
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

        return rows.length;
    } catch (error) {
        console.error('syncDailySales error:', error.message);
        // Fall back to REST API if ShopifyQL not available
        return await syncDailySalesFromREST(store, organizationId, days);
    }
}

/**
 * Fallback: sync daily sales from REST API order counts (for stores without ShopifyQL access).
 */
async function syncDailySalesFromREST(store, organizationId, days) {
    const now = new Date();
    const sinceDate = new Date(now);
    sinceDate.setDate(sinceDate.getDate() - days);

    const endpoint = `/orders.json?limit=250&status=any&created_at_min=${sinceDate.toISOString()}&fields=id,created_at,total_price,subtotal_price,total_tax,total_discounts,financial_status,fulfillment_status,customer,line_items,shipping_lines`;

    const orders = [];
    let url = `https://${store.shop_domain}/admin/api/${SHOPIFY_API_VERSION}${endpoint}`;

    while (url) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetch(url, {
                headers: { 'X-Shopify-Access-Token': store.access_token, 'Content-Type': 'application/json' },
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!response.ok) break;
            const data = await response.json();
            if (data.orders) orders.push(...data.orders);
            const linkHeader = response.headers.get('link');
            url = null;
            if (linkHeader) {
                const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
                if (nextMatch) url = nextMatch[1];
            }
        } catch {
            clearTimeout(timeout);
            break;
        }
    }

    // Aggregate by day
    const dayMap = {};
    for (const order of orders) {
        const date = order.created_at?.substring(0, 10);
        if (!date) continue;

        if (!dayMap[date]) {
            dayMap[date] = {
                gross_sales: 0, net_sales: 0, refunds: 0, discounts: 0, taxes: 0, shipping: 0,
                total_orders: 0, units_sold: 0, new_customers: 0, returning_customers: 0,
                fulfilled: 0, unfulfilled: 0, partially_fulfilled: 0, cancelled: 0, refunded: 0,
            };
        }

        const d = dayMap[date];
        const totalPrice = parseFloat(order.total_price) || 0;
        const subtotal = parseFloat(order.subtotal_price) || 0;
        const tax = parseFloat(order.total_tax) || 0;
        const discount = parseFloat(order.total_discounts) || 0;
        const shipping = (order.shipping_lines || []).reduce((s, l) => s + (parseFloat(l.price) || 0), 0);

        d.gross_sales += subtotal + discount;
        d.net_sales += subtotal;
        d.taxes += tax;
        d.discounts += discount;
        d.shipping += shipping;
        d.total_orders++;

        const units = (order.line_items || []).reduce((s, li) => s + (li.quantity || 0), 0);
        d.units_sold += units;

        if (order.financial_status === 'refunded') { d.refunded++; d.refunds += totalPrice; }
        if (order.financial_status === 'voided' || order.cancelled_at) d.cancelled++;

        if (order.fulfillment_status === 'fulfilled') d.fulfilled++;
        else if (order.fulfillment_status === 'partial') d.partially_fulfilled++;
        else d.unfulfilled++;

        if (order.customer?.orders_count <= 1) d.new_customers++;
        else d.returning_customers++;
    }

    for (const [date, d] of Object.entries(dayMap)) {
        const aov = d.total_orders > 0 ? Math.round((d.net_sales / d.total_orders) * 100) : 0;
        await pool.query(
            `INSERT INTO daily_sales_metrics (organization_id, date, gross_sales_cents, net_sales_cents, refunds_cents, discounts_cents, taxes_cents, shipping_cents, total_orders, total_units_sold, new_customers, returning_customers, average_order_value_cents, fulfilled_orders, unfulfilled_orders, partially_fulfilled_orders, cancelled_orders, refunded_orders, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
             ON CONFLICT (organization_id, date) DO UPDATE SET
                gross_sales_cents = EXCLUDED.gross_sales_cents,
                net_sales_cents = EXCLUDED.net_sales_cents,
                refunds_cents = EXCLUDED.refunds_cents,
                discounts_cents = EXCLUDED.discounts_cents,
                taxes_cents = EXCLUDED.taxes_cents,
                shipping_cents = EXCLUDED.shipping_cents,
                total_orders = EXCLUDED.total_orders,
                total_units_sold = EXCLUDED.total_units_sold,
                new_customers = EXCLUDED.new_customers,
                returning_customers = EXCLUDED.returning_customers,
                average_order_value_cents = EXCLUDED.average_order_value_cents,
                fulfilled_orders = EXCLUDED.fulfilled_orders,
                unfulfilled_orders = EXCLUDED.unfulfilled_orders,
                partially_fulfilled_orders = EXCLUDED.partially_fulfilled_orders,
                cancelled_orders = EXCLUDED.cancelled_orders,
                refunded_orders = EXCLUDED.refunded_orders,
                updated_at = NOW()`,
            [
                organizationId, date,
                toCents(d.gross_sales), toCents(d.net_sales), toCents(d.refunds), toCents(d.discounts),
                toCents(d.taxes), toCents(d.shipping), d.total_orders, d.units_sold,
                d.new_customers, d.returning_customers, aov,
                d.fulfilled, d.unfulfilled, d.partially_fulfilled, d.cancelled, d.refunded,
            ]
        );
    }

    // Also update product and region data from the same orders
    await aggregateProductSalesFromOrders(orders, organizationId);
    await aggregateRegionSalesFromOrders(orders, organizationId);

    return Object.keys(dayMap).length;
}

async function aggregateProductSalesFromOrders(orders, organizationId) {
    const productDayMap = {};
    for (const order of orders) {
        const date = order.created_at?.substring(0, 10);
        if (!date) continue;
        for (const item of (order.line_items || [])) {
            const key = `${date}:${item.product_id || 'unknown'}`;
            if (!productDayMap[key]) {
                productDayMap[key] = { date, product_id: String(item.product_id || 'unknown'), product_title: item.title || 'Unknown', revenue: 0, units: 0 };
            }
            productDayMap[key].revenue += (parseFloat(item.price) || 0) * (item.quantity || 0);
            productDayMap[key].units += item.quantity || 0;
        }
    }

    for (const p of Object.values(productDayMap)) {
        await pool.query(
            `INSERT INTO product_sales_metrics (organization_id, date, product_id, product_title, revenue_cents, units_sold, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (organization_id, date, product_id) DO UPDATE SET
                product_title = EXCLUDED.product_title,
                revenue_cents = EXCLUDED.revenue_cents,
                units_sold = EXCLUDED.units_sold,
                updated_at = NOW()`,
            [organizationId, p.date, p.product_id, p.product_title, toCents(p.revenue), p.units]
        );
    }
}

async function aggregateRegionSalesFromOrders(orders, organizationId) {
    const regionDayMap = {};
    for (const order of orders) {
        const date = order.created_at?.substring(0, 10);
        if (!date) continue;
        const addr = order.shipping_address || order.billing_address;
        const province = addr?.province || 'Unknown';
        const country = addr?.country || addr?.country_code || 'Unknown';
        const key = `${date}:${province}:${country}`;
        if (!regionDayMap[key]) {
            regionDayMap[key] = { date, province, country, revenue: 0, orders: 0 };
        }
        regionDayMap[key].revenue += parseFloat(order.total_price) || 0;
        regionDayMap[key].orders++;
    }

    for (const r of Object.values(regionDayMap)) {
        await pool.query(
            `INSERT INTO sales_by_region (organization_id, date, province, country, revenue_cents, order_count)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (organization_id, date, province, country) DO UPDATE SET
                revenue_cents = EXCLUDED.revenue_cents,
                order_count = EXCLUDED.order_count`,
            [organizationId, r.date, r.province, r.country, toCents(r.revenue), r.orders]
        );
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
        return 0; // Fallback already handled in syncDailySalesFromREST
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
        orders(first: 100, sortKey: CREATED_AT, reverse: true) {
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
        // Update the recent order's fulfillment status
        const orderId = String(payload.order_id);
        await pool.query(
            `UPDATE dashboard_recent_orders SET fulfillment_status = $3, updated_at = NOW() WHERE organization_id = $1 AND shopify_order_id = $2`,
            [organizationId, orderId, payload.status]
        );
    }

    if (topic === 'orders/updated') {
        // Update recent order status
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
    shopifyGraphQL,
    runShopifyQL,
};
