/**
 * Shopify API Service
 * Handles all communication with the Shopify REST Admin API (2024-01)
 */

const pool = require('../../config/database');

const SHOPIFY_API_VERSION = '2024-01';

/**
 * Make an authenticated request to the Shopify Admin REST API.
 *
 * @param {string} shopDomain - e.g. "mystore.myshopify.com"
 * @param {string} accessToken - Shopify access token
 * @param {string} endpoint - e.g. "/products.json"
 * @param {Object} options - fetch options override
 * @returns {Promise<Object>} Parsed JSON response
 */
async function shopifyFetch(shopDomain, accessToken, endpoint, options = {}) {
    const url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}${endpoint}`;

    const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
            ...options.headers
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Shopify API error ${response.status}: ${errorText}`);
    }

    // Handle 204 No Content
    if (response.status === 204) return {};

    return response.json();
}

/**
 * Fetch all pages of a paginated Shopify resource using Link header pagination.
 *
 * @param {string} shopDomain
 * @param {string} accessToken
 * @param {string} endpoint - e.g. "/products.json?limit=250"
 * @param {string} resourceKey - e.g. "products"
 * @returns {Promise<Array>} All records across pages
 */
async function shopifyFetchAll(shopDomain, accessToken, endpoint, resourceKey) {
    const allRecords = [];
    let url = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}${endpoint}`;

    while (url) {
        const response = await fetch(url, {
            headers: {
                'X-Shopify-Access-Token': accessToken,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(`Shopify API error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        if (data[resourceKey]) {
            allRecords.push(...data[resourceKey]);
        }

        // Parse Link header for next page
        const linkHeader = response.headers.get('link');
        url = null;
        if (linkHeader) {
            const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
            if (nextMatch) {
                url = nextMatch[1];
            }
        }
    }

    return allRecords;
}

// ─── Store Connection ────────────────────────────────────────────────

/**
 * Get the Shopify store connection for an organization.
 * @param {string} organizationId
 * @returns {Promise<Object|null>}
 */
async function getStoreConnection(organizationId) {
    const result = await pool.query(
        'SELECT * FROM shopify_stores WHERE organization_id = $1 AND is_active = TRUE',
        [organizationId]
    );
    return result.rows[0] || null;
}

/**
 * Save or update a Shopify store connection.
 */
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

/**
 * Disconnect a Shopify store (soft delete).
 */
async function disconnectStore(organizationId) {
    await pool.query(
        'UPDATE shopify_stores SET is_active = FALSE, updated_at = NOW() WHERE organization_id = $1',
        [organizationId]
    );
}

// ─── Products ────────────────────────────────────────────────────────

/**
 * Sync all products from Shopify into the local cache.
 */
async function syncProducts(organizationId) {
    const store = await getStoreConnection(organizationId);
    if (!store) throw new Error('No Shopify store connected');

    const logId = await createSyncLog(organizationId, 'products');

    try {
        const products = await shopifyFetchAll(
            store.shop_domain,
            store.access_token,
            '/products.json?limit=250&status=active',
            'products'
        );

        // Upsert products
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

        // Remove products no longer in Shopify
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

        await completeSyncLog(logId, 'success', products.length);
        return { synced: products.length };

    } catch (error) {
        await completeSyncLog(logId, 'error', 0, error.message);
        throw error;
    }
}

/**
 * Get cached products for an organization.
 */
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

/**
 * Get product count.
 */
async function getProductCount(organizationId) {
    const result = await pool.query(
        'SELECT COUNT(*) FROM shopify_products WHERE organization_id = $1',
        [organizationId]
    );
    return parseInt(result.rows[0].count);
}

// ─── Orders ──────────────────────────────────────────────────────────

/**
 * Sync recent orders from Shopify (last 90 days by default).
 */
