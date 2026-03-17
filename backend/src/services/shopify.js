/**
 * Shopify API Service
 * Queries Shopify REST Admin API (2024-01) directly for orders/customers/analytics.
 * Only products are synced locally (small catalog). Everything else is live.
 */

const pool = require('../../config/database');

const SHOPIFY_API_VERSION = '2024-01';

/**
 * Make an authenticated request to the Shopify Admin REST API.
 */
async function shopifyFetch(shopDomain, accessToken, endpoint, options = {}) {
    const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}${endpoint}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
        const response = await fetch(url, {
            method: options.method || 'GET',
            headers: {
                'X-Shopify-Access-Token': accessToken,
                'Content-Type': 'application/json',
                ...options.headers
            },
            body: options.body ? JSON.stringify(options.body) : undefined,
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`Shopify API error ${response.status}: ${errorText}`);
        }

        if (response.status === 204) return {};
        return response.json();
    } catch (err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') {
            throw new Error(`Shopify API request timed out: ${endpoint}`);
        }
        throw err;
    }
}

/**
 * Fetch all pages of a paginated Shopify resource using Link header pagination.
 * Used only for products (small catalog).
 */
async function shopifyFetchAll(shopDomain, accessToken, endpoint, resourceKey) {
    const allRecords = [];
    let url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}${endpoint}`;

    while (url) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        try {
            const response = await fetch(url, {
                headers: {
                    'X-Shopify-Access-Token': accessToken,
                    'Content-Type': 'application/json'
                },
                signal: controller.signal
            });
            clearTimeout(timeout);

            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                throw new Error(`Shopify API error ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            if (data[resourceKey]) {
                allRecords.push(...data[resourceKey]);
            }

            const linkHeader = response.headers.get('link');
            url = null;
            if (linkHeader) {
                const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
                if (nextMatch) {
                    url = nextMatch[1];
                }
            }
        } catch (err) {
            clearTimeout(timeout);
            if (err.name === 'AbortError') {
                throw new Error(`Shopify API timeout fetching ${resourceKey} (had ${allRecords.length} records)`);
            }
            throw err;
        }
    }

    return allRecords;
}

// ─── Store Connection ────────────────────────────────────────────────

async function getStoreConnection(organizationId) {
    const result = await pool.query(
        'SELECT * FROM shopify_stores WHERE organization_id = $1 AND is_active = TRUE',
        [organizationId]
    );
    return result.rows[0] || null;
}

async function saveStoreConnection(organizationId, { shopDomain, accessToken, scope }) {
    const result = await pool.query(
        `INSERT INTO shopify_stores (id, organization_id, shop_domain, access_token, scope)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)
         ON CONFLICT (organization_id) DO UPDATE SET
            shop_domain = EXCLUDED.shop_domain,
            access_token = EXCLUDED.access_token,
            scope = EXCLUDED.scope,
            is_active = TRUE,
            updated_at = NOW()
         RETURNING *`,
        [organizationId, shopDomain, accessToken, scope]
    );
    return result.rows[0];
}

async function disconnectStore(organizationId) {
    await pool.query(
        'UPDATE shopify_stores SET is_active = FALSE, updated_at = NOW() WHERE organization_id = $1',
        [organizationId]
    );
}

// ─── Products (local sync — small catalog) ───────────────────────────

async function syncProducts(organizationId) {
    const store = await getStoreConnection(organizationId);
    if (!store) throw new Error('No Shopify store connected');

    const products = await shopifyFetchAll(
        store.shop_domain,
        store.access_token,
        '/products.json?limit=250&status=active',
        'products'
    );

    for (const product of products) {
        const tags = product.tags ? product.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
        const variants = product.variants || [];
        const images = product.images || [];
        const featuredImage = product.image?.src || images[0]?.src || null;

        await pool.query(
            `INSERT INTO shopify_products
                (id, organization_id, shopify_product_id, title, body_html, vendor, product_type, handle, status, tags, variants, images, featured_image_url, created_at_shopify, updated_at_shopify, synced_at)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
             ON CONFLICT (organization_id, shopify_product_id) DO UPDATE SET
                title = EXCLUDED.title,
                body_html = EXCLUDED.body_html,
                vendor = EXCLUDED.vendor,
                product_type = EXCLUDED.product_type,
                handle = EXCLUDED.handle,
                status = EXCLUDED.status,
                tags = EXCLUDED.tags,
                variants = EXCLUDED.variants,
                images = EXCLUDED.images,
                featured_image_url = EXCLUDED.featured_image_url,
                updated_at_shopify = EXCLUDED.updated_at_shopify,
                synced_at = NOW()`,
            [
                organizationId,
                product.id,
                product.title,
                product.body_html,
                product.vendor,
                product.product_type,
                product.handle,
                product.status || 'active',
                tags,
                JSON.stringify(variants),
                JSON.stringify(images),
                featuredImage,
                product.created_at,
                product.updated_at
            ]
        );
    }

    const shopifyIds = products.map(p => p.id);
    if (shopifyIds.length > 0) {
        await pool.query(
            `DELETE FROM shopify_products
             WHERE organization_id = $1 AND shopify_product_id != ALL($2::bigint[])`,
            [organizationId, shopifyIds]
        );
    }

    await pool.query(
        'UPDATE shopify_stores SET last_products_sync_at = NOW(), updated_at = NOW() WHERE organization_id = $1',
        [organizationId]
    );

    return { synced: products.length };
}

