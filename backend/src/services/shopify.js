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
 * Get live order analytics by querying Shopify API directly.
 * Uses count endpoints + a limited page fetch for daily breakdown and top products.
 * Results are cached for 2 minutes to speed up refreshes.
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
    const sinceISO = sinceDate.toISOString();

    // Previous period for comparison
    const prevEnd = new Date(sinceDate);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - days);
    const prevStartISO = prevStart.toISOString();
    const prevEndISO = prevEnd.toISOString();

    // Fetch current + previous counts, total customers, new customers, and order samples
    const [orderCountData, prevOrderCountData, totalCustomerData, newCustomerData, orders, prevOrders] = await Promise.all([
        shopifyFetch(store.shop_domain, store.access_token,
            `/orders/count.json?status=any&created_at_min=${sinceISO}`),
        shopifyFetch(store.shop_domain, store.access_token,
            `/orders/count.json?status=any&created_at_min=${prevStartISO}&created_at_max=${prevEndISO}`),
        shopifyFetch(store.shop_domain, store.access_token,
            `/customers/count.json`),
        shopifyFetch(store.shop_domain, store.access_token,
            `/customers/count.json?created_at_min=${sinceISO}`),
        fetchRecentOrders(store, sinceISO, null, 5),
        fetchRecentOrders(store, prevStartISO, prevEndISO, 2) // smaller sample for prev period
    ]);

    const totalOrderCount = orderCountData.count || 0;
    const prevOrderCount = prevOrderCountData.count || 0;
    const totalCustomerCount = totalCustomerData.count || 0;
    const newCustomerCount = newCustomerData.count || 0;

    // Process current and previous period samples
    const cur = processOrderSample(orders, totalOrderCount);
    const prev = processOrderSample(prevOrders, prevOrderCount);

    // Unique buyers in the period
    const uniqueBuyers = cur.scaleFactor > 1
        ? Math.round(cur.uniqueEmails.size * cur.scaleFactor)
        : cur.uniqueEmails.size;

    // Transactions per customer (unique buyers / total transactions in period)
    const transactionsPerCustomer = totalOrderCount > 0
        ? Math.round((uniqueBuyers / totalOrderCount) * 100) / 100 : 0;

    // City breakdown (scaled)
    const cityBreakdown = Object.entries(cur.cityMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([city, count]) => ({
            city: city || 'Unknown',
            customers: cur.scaleFactor > 1 ? Math.round(count * cur.scaleFactor) : count
        }));

    // Package/price breakdown (exclude $0 items)
    const packageBreakdown = Object.entries(cur.packageMap)
        .filter(([pkg]) => !pkg.startsWith('$0.00'))
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 15)
        .map(([pkg, data]) => ({
            package: pkg,
            count: cur.scaleFactor > 1 ? Math.round(data.count * cur.scaleFactor) : data.count,
            revenue: Math.round((data.revenue * (cur.scaleFactor > 1 ? cur.scaleFactor : 1)) * 100) / 100
        }));

    // Top 10 whales (by dollar amount in sample — not scaled, these are real customers)
    const whales = Object.values(cur.customerSpendMap)
        .sort((a, b) => b.total_spent - a.total_spent)
        .slice(0, 10)
        .map(w => ({
            name: w.name,
            email: w.email,
            total_spent: Math.round(w.total_spent * 100) / 100,
            order_count: w.order_count
        }));

    // New vs returning buyers
    const sampleBuyers = cur.newBuyerCount + cur.returningBuyerCount;
    const newBuyersEst = sampleBuyers > 0
        ? Math.round((cur.newBuyerCount / sampleBuyers) * uniqueBuyers)
        : newCustomerCount;
    const returningBuyersEst = Math.max(0, uniqueBuyers - newBuyersEst);

    // Top products sorted by unit price descending ($100, $75, $50, $20, $10, etc.)
    const topProducts = Object.values(cur.productMap)
        .map(p => ({ ...p, unit_price: p.total_quantity > 0 ? p.total_revenue / p.total_quantity : 0 }))
        .sort((a, b) => b.unit_price - a.unit_price)
        .slice(0, 10);
    if (cur.scaleFactor > 1) {
        for (const p of topProducts) {
            p.total_quantity = Math.round(p.total_quantity * cur.scaleFactor);
            p.total_revenue = Math.round(p.total_revenue * cur.scaleFactor * 100) / 100;
        }
    }

    // Daily revenue (NOT scaled — scale factor distorts daily granularity for high-volume stores)
    const daily = Object.values(cur.dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    // Revenue estimates
    const estRevenue = cur.scaleFactor > 1
        ? Math.round(cur.totalRevenue * cur.scaleFactor * 100) / 100 : cur.totalRevenue;
    const avgOrderValue = totalOrderCount > 0 ? estRevenue / totalOrderCount : 0;

    // Previous period revenue estimate
    const prevEstRevenue = prev.scaleFactor > 1
        ? Math.round(prev.totalRevenue * prev.scaleFactor * 100) / 100 : prev.totalRevenue;

    const result = {
        summary: {
            total_orders: totalOrderCount,
            total_revenue: estRevenue.toFixed(2),
            avg_order_value: avgOrderValue.toFixed(2),
            unique_customers: uniqueBuyers,
            total_customers: totalCustomerCount,
            new_customers: newCustomerCount,
            transactions_per_customer: transactionsPerCustomer,
            new_buyers: newBuyersEst,
            returning_buyers: returningBuyersEst,
            repeat_rate: (newBuyersEst + returningBuyersEst) > 0
                ? Math.round((returningBuyersEst / (newBuyersEst + returningBuyersEst)) * 100) : 0,
            sampled: cur.fetchedCount < totalOrderCount,
            sample_size: cur.fetchedCount
        },
        previousPeriod: {
            total_orders: prevOrderCount,
            total_revenue: prevEstRevenue.toFixed(2),
            avg_order_value: (prevOrderCount > 0 ? prevEstRevenue / prevOrderCount : 0).toFixed(2)
        },
        daily,
        topProducts,
        cityBreakdown,
        packageBreakdown,
        whales
    };

    _analyticsCache[cacheKey] = { data: result, ts: Date.now() };
    return result;
}