async function syncOrders(organizationId, { days = 90 } = {}) {
    const store = await getStoreConnection(organizationId);
    if (!store) throw new Error('No Shopify store connected');

    const logId = await createSyncLog(organizationId, 'orders');

    try {
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - days);
        const sinceISO = sinceDate.toISOString();

        const orders = await shopifyFetchAll(
            store.shop_domain,
            store.access_token,
            `/orders.json?limit=250&status=any&created_at_min=${sinceISO}`,
            'orders'
        );

        for (const order of orders) {
            const tags = order.tags ? order.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
            const customerName = order.customer
                ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim()
                : '';

            await pool.query(
                `INSERT INTO shopify_orders
                    (id, organization_id, shopify_order_id, order_number, email, financial_status, fulfillment_status, total_price, subtotal_price, currency, customer_name, customer_email, line_items, shipping_address, note, tags, created_at_shopify, updated_at_shopify, synced_at)
                 VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
                 ON CONFLICT (organization_id, shopify_order_id) DO UPDATE SET
                    financial_status = EXCLUDED.financial_status,
                    fulfillment_status = EXCLUDED.fulfillment_status,
                    total_price = EXCLUDED.total_price,
                    customer_name = EXCLUDED.customer_name,
                    customer_email = EXCLUDED.customer_email,
                    line_items = EXCLUDED.line_items,
                    shipping_address = EXCLUDED.shipping_address,
                    note = EXCLUDED.note,
                    tags = EXCLUDED.tags,
                    updated_at_shopify = EXCLUDED.updated_at_shopify,
                    synced_at = NOW()`,
                [
                    organizationId,
                    order.id,
                    order.name || `#${order.order_number}`,
                    order.email,
                    order.financial_status,
                    order.fulfillment_status,
                    parseFloat(order.total_price) || 0,
                    parseFloat(order.subtotal_price) || 0,
                    order.currency || 'CAD',
                    customerName,
                    order.customer?.email || order.email,
                    JSON.stringify(order.line_items || []),
                    order.shipping_address ? JSON.stringify(order.shipping_address) : null,
                    order.note,
                    tags,
                    order.created_at,
                    order.updated_at
                ]
            );
        }

        await pool.query(
            'UPDATE shopify_stores SET last_orders_sync_at = NOW(), updated_at = NOW() WHERE organization_id = $1',
            [organizationId]
        );

        await completeSyncLog(logId, 'success', orders.length);
        return { synced: orders.length };

    } catch (error) {
        await completeSyncLog(logId, 'error', 0, error.message);
        throw error;
    }
}

/**
 * Get cached orders for an organization.
 */
async function getOrders(organizationId, { limit = 50, offset = 0, search = '', status = '' } = {}) {
    let query = 'SELECT * FROM shopify_orders WHERE organization_id = $1';
    const params = [organizationId];

    if (search) {
        params.push(`%${search}%`);
        query += ` AND (order_number ILIKE $${params.length} OR customer_name ILIKE $${params.length} OR customer_email ILIKE $${params.length})`;
    }

    if (status) {
        params.push(status);
        query += ` AND financial_status = $${params.length}`;
    }

    query += ' ORDER BY created_at_shopify DESC';
    params.push(limit);
    query += ` LIMIT $${params.length}`;
    params.push(offset);
    query += ` OFFSET $${params.length}`;

    const result = await pool.query(query, params);
    return result.rows;
}

/**
 * Look up a specific order by order number (e.g., "#1001") or email.
 */
async function lookupOrder(organizationId, { orderNumber, email }) {
    if (orderNumber) {
        // Normalize: ensure it starts with #
        const normalized = orderNumber.startsWith('#') ? orderNumber : `#${orderNumber}`;
        const result = await pool.query(
            'SELECT * FROM shopify_orders WHERE organization_id = $1 AND order_number = $2',
            [organizationId, normalized]
        );
        return result.rows;
    }

    if (email) {
        const result = await pool.query(
            'SELECT * FROM shopify_orders WHERE organization_id = $1 AND customer_email = $2 ORDER BY created_at_shopify DESC LIMIT 10',
            [organizationId, email.toLowerCase()]
        );
        return result.rows;
    }

    return [];
}

/**
 * Get order analytics summary.
 */