async function getProducts(organizationId, { limit = 50, offset = 0, search = '' } = {}) {
    let query = 'SELECT * FROM shopify_products WHERE organization_id = $1';
    const params = [organizationId];

    if (search) {
        params.push(`%${search}%`);
        query += ` AND (title ILIKE $${params.length} OR vendor ILIKE $${params.length} OR product_type ILIKE $${params.length})`;
    }

    query += ' ORDER BY title ASC';
    params.push(limit);
    query += ` LIMIT $${params.length}`;
    params.push(offset);
    query += ` OFFSET $${params.length}`;

    const result = await pool.query(query, params);
    return result.rows;
}

async function getProductCount(organizationId) {
    const result = await pool.query(
        'SELECT COUNT(*) FROM shopify_products WHERE organization_id = $1',
        [organizationId]
    );
    return parseInt(result.rows[0].count);
}

// ─── Live Analytics (direct Shopify API) ─────────────────────────────

// In-memory cache: { key: { data, ts } }
const _analyticsCache = {};
const ANALYTICS_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

/**
 * Get analytics using pre-computed data from the dashboard tables.
 * NEVER fetches individual orders — uses count endpoints and local DB only.
 * Results are cached for 2 minutes.
 */
async function getLiveAnalytics(organizationId, { days = 30 } = {}) {
    const cacheKey = `${organizationId}:${days}`;
    const cached = _analyticsCache[cacheKey];
    if (cached && (Date.now() - cached.ts) < ANALYTICS_CACHE_TTL) {
        return cached.data;
    }
    const store = await getStoreConnection(organizationId);
    if (!store) throw new Error('No Shopify store connected');

    const now = new Date();
    const sinceDate = new Date(now);
    sinceDate.setDate(sinceDate.getDate() - days);
    const startDate = sinceDate.toISOString().substring(0, 10);
    const endDate = now.toISOString().substring(0, 10);

    // Use lightweight count endpoints + pre-computed local data
    const [orderCountData, totalCustomerData, newCustomerData, dailyData, topProductData, topCustomerData] = await Promise.all([
        shopifyFetch(store.shop_domain, store.access_token,
            `/orders/count.json?status=any&created_at_min=${sinceDate.toISOString()}`),
        shopifyFetch(store.shop_domain, store.access_token,
            `/customers/count.json`),
        shopifyFetch(store.shop_domain, store.access_token,
            `/customers/count.json?created_at_min=${sinceDate.toISOString()}`),
        pool.query(
            `SELECT date, COALESCE(SUM(net_sales_cents), 0) AS revenue_cents, COALESCE(SUM(total_orders), 0) AS orders
             FROM daily_sales_metrics WHERE organization_id = $1 AND date >= $2 AND date <= $3
             GROUP BY date ORDER BY date ASC`,
            [organizationId, startDate, endDate]),
        pool.query(
            `SELECT product_title, SUM(revenue_cents) AS revenue_cents, SUM(units_sold) AS units_sold
             FROM product_sales_metrics WHERE organization_id = $1 AND date >= $2 AND date <= $3
             GROUP BY product_title ORDER BY revenue_cents DESC LIMIT 10`,
            [organizationId, startDate, endDate]),
        pool.query(
            `SELECT customer_name, customer_email, total_spent_cents, order_count
             FROM shopify_top_customers WHERE organization_id = $1
             ORDER BY total_spent_cents DESC LIMIT 10`,
            [organizationId]),
    ]);

    const totalOrderCount = orderCountData.count || 0;
    const totalCustomerCount = totalCustomerData.count || 0;
    const newCustomerCount = newCustomerData.count || 0;

    // Compute totals from daily data
    let totalRevenueCents = 0;
    const dailyMap = {};
    for (const row of dailyData.rows) {
        const rev = parseInt(row.revenue_cents) || 0;
        totalRevenueCents += rev;
        const dateStr = row.date instanceof Date ? row.date.toISOString().substring(0, 10) : row.date;
        dailyMap[dateStr] = { date: dateStr, orders: parseInt(row.orders) || 0, revenue: rev / 100 };
    }
    const totalRevenue = totalRevenueCents / 100;
    const avgOrderValue = totalOrderCount > 0 ? totalRevenue / totalOrderCount : 0;

    // Top products
    const topProducts = topProductData.rows.map(r => ({
        product_title: r.product_title,
        total_quantity: parseInt(r.units_sold) || 0,
        total_revenue: (parseInt(r.revenue_cents) || 0) / 100,
        unit_price: (parseInt(r.units_sold) || 0) > 0 ? ((parseInt(r.revenue_cents) || 0) / 100) / (parseInt(r.units_sold) || 0) : 0
    }));

    // Whales from pre-computed table
    const whales = topCustomerData.rows.map(r => ({
        name: r.customer_name,
        email: r.customer_email,
        total_spent: (parseInt(r.total_spent_cents) || 0) / 100,
        order_count: parseInt(r.order_count) || 0
    }));

    // Daily revenue for last 7 days (zero-filled)
    const daily = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        daily.push(dailyMap[key] || { date: key, orders: 0, revenue: 0 });
    }

    const result = {
        summary: {
            total_orders: totalOrderCount,
            total_revenue: totalRevenue.toFixed(2),
            avg_order_value: avgOrderValue.toFixed(2),
            unique_customers: 0,
            total_customers: totalCustomerCount,
            new_customers: newCustomerCount,
            transactions_per_customer: 0,
            new_buyers: 0,
            returning_buyers: 0,
            repeat_rate: 0
        },
        previousPeriod: {
            total_orders: 0,
            total_revenue: '0.00',
            avg_order_value: '0.00'
        },
        daily,
        topProducts,
        cityBreakdown: [],
        packageBreakdown: [],
        whales
    };

    _analyticsCache[cacheKey] = { data: result, ts: Date.now() };
    return result;
}