/**
 * Process an order sample and return computed statistics.
 */
function processOrderSample(orders, totalOrderCount) {
    let totalRevenue = 0;
    let fulfilledOrders = 0;
    let unfulfilledOrders = 0;
    let refundedOrders = 0;
    let refundTotal = 0;
    let newBuyerCount = 0;
    let returningBuyerCount = 0;
    const uniqueEmails = new Set();
    const dailyMap = {};
    const productMap = {};
    const cityMap = {};
    const packageMap = {};
    const customerSpendMap = {};

    for (const order of orders) {
        const price = parseFloat(order.total_price) || 0;
        totalRevenue += price;

        if (order.financial_status === 'refunded') { refundedOrders++; refundTotal += price; }
        if (order.fulfillment_status === 'fulfilled') { fulfilledOrders++; } else { unfulfilledOrders++; }

        const email = order.email?.toLowerCase();
        if (email) {
            uniqueEmails.add(email);

            // Whale tracking
            if (!customerSpendMap[email]) {
                customerSpendMap[email] = {
                    email,
                    name: order.customer
                        ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim()
                        : email,
                    total_spent: 0,
                    order_count: 0
                };
            }
            customerSpendMap[email].total_spent += price;
            customerSpendMap[email].order_count++;

            // New vs returning (Shopify provides customer.orders_count)
            if (order.customer?.orders_count !== undefined && !customerSpendMap[email]._counted) {
                customerSpendMap[email]._counted = true;
                if (order.customer.orders_count <= 1) { newBuyerCount++; } else { returningBuyerCount++; }
            }
        }

        // City
        const city = order.billing_address?.city || order.shipping_address?.city;
        if (city) { cityMap[city.trim()] = (cityMap[city.trim()] || 0) + 1; }

        // Daily
        const day = order.created_at?.substring(0, 10);
        if (day) {
            if (!dailyMap[day]) dailyMap[day] = { date: day, orders: 0, revenue: 0 };
            dailyMap[day].orders++;
            dailyMap[day].revenue += price;
        }

        // Products + packages
        for (const item of (order.line_items || [])) {
            const title = item.title || 'Unknown';
            const itemPrice = parseFloat(item.price) || 0;
            const qty = item.quantity || 0;

            if (!productMap[title]) productMap[title] = { product_title: title, total_quantity: 0, total_revenue: 0 };
            productMap[title].total_quantity += qty;
            productMap[title].total_revenue += itemPrice * qty;

            const priceLabel = `$${itemPrice.toFixed(2)} - ${title}`;
            if (!packageMap[priceLabel]) packageMap[priceLabel] = { count: 0, revenue: 0 };
            packageMap[priceLabel].count += qty;
            packageMap[priceLabel].revenue += itemPrice * qty;
        }
    }

    const fetchedCount = orders.length;
    const scaleFactor = totalOrderCount > 0 && fetchedCount > 0 && fetchedCount < totalOrderCount
        ? totalOrderCount / fetchedCount : 1;

    return {
        totalRevenue, fulfilledOrders, unfulfilledOrders, refundedOrders, refundTotal,
        newBuyerCount, returningBuyerCount, uniqueEmails, dailyMap, productMap,
        cityMap, packageMap, customerSpendMap, fetchedCount, scaleFactor
    };
}