async function getOrderAnalytics(organizationId, { days = 30 } = {}) {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    const result = await pool.query(
        `SELECT
            COUNT(*) as total_orders,
            COALESCE(SUM(total_price), 0) as total_revenue,
            COALESCE(AVG(total_price), 0) as avg_order_value,
            COUNT(DISTINCT customer_email) as unique_customers,
            COUNT(CASE WHEN fulfillment_status = 'fulfilled' THEN 1 END) as fulfilled_orders,
            COUNT(CASE WHEN fulfillment_status IS NULL OR fulfillment_status = 'unfulfilled' THEN 1 END) as unfulfilled_orders,
            COUNT(CASE WHEN financial_status = 'refunded' THEN 1 END) as refunded_orders,
            COALESCE(SUM(CASE WHEN financial_status = 'refunded' THEN total_price ELSE 0 END), 0) as refund_total
         FROM shopify_orders
         WHERE organization_id = $1 AND created_at_shopify >= $2`,
        [organizationId, sinceDate]
    );

    // Daily revenue breakdown
    const dailyResult = await pool.query(
        `SELECT
            DATE(created_at_shopify) as date,
            COUNT(*) as orders,
            COALESCE(SUM(total_price), 0) as revenue
         FROM shopify_orders
         WHERE organization_id = $1 AND created_at_shopify >= $2
         GROUP BY DATE(created_at_shopify)
         ORDER BY date ASC`,
        [organizationId, sinceDate]
    );

    // Top products by revenue
    const topProductsResult = await pool.query(
        `SELECT
            item->>'title' as product_title,
            SUM((item->>'quantity')::int) as total_quantity,
            SUM((item->>'price')::decimal * (item->>'quantity')::int) as total_revenue
         FROM shopify_orders,
              jsonb_array_elements(line_items) as item
         WHERE organization_id = $1 AND created_at_shopify >= $2
         GROUP BY item->>'title'
         ORDER BY total_revenue DESC
         LIMIT 10`,
        [organizationId, sinceDate]
    );

    return {
        summary: result.rows[0],
        daily: dailyResult.rows,
        topProducts: topProductsResult.rows
    };
}

// ─── Customers ───────────────────────────────────────────────────────

/**
 * Sync customers from Shopify.
 */
async function syncCustomers(organizationId) {
    const store = await getStoreConnection(organizationId);
    if (!store) throw new Error('No Shopify store connected');

    const logId = await createSyncLog(organizationId, 'customers');

    try {
        const customers = await shopifyFetchAll(
            store.shop_domain,
            store.access_token,
            '/customers.json?limit=250',
            'customers'
        );

        for (const customer of customers) {
            const tags = customer.tags ? customer.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
            const defaultAddress = customer.default_address || {};

            await pool.query(
                `INSERT INTO shopify_customers
                    (id, organization_id, shopify_customer_id, email, first_name, last_name, phone, orders_count, total_spent, tags, city, province, country, zip, created_at_shopify, updated_at_shopify, synced_at)
                 VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
                 ON CONFLICT (organization_id, shopify_customer_id) DO UPDATE SET
                    email = EXCLUDED.email,
                    first_name = EXCLUDED.first_name,
                    last_name = EXCLUDED.last_name,
                    phone = EXCLUDED.phone,
                    orders_count = EXCLUDED.orders_count,
                    total_spent = EXCLUDED.total_spent,
                    tags = EXCLUDED.tags,
                    city = EXCLUDED.city,
                    province = EXCLUDED.province,
                    country = EXCLUDED.country,
                    zip = EXCLUDED.zip,
                    updated_at_shopify = EXCLUDED.updated_at_shopify,
                    synced_at = NOW()`,
                [
                    organizationId,
                    customer.id,
                    customer.email,
                    customer.first_name,
                    customer.last_name,
                    customer.phone,
                    customer.orders_count || 0,
                    parseFloat(customer.total_spent) || 0,
                    tags,
                    defaultAddress.city,
                    defaultAddress.province,
                    defaultAddress.country_code,
                    defaultAddress.zip
                ]
            );
        }

        await pool.query(
            'UPDATE shopify_stores SET last_customers_sync_at = NOW(), updated_at = NOW() WHERE organization_id = $1',
            [organizationId]
        );

        await completeSyncLog(logId, 'success', customers.length);
        return { synced: customers.length };

    } catch (error) {
        await completeSyncLog(logId, 'error', 0, error.message);
        throw error;
    }
}

/**
 * Get cached customers for an organization.
 */
