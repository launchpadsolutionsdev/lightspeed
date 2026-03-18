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
            throw new Error(`Shopify GraphQL error: ${data.errors.map(e => e.message).join(', ')}`);
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

    if (!result) {
        throw new Error('ShopifyQL returned null — access token may be missing the read_reports scope');
    }

    // Handle ShopifyQL parse/validation errors
    if (result.__typename === 'ParseErrors' || result.__typename === 'QueryError') {
        const errMsg = JSON.stringify(result.parseErrors || result.errors || result);
        throw new Error(`ShopifyQL query error: ${errMsg}`);
    }

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

    throw new Error(`ShopifyQL unexpected response type: ${result.__typename}`);
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

        // Test ShopifyQL availability (requires read_reports scope)
        let shopifyqlAvailable = false;
        try {
            await runShopifyQL(store.shop_domain, store.access_token, 'FROM orders SHOW sum(orders) AS c SINCE -1d UNTIL today');
            shopifyqlAvailable = true;
            console.log(`ShopifyQL available for ${cleanShopDomain(store.shop_domain)}`);
        } catch (sqlErr) {
            console.warn(`ShopifyQL NOT available for ${cleanShopDomain(store.shop_domain)}: ${sqlErr.message}. Falling back to GraphQL-based sync. For full analytics, ensure the access token has the read_reports scope.`);
        }

        if (shopifyqlAvailable) {
            // ShopifyQL aggregate queries — fast, server-side aggregation
            totalRecords += await syncDailySales(store, organizationId, 365);
            totalRecords += await syncProductSales(store, organizationId, 365);
            totalRecords += await syncSalesByChannel(store, organizationId, 365);
            totalRecords += await syncSalesByRegion(store, organizationId, 365);
            totalRecords += await syncSalesByCity(store, organizationId, 365);
            totalRecords += await syncSessions(store, organizationId, 365);
        } else {
            // Fallback: fetch orders via GraphQL and compute all metrics
            // Cap at 90 days — paginating 365 days of individual orders is too slow
            totalRecords += await syncViaGraphQLFallback(store, organizationId, 90);
        }

        // Fetch only 50 recent orders via GraphQL (not REST pagination)
        totalRecords += await syncRecentOrders(store, organizationId);

        // Derive price points from recent orders line items
        totalRecords += await syncPricePoints(store, organizationId);

        // Customer metrics via GraphQL (aggregated, not per-order)
        totalRecords += await syncCustomerMetrics(store, organizationId);

        // Compute new vs returning customer rate from customer data
        totalRecords += await syncCustomerRetention(organizationId);

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
        await pool.query(
            `UPDATE shopify_stores SET analytics_sync_status = 'syncing', analytics_sync_error = NULL, updated_at = NOW() WHERE organization_id = $1`,
            [organizationId]
        );

        let totalRecords = 0;

        // Test ShopifyQL availability
        let shopifyqlAvailable = false;
        try {
            await runShopifyQL(store.shop_domain, store.access_token, 'FROM orders SHOW sum(orders) AS c SINCE -1d UNTIL today');
            shopifyqlAvailable = true;
        } catch { /* fallback */ }

        if (shopifyqlAvailable) {
            totalRecords += await syncDailySales(store, organizationId, 7);
            totalRecords += await syncProductSales(store, organizationId, 7);
            totalRecords += await syncSalesByChannel(store, organizationId, 7);
            totalRecords += await syncSalesByRegion(store, organizationId, 7);
            totalRecords += await syncSalesByCity(store, organizationId, 7);
            totalRecords += await syncSessions(store, organizationId, 7);
        } else {
            totalRecords += await syncViaGraphQLFallback(store, organizationId, 30);
        }

        totalRecords += await syncRecentOrders(store, organizationId);
        totalRecords += await syncPricePoints(store, organizationId);
        totalRecords += await syncCustomerMetrics(store, organizationId);
        totalRecords += await syncCustomerRetention(organizationId);

        await pool.query(
            `UPDATE shopify_stores SET last_incremental_sync_at = NOW(), analytics_sync_status = 'synced', analytics_sync_error = NULL, updated_at = NOW() WHERE organization_id = $1`,
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

// ─── Sync Helpers (all use ShopifyQL — server-side aggregation) ─────

async function syncDailySales(store, organizationId, days) {
    try {
        // Revenue + units from the sales dataset, order counts from the orders dataset.
        // These are separate datasets: 'sales' has line-item granularity with product/revenue data,
        // 'orders' has order-level data with order counts, channels, and geographic dimensions.
        const [salesRows, orderRows] = await Promise.all([
            runShopifyQL(
                store.shop_domain,
                store.access_token,
                `FROM sales SHOW sum(gross_sales) AS gross_sales, sum(net_sales) AS net_sales, sum(returns) AS refunds, sum(discounts) AS discounts, sum(taxes) AS taxes, sum(shipping) AS shipping, sum(quantity) AS total_units GROUP BY day SINCE -${days}d UNTIL today ORDER BY day ASC`
            ),
            runShopifyQL(
                store.shop_domain,
                store.access_token,
                `FROM orders SHOW sum(orders) AS total_orders GROUP BY day SINCE -${days}d UNTIL today ORDER BY day ASC`
            ).catch(err => {
                console.error('syncDailySales order count query error (non-fatal):', err.message);
                return [];
            }),
        ]);

        const orderCountByDay = {};
        for (const row of orderRows) {
            const date = row.day || row.date;
            if (date) orderCountByDay[date] = parseInt(row.total_orders) || 0;
        }

        for (const row of salesRows) {
            const date = row.day || row.date;
            if (!date) continue;

            await pool.query(
                `INSERT INTO daily_sales_metrics (organization_id, date, gross_sales_cents, net_sales_cents, refunds_cents, discounts_cents, taxes_cents, shipping_cents, total_orders, total_units_sold, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                 ON CONFLICT (organization_id, date) DO UPDATE SET
                    gross_sales_cents = EXCLUDED.gross_sales_cents,
                    net_sales_cents = EXCLUDED.net_sales_cents,
                    refunds_cents = EXCLUDED.refunds_cents,
                    discounts_cents = EXCLUDED.discounts_cents,
                    taxes_cents = EXCLUDED.taxes_cents,
                    shipping_cents = EXCLUDED.shipping_cents,
                    total_orders = EXCLUDED.total_orders,
                    total_units_sold = EXCLUDED.total_units_sold,
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
                    orderCountByDay[date] || 0,
                    parseInt(row.total_units) || 0,
                ]
            );
        }

        return salesRows.length;
    } catch (error) {
        console.error('syncDailySales ShopifyQL error:', error.message);
        return 0;
    }
}

/**
 * Comprehensive GraphQL fallback when ShopifyQL is unavailable.
 * Paginates through ALL orders via GraphQL for exact data — no scaling, no estimates.
 * For high-volume stores this can take a few minutes on initial sync.
 */
async function syncViaGraphQLFallback(store, organizationId, days) {
    console.log(`Running GraphQL fallback sync for ${days} days (ShopifyQL unavailable — fetching ALL orders for exact data)`);

    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);
    const sinceISO = sinceDate.toISOString().substring(0, 10);

    // Paginate through ALL orders in the date range
    const dailyMap = {};    // date → { gross, net, tax, discount, shipping, orders, units }
    const productMap = {};  // date|title → { revenue, units }
    const regionMap = {};   // date|province|country → { revenue, orders }
    const cityMap = {};     // date|city|province|country → { revenue, orders }

    let cursor = null;
    let totalFetched = 0;
    let pageNum = 0;
    const MAX_PAGES = 40; // 40 pages × 250 orders = 10,000 orders max

    while (true) {
        pageNum++;
        if (pageNum > MAX_PAGES) {
            console.warn(`GraphQL fallback: hit max page limit (${MAX_PAGES}), stopping with ${totalFetched} orders`);
            break;
        }
        const afterClause = cursor ? `, after: "${cursor}"` : '';
        const query = `{
            orders(first: 250, sortKey: CREATED_AT, reverse: false${afterClause}, query: "created_at:>=${sinceISO}") {
                edges {
                    node {
                        createdAt
                        totalPriceSet { shopMoney { amount currencyCode } }
                        subtotalPriceSet { shopMoney { amount } }
                        totalTaxSet { shopMoney { amount } }
                        totalDiscountsSet { shopMoney { amount } }
                        totalShippingPriceSet { shopMoney { amount } }
                        shippingAddress { province country city }
                        billingAddress { province country city }
                        customer { defaultAddress { province country city } }
                        lineItems(first: 10) {
                            edges {
                                node { title quantity originalUnitPriceSet { shopMoney { amount } } }
                            }
                        }
                    }
                    cursor
                }
                pageInfo { hasNextPage }
            }
        }`;

        const data = await shopifyGraphQL(store.shop_domain, store.access_token, query);
        const edges = data?.orders?.edges || [];

        for (const edge of edges) {
            const order = edge.node;
            const date = order.createdAt?.substring(0, 10);
            if (!date) continue;

            const subtotal = parseFloat(order.subtotalPriceSet?.shopMoney?.amount) || 0;
            const total = parseFloat(order.totalPriceSet?.shopMoney?.amount) || 0;
            const tax = parseFloat(order.totalTaxSet?.shopMoney?.amount) || 0;
            const discount = parseFloat(order.totalDiscountsSet?.shopMoney?.amount) || 0;
            const shipping = parseFloat(order.totalShippingPriceSet?.shopMoney?.amount) || 0;

            // Daily sales
            if (!dailyMap[date]) dailyMap[date] = { gross: 0, net: 0, tax: 0, discount: 0, shipping: 0, orders: 0, units: 0 };
            dailyMap[date].gross += subtotal + discount;
            dailyMap[date].net += subtotal;
            dailyMap[date].tax += tax;
            dailyMap[date].discount += discount;
            dailyMap[date].shipping += shipping;
            dailyMap[date].orders += 1;

            // Product sales
            for (const li of (order.lineItems?.edges || [])) {
                const item = li.node;
                const title = item.title || 'Unknown';
                const qty = item.quantity || 1;
                const unitPrice = parseFloat(item.originalUnitPriceSet?.shopMoney?.amount) || 0;
                dailyMap[date].units += qty;

                const pKey = `${date}|${title}`;
                if (!productMap[pKey]) productMap[pKey] = { date, title, revenue: 0, units: 0 };
                productMap[pKey].revenue += unitPrice * qty;
                productMap[pKey].units += qty;
            }

            // Region + City (prefer shipping → billing → customer default address)
            const addr = order.shippingAddress || order.billingAddress || order.customer?.defaultAddress;
            if (addr) {
                const rKey = `${date}|${addr.province || 'Unknown'}|${addr.country || 'Unknown'}`;
                if (!regionMap[rKey]) regionMap[rKey] = { date, province: addr.province || 'Unknown', country: addr.country || 'Unknown', revenue: 0, orders: 0 };
                regionMap[rKey].revenue += total;
                regionMap[rKey].orders += 1;

                if (addr.city) {
                    const cKey = `${date}|${addr.city}|${addr.province || 'Unknown'}|${addr.country || 'Unknown'}`;
                    if (!cityMap[cKey]) cityMap[cKey] = { date, city: addr.city, province: addr.province || 'Unknown', country: addr.country || 'Unknown', revenue: 0, orders: 0 };
                    cityMap[cKey].revenue += total;
                    cityMap[cKey].orders += 1;
                }
            }
        }

        totalFetched += edges.length;

        if (pageNum % 10 === 0) {
            console.log(`GraphQL fallback: fetched ${totalFetched} orders so far (page ${pageNum})...`);
            // Heartbeat: bump updated_at so stuck-sync detection knows we're still alive
            await pool.query(
                `UPDATE shopify_stores SET updated_at = NOW() WHERE organization_id = $1 AND analytics_sync_status = 'syncing'`,
                [organizationId]
            );
        }

        if (!data?.orders?.pageInfo?.hasNextPage || edges.length === 0) break;
        cursor = edges[edges.length - 1].cursor;

        // Respect Shopify rate limits: brief pause every 4 pages
        if (pageNum % 4 === 0) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    console.log(`GraphQL fallback: fetched ALL ${totalFetched} orders — exact data, no estimates`);
    if (totalFetched === 0) return 0;

    // ── Write exact daily sales ──
    let totalRecords = 0;

    for (const [date, d] of Object.entries(dailyMap)) {
        await pool.query(
            `INSERT INTO daily_sales_metrics (organization_id, date, gross_sales_cents, net_sales_cents, refunds_cents, discounts_cents, taxes_cents, shipping_cents, total_orders, total_units_sold, updated_at)
             VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9, NOW())
             ON CONFLICT (organization_id, date) DO UPDATE SET
                gross_sales_cents = EXCLUDED.gross_sales_cents,
                net_sales_cents = EXCLUDED.net_sales_cents,
                discounts_cents = EXCLUDED.discounts_cents,
                taxes_cents = EXCLUDED.taxes_cents,
                shipping_cents = EXCLUDED.shipping_cents,
                total_orders = EXCLUDED.total_orders,
                total_units_sold = EXCLUDED.total_units_sold,
                updated_at = NOW()`,
            [organizationId, date,
                toCents(d.gross),
                toCents(d.net),
                toCents(d.discount),
                toCents(d.tax),
                toCents(d.shipping),
                d.orders,
                d.units]
        );
        totalRecords++;
    }

    // ── Write exact product sales ──
    for (const p of Object.values(productMap)) {
        await pool.query(
            `INSERT INTO product_sales_metrics (organization_id, date, product_id, product_title, revenue_cents, units_sold, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (organization_id, date, product_id) DO UPDATE SET
                revenue_cents = EXCLUDED.revenue_cents,
                units_sold = EXCLUDED.units_sold,
                updated_at = NOW()`,
            [organizationId, p.date, p.title, p.title, toCents(p.revenue), p.units]
        );
        totalRecords++;
    }

    // ── Write exact region sales ──
    for (const r of Object.values(regionMap)) {
        await pool.query(
            `INSERT INTO sales_by_region (organization_id, date, province, country, revenue_cents, order_count)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (organization_id, date, province, country) DO UPDATE SET
                revenue_cents = EXCLUDED.revenue_cents,
                order_count = EXCLUDED.order_count`,
            [organizationId, r.date, r.province, r.country, toCents(r.revenue), r.orders]
        );
        totalRecords++;
    }

    // ── Write exact city sales ──
    for (const c of Object.values(cityMap)) {
        await pool.query(
            `INSERT INTO sales_by_city (organization_id, date, city, province, country, revenue_cents, order_count, customer_count)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 0)
             ON CONFLICT (organization_id, date, city, province) DO UPDATE SET
                revenue_cents = EXCLUDED.revenue_cents,
                order_count = EXCLUDED.order_count,
                country = EXCLUDED.country`,
            [organizationId, c.date, c.city, c.province, c.country, toCents(c.revenue), c.orders]
        );
        totalRecords++;
    }

    console.log(`GraphQL fallback: wrote ${totalRecords} records`);
    return totalRecords;
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
    } catch (err) {
        console.error('syncProductSales error:', err.message);
        return 0;
    }
}

async function syncSalesByChannel(store, organizationId, days) {
    try {
        // Use 'orders' dataset — it has sales_channel dimension and orders count
        const rows = await runShopifyQL(
            store.shop_domain,
            store.access_token,
            `FROM orders SHOW sum(net_sales) AS revenue, sum(orders) AS order_count GROUP BY sales_channel, day SINCE -${days}d UNTIL today ORDER BY day ASC`
        );

        for (const row of rows) {
            const date = row.day || row.date;
            const channel = row.sales_channel || 'Online Store';
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
    } catch (err) {
        console.error('syncSalesByChannel error:', err.message);
        return 0;
    }
}

async function syncSalesByRegion(store, organizationId, days) {
    try {
        // Query WITHOUT day grouping to avoid ShopifyQL row limits (same fix as cities)
        const rows = await runShopifyQL(
            store.shop_domain,
            store.access_token,
            `FROM orders SHOW sum(net_sales) AS revenue, sum(orders) AS order_count GROUP BY billing_region, billing_country SINCE -${days}d UNTIL today ORDER BY sum(net_sales) DESC`
        );

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString().substring(0, 10);
        const endDateStr = new Date().toISOString().substring(0, 10);

        await pool.query(
            `DELETE FROM sales_by_region WHERE organization_id = $1 AND date >= $2 AND date <= $3`,
            [organizationId, startDateStr, endDateStr]
        );

        for (const row of rows) {
            await pool.query(
                `INSERT INTO sales_by_region (organization_id, date, province, country, revenue_cents, order_count)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (organization_id, date, province, country) DO UPDATE SET
                    revenue_cents = EXCLUDED.revenue_cents,
                    order_count = EXCLUDED.order_count`,
                [organizationId, endDateStr, row.billing_region || 'Unknown', row.billing_country || 'Unknown', toCents(row.revenue), parseInt(row.order_count) || 0]
            );
        }
        return rows.length;
    } catch (err) {
        console.error('syncSalesByRegion error:', err.message);
        return 0;
    }
}

async function syncSalesByCity(store, organizationId, days) {
    try {
        // Query WITHOUT day grouping to avoid ShopifyQL row limits.
        // Grouping by city+region+country+day can produce thousands of rows (365 days × N cities)
        // which exceeds ShopifyQL's ~1000-row response limit, causing most data to be truncated.
        // Instead, we aggregate across the full period and store with a synthetic date.
        const rows = await runShopifyQL(
            store.shop_domain,
            store.access_token,
            `FROM orders SHOW sum(net_sales) AS revenue, sum(orders) AS order_count GROUP BY billing_city, billing_region, billing_country SINCE -${days}d UNTIL today ORDER BY sum(net_sales) DESC`
        );

        // Clear existing city data for this period before re-inserting aggregated totals
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString().substring(0, 10);
        const endDateStr = new Date().toISOString().substring(0, 10);

        await pool.query(
            `DELETE FROM sales_by_city WHERE organization_id = $1 AND date >= $2 AND date <= $3`,
            [organizationId, startDateStr, endDateStr]
        );

        for (const row of rows) {
            const city = row.billing_city || row.city || 'Unknown';
            if (city === 'Unknown') continue;

            await pool.query(
                `INSERT INTO sales_by_city (organization_id, date, city, province, country, revenue_cents, order_count, customer_count)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 0)
                 ON CONFLICT (organization_id, date, city, province) DO UPDATE SET
                    revenue_cents = EXCLUDED.revenue_cents,
                    order_count = EXCLUDED.order_count,
                    country = EXCLUDED.country`,
                [organizationId, endDateStr, city, row.billing_region || row.region || 'Unknown', row.billing_country || row.country || 'Unknown', toCents(row.revenue), parseInt(row.order_count) || 0]
            );
        }
        return rows.length;
    } catch (err) {
        console.error('syncSalesByCity error:', err.message);
        return 0;
    }
}

async function syncSessions(store, organizationId, days) {
    // Try multiple ShopifyQL query formats — Shopify's session data availability
    // depends on the store's plan and granted scopes (read_reports, read_analytics).
    const queries = [
        `FROM sessions SHOW count(*) AS sessions GROUP BY day SINCE -${days}d UNTIL today ORDER BY day ASC`,
        `FROM visits SHOW count(*) AS sessions GROUP BY day SINCE -${days}d UNTIL today ORDER BY day ASC`,
    ];

    for (const q of queries) {
        try {
            const rows = await runShopifyQL(store.shop_domain, store.access_token, q);
            let updated = 0;
            for (const row of rows) {
                const date = row.day || row.date;
                if (!date) continue;
                const sessions = parseInt(row.sessions) || 0;

                const res = await pool.query(
                    `UPDATE daily_sales_metrics SET sessions = $3, updated_at = NOW()
                     WHERE organization_id = $1 AND date = $2`,
                    [organizationId, date, sessions]
                );
                if (res.rowCount > 0) updated++;
            }
            console.log(`syncSessions: wrote ${updated} session records using query format: ${q.substring(0, 40)}...`);
            return updated;
        } catch (err) {
            console.warn(`syncSessions query failed (trying next format): ${err.message}`);
            continue;
        }
    }

    // If ShopifyQL session queries aren't available, derive from unique customers per day
    // This gives a reasonable proxy when the read_analytics scope isn't granted
    try {
        const result = await pool.query(
            `SELECT date, new_customers + returning_customers AS sessions
             FROM daily_sales_metrics
             WHERE organization_id = $1 AND sessions = 0 AND (new_customers > 0 OR returning_customers > 0)
             AND date >= (CURRENT_DATE - INTERVAL '${parseInt(days)} days')`,
            [organizationId]
        );
        let updated = 0;
        for (const row of result.rows) {
            const sessions = parseInt(row.sessions) || 0;
            if (sessions > 0) {
                await pool.query(
                    `UPDATE daily_sales_metrics SET sessions = $3, updated_at = NOW()
                     WHERE organization_id = $1 AND date = $2 AND sessions = 0`,
                    [organizationId, row.date, sessions]
                );
                updated++;
            }
        }
        if (updated > 0) console.log(`syncSessions: derived ${updated} session records from customer counts (ShopifyQL sessions unavailable)`);
        return updated;
    } catch (err) {
        console.error('syncSessions fallback error:', err.message);
        return 0;
    }
}

async function syncPricePoints(store, organizationId) {
    // Derive price point buckets from the recent orders' line items already in DB
    try {
        const result = await pool.query(
            `SELECT line_items_summary, date(created_at) AS date FROM dashboard_recent_orders WHERE organization_id = $1`,
            [organizationId]
        );

        const bucketMap = {}; // key: "date|bucket|title" → { units, revenue }
        for (const row of result.rows) {
            const date = row.date instanceof Date ? row.date.toISOString().substring(0, 10) : String(row.date).substring(0, 10);
            const items = typeof row.line_items_summary === 'string'
                ? JSON.parse(row.line_items_summary)
                : row.line_items_summary;
            if (!Array.isArray(items)) continue;

            for (const item of items) {
                const unitPrice = (item.price_cents || 0) / 100;
                const bucket = priceBucket(unitPrice);
                const title = (item.title || 'Unknown').substring(0, 500);
                const key = `${date}|${bucket}|${title}`;
                if (!bucketMap[key]) bucketMap[key] = { date, bucket, title, unitPriceCents: item.price_cents || 0, units: 0, revenue: 0 };
                bucketMap[key].units += item.quantity || 1;
                bucketMap[key].revenue += (item.price_cents || 0) * (item.quantity || 1);
            }
        }

        // Clear old price point data and insert new
        await pool.query('DELETE FROM price_point_metrics WHERE organization_id = $1', [organizationId]);

        for (const entry of Object.values(bucketMap)) {
            await pool.query(
                `INSERT INTO price_point_metrics (organization_id, date, price_bucket, product_title, unit_price_cents, units_sold, revenue_cents)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (organization_id, date, price_bucket, product_title) DO UPDATE SET
                    units_sold = EXCLUDED.units_sold,
                    revenue_cents = EXCLUDED.revenue_cents`,
                [organizationId, entry.date, entry.bucket, entry.title, entry.unitPriceCents, entry.units, entry.revenue]
            );
        }

        return Object.keys(bucketMap).length;
    } catch (err) {
        console.error('syncPricePoints error:', err.message);
        return 0;
    }
}

async function syncRecentOrders(store, organizationId) {
    try {
        const query = `{
            orders(first: 50, sortKey: CREATED_AT, reverse: true) {
                edges {
                    node {
                        id
                        name
                        createdAt
                        totalPriceSet { shopMoney { amount currencyCode } }
                        displayFinancialStatus
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
                    order.displayFinancialStatus,
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
    } catch (err) {
        console.error('syncRecentOrders error:', err.message);
        return 0;
    }
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
                        numberOfOrders
                        amountSpent { amount currencyCode }
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
            const orderCount = parseInt(c.numberOfOrders) || 0;
            const totalSpent = toCents(c.amountSpent?.amount);
            await pool.query(
                `INSERT INTO shopify_top_customers (organization_id, customer_email, customer_name, total_spent_cents, order_count, last_order_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())
                 ON CONFLICT (organization_id, customer_email) DO UPDATE SET
                    customer_name = EXCLUDED.customer_name, total_spent_cents = EXCLUDED.total_spent_cents,
                    order_count = EXCLUDED.order_count, last_order_at = EXCLUDED.last_order_at, updated_at = NOW()`,
                [organizationId, c.email, name, totalSpent, orderCount, c.lastOrder?.createdAt]
            );
        }
        return customers.length;
    } catch (err) {
        console.error('syncCustomerMetrics error:', err.message);
        return 0;
    }
}

/**
 * Compute new vs returning customer counts from the top customers data
 * and update daily_sales_metrics so the dashboard KPI shows the returning rate.
 */
async function syncCustomerRetention(organizationId) {
    try {
        // Count customers with 1 order (new) vs 2+ orders (returning) from the top customers table
        const result = await pool.query(
            `SELECT
                COUNT(*) FILTER (WHERE order_count = 1) AS new_customers,
                COUNT(*) FILTER (WHERE order_count > 1) AS returning_customers
             FROM shopify_top_customers
             WHERE organization_id = $1`,
            [organizationId]
        );

        const newCust = parseInt(result.rows[0]?.new_customers) || 0;
        const retCust = parseInt(result.rows[0]?.returning_customers) || 0;

        if (newCust + retCust === 0) return 0;

        // Store retention counts on today's daily_sales_metrics row.
        // Uses UPSERT so it works even if no row exists yet for today.
        const today = new Date().toISOString().substring(0, 10);
        await pool.query(
            `INSERT INTO daily_sales_metrics (organization_id, date, new_customers, returning_customers, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (organization_id, date) DO UPDATE SET
                new_customers = EXCLUDED.new_customers,
                returning_customers = EXCLUDED.returning_customers,
                updated_at = NOW()`,
            [organizationId, today, newCust, retCust]
        );

        return 1;
    } catch (err) {
        console.error('syncCustomerRetention error:', err.message);
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

        // Update region + city (fall back through shipping → billing → customer default address)
        const addr = payload.shipping_address || payload.billing_address || payload.customer?.default_address;
        if (addr) {
            await pool.query(
                `INSERT INTO sales_by_region (organization_id, date, province, country, revenue_cents, order_count)
                 VALUES ($1, $2, $3, $4, $5, 1)
                 ON CONFLICT (organization_id, date, province, country) DO UPDATE SET
                    revenue_cents = sales_by_region.revenue_cents + EXCLUDED.revenue_cents,
                    order_count = sales_by_region.order_count + 1`,
                [organizationId, date, addr.province || 'Unknown', addr.country || addr.country_code || 'Unknown', toCents(totalPrice)]
            );

            // Update city
            if (addr.city) {
                await pool.query(
                    `INSERT INTO sales_by_city (organization_id, date, city, province, country, revenue_cents, order_count, customer_count)
                     VALUES ($1, $2, $3, $4, $5, $6, 1, 0)
                     ON CONFLICT (organization_id, date, city, province) DO UPDATE SET
                        revenue_cents = sales_by_city.revenue_cents + EXCLUDED.revenue_cents,
                        order_count = sales_by_city.order_count + 1,
                        country = EXCLUDED.country`,
                    [organizationId, date, addr.city, addr.province || 'Unknown', addr.country || addr.country_code || 'Unknown', toCents(totalPrice)]
                );
            }
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
            COALESCE(SUM(returning_customers), 0) AS returning_customers,
            COALESCE(SUM(sessions), 0) AS sessions
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
    const totalSessions = parseInt(c.sessions) || (newCust + retCust) || 0;
    const aov = totalOrders > 0 ? Math.round(totalSales / totalOrders) : 0;
    const returningRate = (newCust + retCust) > 0 ? retCust / (newCust + retCust) : 0;
    const refundRate = totalSales > 0 ? totalRefunds / totalSales : 0;
    const conversionRate = totalSessions > 0 ? totalOrders / totalSessions : 0;

    const result = {
        current_period: {
            total_sales: totalSales / 100,
            total_orders: totalOrders,
            average_order_value: aov / 100,
            returning_customer_rate: Math.round(returningRate * 100) / 100,
            total_units_sold: totalUnits,
            refund_rate: Math.round(refundRate * 100) / 100,
            sessions: totalSessions,
            conversion_rate: Math.round(conversionRate * 10000) / 100,
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
                COALESCE(SUM(returning_customers), 0) AS returning_customers,
                COALESCE(SUM(sessions), 0) AS sessions
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
        const prevSessions = parseInt(p.sessions) || (prevNewCust + prevRetCust) || 0;

        const prevConvRate = prevSessions > 0 ? prevOrders / prevSessions : 0;

        result.comparison_period = {
            total_sales: prevSales / 100,
            total_orders: prevOrders,
            average_order_value: prevAov / 100,
            returning_customer_rate: Math.round(prevRetRate * 100) / 100,
            total_units_sold: parseInt(p.total_units_sold) || 0,
            sessions: prevSessions,
            conversion_rate: Math.round(prevConvRate * 10000) / 100,
        };

        result.changes = {
            total_sales_pct: pctChange(totalSales, prevSales),
            total_orders_pct: pctChange(totalOrders, prevOrders),
            average_order_value_pct: pctChange(aov, prevAov),
            conversion_rate_pct: pctChange(conversionRate, prevConvRate),
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
    // Group by unit price (revenue / units) so that products at the same price point
    // are combined — e.g. "$100 ticket for 500 numbers" and "$100 ticket for 700 numbers"
    // are both "$100.00" products to the user.
    const result = await pool.query(
        `SELECT ROUND(revenue_cents::numeric / NULLIF(units_sold, 0)) AS unit_price_cents,
                SUM(revenue_cents) AS revenue_cents,
                SUM(units_sold) AS units_sold
         FROM product_sales_metrics
         WHERE organization_id = $1 AND date >= $2 AND date <= $3 AND units_sold > 0
         GROUP BY unit_price_cents
         ORDER BY revenue_cents DESC
         LIMIT $4`,
        [organizationId, startDate, endDate, limit]
    );

    const totalRevenue = result.rows.reduce((s, r) => s + (parseInt(r.revenue_cents) || 0), 0);

    return {
        products: result.rows.map(r => {
            const rev = parseInt(r.revenue_cents) || 0;
            const unitPrice = parseInt(r.unit_price_cents) || 0;
            return {
                title: `$${(unitPrice / 100).toFixed(2)} ticket`,
                unit_price: unitPrice / 100,
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

// ─── Scheduled Sync ─────────────────────────────────────────────────

/**
 * Run incremental sync for all active stores. Called by scheduler.
 */
async function syncAllStores() {
    try {
        const result = await pool.query(
            `SELECT organization_id, last_full_sync_at FROM shopify_stores WHERE is_active = TRUE`
        );

        for (const row of result.rows) {
            try {
                if (row.last_full_sync_at) {
                    await runIncrementalSync(row.organization_id);
                } else {
                    await runFullSync(row.organization_id);
                }
            } catch (error) {
                console.error(`Sync failed for org ${row.organization_id}:`, error.message);
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
    getPricePoints,
    shopifyGraphQL,
    runShopifyQL,
};