/**
 * Fetch recent orders directly from Shopify with a page cap.
 * Optional untilISO limits the upper end of the date range.
 */
async function fetchRecentOrders(store, sinceISO, untilISO, maxPages = 10) {
    const orders = [];
    let url = `https://${store.shop_domain}/admin/api/${SHOPIFY_API_VERSION}/orders.json?limit=250&status=any&created_at_min=${sinceISO}`;
    if (untilISO) url += `&created_at_max=${untilISO}`;
    let page = 0;

    while (url && page < maxPages) {
        page++;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        try {
            const response = await fetch(url, {
                headers: {
                    'X-Shopify-Access-Token': store.access_token,
                    'Content-Type': 'application/json'
                },
                signal: controller.signal
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
        } catch (err) {
            clearTimeout(timeout);
            break; // Return what we have so far
        }
    }

    return orders;
}

// ─── Live Order Lookup (direct Shopify API) ──────────────────────────

/**
 * Look up orders by order number or email directly from Shopify.
 */
async function lookupOrder(organizationId, { orderNumber, email }) {
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
 * Queries Shopify API directly.
 */
async function buildAnalyticsSummary(organizationId, { days = 30 } = {}) {
    const store = await getStoreConnection(organizationId);
    if (!store) return null;

    const analytics = await getLiveAnalytics(organizationId, { days });
    const s = analytics.summary;
    const productCount = await getProductCount(organizationId);

    let summary = `\n\n--- SHOPIFY STORE SUMMARY (Last ${days} days) ---`;
    summary += `\nOrders: ${s.total_orders} | Revenue: $${parseFloat(s.total_revenue).toFixed(2)} | Avg Order: $${parseFloat(s.avg_order_value).toFixed(2)}`;
    summary += `\nUnique Customers: ${s.unique_customers} | Fulfilled: ${s.fulfilled_orders} | Unfulfilled: ${s.unfulfilled_orders} | Refunded: ${s.refunded_orders}`;
    summary += `\nTotal Products: ${productCount}`;

    if (analytics.topProducts.length > 0) {
        summary += '\n\nTop Products by Revenue:';
        analytics.topProducts.forEach((p, i) => {
            summary += `\n  ${i + 1}. ${p.product_title}: ${p.total_quantity} sold, $${parseFloat(p.total_revenue).toFixed(2)}`;
        });
    }

    if (s.sampled) {
        summary += `\n\n(Note: Revenue/product estimates based on a sample of ${s.sample_size} of ${s.total_orders} orders)`;
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
    'products/delete'
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
 * Main webhook dispatcher — only handles product events now.
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