async function getCustomers(organizationId, { limit = 50, offset = 0, search = '' } = {}) {
    let query = 'SELECT * FROM shopify_customers WHERE organization_id = $1';
    const params = [organizationId];

    if (search) {
        params.push(`%${search}%`);
        query += ` AND (email ILIKE $${params.length} OR first_name ILIKE $${params.length} OR last_name ILIKE $${params.length})`;
    }

    query += ' ORDER BY total_spent DESC';
    params.push(limit);
    query += ` LIMIT $${params.length}`;
    params.push(offset);
    query += ` OFFSET $${params.length}`;

    const result = await pool.query(query, params);
    return result.rows;
}

/**
 * Get customer count.
 */
async function getCustomerCount(organizationId) {
    const result = await pool.query(
        'SELECT COUNT(*) FROM shopify_customers WHERE organization_id = $1',
        [organizationId]
    );
    return parseInt(result.rows[0].count);
}

// ─── AI Context Builders ────────────────────────────────────────────

/**
 * Build a Shopify context string for AI tools.
 * Given a customer inquiry, detect order numbers or emails, look them up,
 * and return formatted context to inject into the system prompt.
 *
 * @param {string} organizationId
 * @param {string} inquiry - The customer's message/question
 * @returns {Promise<string|null>} Formatted context or null if no Shopify data
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

        // Also pull customer info
        const customerResult = await pool.query(
            'SELECT * FROM shopify_customers WHERE organization_id = $1 AND email = $2 LIMIT 1',
            [organizationId, email]
        );
        if (customerResult.rows.length > 0) {
            contextParts.push(formatCustomerContext(customerResult.rows[0]));
        }
    }

    // For general Shopify/store questions, inject analytics summary
    const shopifyKeywords = /\b(shopify|store|order[s]?|sale[s]?|revenue|product[s]?|customer[s]?|inventory|refund|fulfill|shipping|best.?sell)/i;
    if (contextParts.length === 0 && shopifyKeywords.test(inquiry)) {
        try {
            const analyticsSummary = await buildAnalyticsSummary(organizationId, { days: 30 });
            if (analyticsSummary) {
                contextParts.push(analyticsSummary);
            }
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
 */
async function buildAnalyticsSummary(organizationId, { days = 30 } = {}) {
    const store = await getStoreConnection(organizationId);
    if (!store) return null;

    const analytics = await getOrderAnalytics(organizationId, { days });
    const s = analytics.summary;

    const productCount = await getProductCount(organizationId);
    const customerCount = await getCustomerCount(organizationId);

    let summary = `\n\n--- SHOPIFY STORE SUMMARY (Last ${days} days) ---`;
    summary += `\nOrders: ${s.total_orders} | Revenue: $${parseFloat(s.total_revenue).toFixed(2)} | Avg Order: $${parseFloat(s.avg_order_value).toFixed(2)}`;
    summary += `\nUnique Customers: ${s.unique_customers} | Fulfilled: ${s.fulfilled_orders} | Unfulfilled: ${s.unfulfilled_orders} | Refunded: ${s.refunded_orders}`;
    summary += `\nTotal Products: ${productCount} | Total Customers: ${customerCount}`;

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
            `    - ${li.title} x${li.quantity} ($${li.price})`
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

// ─── Sync Log Helpers ────────────────────────────────────────────────

async function createSyncLog(organizationId, syncType) {
    const result = await pool.query(
        `INSERT INTO shopify_sync_logs (id, organization_id, sync_type, status, started_at)
         VALUES (gen_random_uuid(), $1, $2, 'running', NOW())
         RETURNING id`,
        [organizationId, syncType]
    );
    return result.rows[0].id;
}

async function completeSyncLog(logId, status, recordsSynced, errorMessage = null) {
    await pool.query(
        `UPDATE shopify_sync_logs
         SET status = $2, records_synced = $3, error_message = $4, completed_at = NOW()
         WHERE id = $1`,
        [logId, status, recordsSynced, errorMessage]
    );
}

module.exports = {
    // Store connection
    getStoreConnection,
    saveStoreConnection,
    disconnectStore,

    // Products
    syncProducts,
    getProducts,
    getProductCount,

    // Orders
    syncOrders,
    getOrders,
    lookupOrder,
    getOrderAnalytics,

    // Customers
    syncCustomers,
    getCustomers,
    getCustomerCount,

    // AI Context
    buildContextForInquiry,
    buildProductContext,
    buildAnalyticsSummary
};