// ─── Live Order Lookup (direct Shopify API) ──────────────────────────

/**
 * Look up orders by order number or email directly from Shopify.
 */
async function lookupOrder(organizationId, { orderNumber, email, customerName }) {
    const store = await getStoreConnection(organizationId);
    if (!store) return [];

    if (orderNumber) {
        const cleaned = orderNumber.replace(/^#/, '');
        const data = await shopifyFetch(store.shop_domain, store.access_token,
            `/orders.json?name=%23${cleaned}&status=any&limit=5`);
        return (data.orders || []).map(normalizeOrder);
    }

    if (email) {
        const data = await shopifyFetch(store.shop_domain, store.access_token,
            `/orders.json?email=${encodeURIComponent(email.toLowerCase())}&status=any&limit=10`);
        return (data.orders || []).map(normalizeOrder);
    }

    // Search by customer name: find matching customers first, then fetch their orders
    if (customerName) {
        const customers = await searchCustomers(organizationId, customerName);
        if (customers.length === 0) return [];

        const allOrders = [];
        // Fetch orders for up to 3 matching customers to avoid excessive API calls
        for (const cust of customers.slice(0, 3)) {
            if (cust.email) {
                const data = await shopifyFetch(store.shop_domain, store.access_token,
                    `/orders.json?email=${encodeURIComponent(cust.email)}&status=any&limit=10`);
                allOrders.push(...(data.orders || []).map(normalizeOrder));
            }
        }
        return allOrders;
    }

    return [];
}

/**
 * Look up a customer by email directly from Shopify.
 */
async function lookupCustomer(organizationId, email) {
    const store = await getStoreConnection(organizationId);
    if (!store) return null;

    const data = await shopifyFetch(store.shop_domain, store.access_token,
        `/customers/search.json?query=email:${encodeURIComponent(email)}&limit=1`);
    const customer = data.customers?.[0];
    if (!customer) return null;

    return normalizeCustomer(customer);
}

/**
 * Search customers by name, email, or general query from Shopify.
 */
async function searchCustomers(organizationId, query) {
    const store = await getStoreConnection(organizationId);
    if (!store) return [];

    const data = await shopifyFetch(store.shop_domain, store.access_token,
        `/customers/search.json?query=${encodeURIComponent(query)}&limit=10`);
    return (data.customers || []).map(normalizeCustomer);
}

/**
 * Normalize a Shopify customer into a flat object.
 */
function normalizeCustomer(customer) {
    return {
        first_name: customer.first_name,
        last_name: customer.last_name,
        email: customer.email,
        phone: customer.phone,
        orders_count: customer.orders_count || 0,
        total_spent: customer.total_spent || '0.00',
        city: customer.default_address?.city,
        province: customer.default_address?.province,
        country: customer.default_address?.country_code
    };
}

/**
 * Normalize a Shopify API order into a flat object matching our context format.
 */
function normalizeOrder(order) {
    const customerName = order.customer
        ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim()
        : '';

    return {
        order_number: order.name || `#${order.order_number}`,
        email: order.email,
        financial_status: order.financial_status,
        fulfillment_status: order.fulfillment_status,
        total_price: parseFloat(order.total_price) || 0,
        currency: order.currency || 'CAD',
        customer_name: customerName,
        customer_email: order.customer?.email || order.email,
        line_items: order.line_items || [],
        note: order.note,
        created_at_shopify: order.created_at
    };
}

// ─── AI Context Builders ────────────────────────────────────────────

/**
 * Build Shopify context for AI tools by querying Shopify API directly.
 */
async function buildContextForInquiry(organizationId, inquiry) {
    const store = await getStoreConnection(organizationId);
    if (!store) return null;

    const contextParts = [];

    // Try to extract an order number from the inquiry
    const orderMatch = inquiry.match(/#?\d{3,}/);
    if (orderMatch) {
        const orderNumber = orderMatch[0];
        const orders = await lookupOrder(organizationId, { orderNumber });
        if (orders.length > 0) {
            contextParts.push(formatOrderContext(orders));
        }
    }

    // Try to extract an email from the inquiry
    const emailMatch = inquiry.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
    if (emailMatch) {
        const email = emailMatch[0].toLowerCase();
        const orders = await lookupOrder(organizationId, { email });
        if (orders.length > 0) {
            contextParts.push(formatOrderContext(orders));
        }

        const customer = await lookupCustomer(organizationId, email);
        if (customer) {
            contextParts.push(formatCustomerContext(customer));
        }
    }

    // For general Shopify/store questions, inject a quick summary
    const shopifyKeywords = /\b(shopify|store|order[s]?|sale[s]?|revenue|product[s]?|customer[s]?|inventory|refund|fulfill|shipping|best.?sell)/i;
    if (contextParts.length === 0 && shopifyKeywords.test(inquiry)) {
        try {
            const summary = await buildAnalyticsSummary(organizationId, { days: 30 });
            if (summary) contextParts.push(summary);
        } catch {
            // Continue without analytics
        }
    }

    if (contextParts.length === 0) return null;

    return `\n\n--- SHOPIFY STORE DATA ---\nThe following real-time data was pulled from the organization's Shopify store. Use this data to provide accurate, specific responses. Reference actual order numbers, amounts, and statuses.\n\n${contextParts.join('\n\n')}`;
}

/**
 * Build product catalog context for draft/content generation.
 */
async function buildProductContext(organizationId, { limit = 10, search = '' } = {}) {
    const store = await getStoreConnection(organizationId);
    if (!store) return null;

    const products = await getProducts(organizationId, { limit, search });
    if (products.length === 0) return null;

    const productList = products.map(p => {
        const variants = p.variants || [];
        const priceRange = variants.length > 0
            ? variants.map(v => parseFloat(v.price)).filter(Boolean)
            : [];
        const minPrice = priceRange.length > 0 ? Math.min(...priceRange) : null;
        const maxPrice = priceRange.length > 0 ? Math.max(...priceRange) : null;
        const priceStr = minPrice !== null
            ? (minPrice === maxPrice ? `$${minPrice.toFixed(2)}` : `$${minPrice.toFixed(2)} - $${maxPrice.toFixed(2)}`)
            : 'Price not available';

        const totalInventory = variants.reduce((sum, v) => sum + (v.inventory_quantity || 0), 0);

        return `- ${p.title} (${priceStr}, ${totalInventory} in stock) [${p.product_type || 'General'}]${p.vendor ? ` by ${p.vendor}` : ''}`;
    }).join('\n');

    return `\n\n--- SHOPIFY PRODUCT CATALOG ---\n${productList}`;
}

/**
 * Build a summary of Shopify store analytics for Ask Lightspeed.
 * Uses pre-computed data from dashboard tables.
 */
async function buildAnalyticsSummary(organizationId, { days = 30 } = {}) {
    const store = await getStoreConnection(organizationId);
    if (!store) return null;

    const analytics = await getLiveAnalytics(organizationId, { days });
    const s = analytics.summary;
    const productCount = await getProductCount(organizationId);

    let summary = `\n\n--- SHOPIFY STORE SUMMARY (Last ${days} days) ---`;
    summary += `\nOrders: ${s.total_orders} | Revenue: $${parseFloat(s.total_revenue).toFixed(2)} | Avg Order: $${parseFloat(s.avg_order_value).toFixed(2)}`;
    summary += `\nTotal Customers: ${s.total_customers} | New Customers: ${s.new_customers}`;
    summary += `\nTotal Products: ${productCount}`;

    if (analytics.topProducts.length > 0) {
        summary += '\n\nTop Products by Revenue:';
        analytics.topProducts.forEach((p, i) => {
            summary += `\n  ${i + 1}. ${p.product_title}: ${p.total_quantity} sold, $${parseFloat(p.total_revenue).toFixed(2)}`;
        });
    }

    return summary;
}

// ─── Formatting Helpers ──────────────────────────────────────────────

function formatOrderContext(orders) {
    return orders.map(o => {
        const items = (o.line_items || []).map(li =>
            `    - ${li.title || li.name} x${li.quantity} ($${li.price})`
        ).join('\n');

        return `Order ${o.order_number}:
  Status: ${o.financial_status || 'unknown'} | Fulfillment: ${o.fulfillment_status || 'unfulfilled'}
  Customer: ${o.customer_name} (${o.customer_email})
  Total: $${o.total_price} ${o.currency}
  Date: ${new Date(o.created_at_shopify).toLocaleDateString('en-CA')}
  Items:
${items}${o.note ? `\n  Note: ${o.note}` : ''}`;
    }).join('\n\n');
}

function formatCustomerContext(customer) {
    return `Customer Profile:
  Name: ${customer.first_name} ${customer.last_name}
  Email: ${customer.email}${customer.phone ? `\n  Phone: ${customer.phone}` : ''}
  Location: ${[customer.city, customer.province, customer.country].filter(Boolean).join(', ')}
  Orders: ${customer.orders_count} | Total Spent: $${parseFloat(customer.total_spent).toFixed(2)}`;
}

// ─── Webhook Registration ────────────────────────────────────────────

const WEBHOOK_TOPICS = [
    'products/create',
    'products/update',
    'products/delete',
    'orders/create',
    'orders/updated',
    'orders/cancelled',
    'refunds/create',
    'fulfillments/create',
    'fulfillments/update',
];

async function registerWebhooks(organizationId, webhookBaseUrl) {
    const store = await getStoreConnection(organizationId);
    if (!store) throw new Error('No Shopify store connected');

    const callbackUrl = `${webhookBaseUrl}/api/shopify/webhook`;
    const registered = [];
    const failed = [];

    let existingWebhooks = [];
    try {
        const data = await shopifyFetch(store.shop_domain, store.access_token, '/webhooks.json');
        existingWebhooks = data.webhooks || [];
    } catch {
        // Proceed with registration anyway
    }

    const existingTopics = new Set(existingWebhooks.map(w => w.topic));

    for (const topic of WEBHOOK_TOPICS) {
        if (existingTopics.has(topic)) {
            registered.push(topic);
            continue;
        }

        try {
            await shopifyFetch(store.shop_domain, store.access_token, '/webhooks.json', {
                method: 'POST',
                body: {
                    webhook: {
                        topic,
                        address: callbackUrl,
                        format: 'json'
                    }
                }
            });
            registered.push(topic);
        } catch (error) {
            console.error(`Failed to register webhook ${topic}:`, error.message);
            failed.push(topic);
        }
    }

    await pool.query(
        `UPDATE shopify_stores
         SET webhooks_registered = TRUE, webhook_url = $2, updated_at = NOW()
         WHERE organization_id = $1`,
        [organizationId, callbackUrl]
    );

    return { registered: registered.length, failed };
}

async function unregisterWebhooks(organizationId) {
    const store = await getStoreConnection(organizationId);
    if (!store) return;

    try {
        const data = await shopifyFetch(store.shop_domain, store.access_token, '/webhooks.json');
        const webhooks = data.webhooks || [];

        for (const webhook of webhooks) {
            try {
                await shopifyFetch(store.shop_domain, store.access_token, `/webhooks/${webhook.id}.json`, {
                    method: 'DELETE'
                });
            } catch {
                // Best-effort cleanup
            }
        }
    } catch {
        // Store may already be inaccessible
    }

    await pool.query(
        `UPDATE shopify_stores
         SET webhooks_registered = FALSE, webhook_url = NULL, updated_at = NOW()
         WHERE organization_id = $1`,
        [organizationId]
    );
}

// ─── Webhook Handlers (Products only) ────────────────────────────────

async function getOrgByShopDomain(shopDomain) {
    const result = await pool.query(
        'SELECT organization_id FROM shopify_stores WHERE shop_domain = $1 AND is_active = TRUE',
        [shopDomain]
    );
    return result.rows[0]?.organization_id || null;
}

async function handleProductUpsert(organizationId, product) {
    const tags = product.tags ? product.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const variants = product.variants || [];
    const images = product.images || [];
    const featuredImage = product.image?.src || images[0]?.src || null;

    await pool.query(
        `INSERT INTO shopify_products
            (id, organization_id, shopify_product_id, title, body_html, vendor, product_type, handle, status, tags, variants, images, featured_image_url, created_at_shopify, updated_at_shopify, synced_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
         ON CONFLICT (organization_id, shopify_product_id) DO UPDATE SET
            title = EXCLUDED.title,
            body_html = EXCLUDED.body_html,
            vendor = EXCLUDED.vendor,
            product_type = EXCLUDED.product_type,
            handle = EXCLUDED.handle,
            status = EXCLUDED.status,
            tags = EXCLUDED.tags,
            variants = EXCLUDED.variants,
            images = EXCLUDED.images,
            featured_image_url = EXCLUDED.featured_image_url,
            updated_at_shopify = EXCLUDED.updated_at_shopify,
            synced_at = NOW()`,
        [
            organizationId,
            product.id,
            product.title,
            product.body_html,
            product.vendor,
            product.product_type,
            product.handle,
            product.status || 'active',
            tags,
            JSON.stringify(variants),
            JSON.stringify(images),
            featuredImage,
            product.created_at,
            product.updated_at
        ]
    );
}

async function handleProductDelete(organizationId, payload) {
    await pool.query(
        'DELETE FROM shopify_products WHERE organization_id = $1 AND shopify_product_id = $2',
        [organizationId, payload.id]
    );
}

/**
 * Main webhook dispatcher — handles product and order events.
 */
async function handleWebhookEvent(shopDomain, topic, payload) {
    const organizationId = await getOrgByShopDomain(shopDomain);
    if (!organizationId) {
        return { handled: false, reason: 'unknown_shop', shopDomain };
    }

    switch (topic) {
        case 'products/create':
        case 'products/update':
            await handleProductUpsert(organizationId, payload);
            return { handled: true, topic, shopifyId: payload.id };

        case 'products/delete':
            await handleProductDelete(organizationId, payload);
            return { handled: true, topic, shopifyId: payload.id };

        case 'orders/create':
        case 'orders/updated':
        case 'orders/cancelled':
        case 'refunds/create':
        case 'fulfillments/create':
        case 'fulfillments/update': {
            // Delegate to analytics service for dashboard updates
            try {
                const shopifyAnalytics = require('./shopifyAnalytics');
                await shopifyAnalytics.handleOrderWebhook(organizationId, topic, payload);
            } catch (err) {
                console.error('Analytics webhook handler error:', err.message);
            }
            return { handled: true, topic, shopifyId: payload.id };
        }

        default:
            return { handled: false, reason: 'unhandled_topic', topic };
    }
}

module.exports = {
    // Store connection
    getStoreConnection,
    saveStoreConnection,
    disconnectStore,

    // Products (local sync)
    syncProducts,
    getProducts,
    getProductCount,

    // Live analytics (direct API)
    getLiveAnalytics,

    // Live lookups (direct API)
    lookupOrder,
    lookupCustomer,
    searchCustomers,

    // AI Context
    buildContextForInquiry,
    buildProductContext,
    buildAnalyticsSummary,

    // Webhooks (products only)
    registerWebhooks,
    unregisterWebhooks,
    handleWebhookEvent,
    getOrgByShopDomain
};
