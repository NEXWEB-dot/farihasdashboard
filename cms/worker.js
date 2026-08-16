/**
 * ============================================================
 * Fariha's Collection — Cloudflare Worker API
 * ============================================================
 * KV Namespace binding name: PRODUCTS
 *
 * Routes:
 *   GET    /api/products           → list all products
 *   GET    /api/products/:id       → single product
 *   POST   /api/products           → create product  [AUTH]
 *   PUT    /api/products/:id       → update product  [AUTH]
 *   DELETE /api/products/:id       → delete product  [AUTH]
 *   GET    /api/settings           → site settings
 *   PUT    /api/settings           → update settings [AUTH]
 *   POST   /api/orders             → place order     [PUBLIC - from checkout]
 *   GET    /api/orders             → list orders     [AUTH]
 *   PUT    /api/orders/:id         → update order    [AUTH]
 *   DELETE /api/orders/:id         → delete order    [AUTH]
 * ============================================================
 */

// ─── CORS Headers ────────────────────────────────────────────
const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age':       '86400',
};

function corsHeaders(extra = {}) {
    return { ...CORS, 'Content-Type': 'application/json', ...extra };
}

// ─── Response helpers ────────────────────────────────────────
function ok(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}
function err(message, status = 400) {
    return new Response(JSON.stringify({ error: message }), { status, headers: corsHeaders() });
}

// ─── Auth middleware ─────────────────────────────────────────
function isAuthorized(request, env) {
    const header = request.headers.get('Authorization') || '';
    const token  = header.replace('Bearer ', '').trim();
    return token === env.ADMIN_TOKEN;
}

// ─── KV Key helpers ──────────────────────────────────────────
const INDEX_KEY        = 'products:index';
const SETTINGS_KEY     = 'site:settings';
const ORDERS_INDEX_KEY = 'orders:index';

function productKey(id) { return `product:${id}`; }
function orderKey(id)   { return `order:${id}`; }

// ─── ID generator ────────────────────────────────────────────
function generateId() {
    return crypto.randomUUID();
}

// ─── Products index management ───────────────────────────────
async function getIndex(kv) {
    const raw = await kv.get(INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
}

async function addToIndex(kv, id) {
    const index = await getIndex(kv);
    if (!index.includes(id)) {
        index.unshift(id);
        await kv.put(INDEX_KEY, JSON.stringify(index));
    }
}

async function removeFromIndex(kv, id) {
    const index = await getIndex(kv);
    const updated = index.filter(i => i !== id);
    await kv.put(INDEX_KEY, JSON.stringify(updated));
}

// ─── Orders index management ─────────────────────────────────
async function getOrdersIndex(kv) {
    const raw = await kv.get(ORDERS_INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
}

async function addToOrdersIndex(kv, id) {
    const index = await getOrdersIndex(kv);
    if (!index.includes(id)) {
        index.unshift(id); // newest first
        await kv.put(ORDERS_INDEX_KEY, JSON.stringify(index));
    }
}

async function removeFromOrdersIndex(kv, id) {
    const index = await getOrdersIndex(kv);
    const updated = index.filter(i => i !== id);
    await kv.put(ORDERS_INDEX_KEY, JSON.stringify(updated));
}

// ─── Main fetch handler ──────────────────────────────────────
export default {
    async fetch(request, env) {
        const url    = new URL(request.url);
        const method = request.method.toUpperCase();
        const path   = url.pathname;

        // Handle CORS preflight
        if (method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS });
        }

        // ── Route: /api/products ──
        if (path === '/api/products') {
            if (method === 'GET')  return handleListProducts(url, env);
            if (method === 'POST') {
                if (!isAuthorized(request, env)) return err('Unauthorized', 401);
                return handleCreateProduct(request, env);
            }
        }

        // ── Route: /api/products/:id ──
        const productMatch = path.match(/^\/api\/products\/([^/]+)$/);
        if (productMatch) {
            const id = productMatch[1];
            if (method === 'GET')    return handleGetProduct(id, env);
            if (method === 'PUT') {
                if (!isAuthorized(request, env)) return err('Unauthorized', 401);
                return handleUpdateProduct(id, request, env);
            }
            if (method === 'DELETE') {
                if (!isAuthorized(request, env)) return err('Unauthorized', 401);
                return handleDeleteProduct(id, env);
            }
        }

        // ── Route: /api/settings ──
        if (path === '/api/settings') {
            if (method === 'GET') return handleGetSettings(env);
            if (method === 'PUT') {
                if (!isAuthorized(request, env)) return err('Unauthorized', 401);
                return handleUpdateSettings(request, env);
            }
        }

        // ── Route: /api/catalog.xml ──
        if (path === '/api/catalog.xml' && method === 'GET') {
            return handleGetCatalog(env);
        }

        // ── Route: /api/upload ──
        if (path === '/api/upload' && method === 'POST') {
            if (!isAuthorized(request, env)) return err('Unauthorized', 401);
            return handleUploadImage(request, env);
        }

        // ── Route: /api/orders ──
        if (path === '/api/orders') {
            if (method === 'POST') return handleCreateOrder(request, env);  // PUBLIC
            if (method === 'GET') {
                if (!isAuthorized(request, env)) return err('Unauthorized', 401);
                return handleListOrders(env);
            }
        }

        // ── Route: /api/orders/:id ──
        const orderMatch = path.match(/^\/api\/orders\/([^/]+)$/);
        if (orderMatch) {
            const id = orderMatch[1];
            if (method === 'PUT') {
                if (!isAuthorized(request, env)) return err('Unauthorized', 401);
                return handleUpdateOrder(id, request, env);
            }
            if (method === 'DELETE') {
                if (!isAuthorized(request, env)) return err('Unauthorized', 401);
                return handleDeleteOrder(id, env);
            }
        }

        return err('Not found', 404);
    }
};

// ─── GET /api/products ───────────────────────────────────────
async function handleListProducts(url, env) {
    try {
        const index = await getIndex(env.PRODUCTS);
        if (index.length === 0) return ok({ total: 0, products: [] });

        const fetched = await Promise.all(
            index.map(id => env.PRODUCTS.get(productKey(id)))
        );
        let products = fetched
            .filter(Boolean)
            .map(raw => JSON.parse(raw));

        const category = url.searchParams.get('category');
        const soldOut  = url.searchParams.get('soldOut');
        const search   = url.searchParams.get('search');
        const limit    = parseInt(url.searchParams.get('limit')  || '0');
        const offset   = parseInt(url.searchParams.get('offset') || '0');

        if (category && category !== 'all') {
            products = products.filter(p =>
                p.category    === category ||
                p.subCategory === category
            );
        }
        if (soldOut === 'true')  products = products.filter(p => p.soldOut === true);
        if (soldOut === 'false') products = products.filter(p => p.soldOut !== true);
        if (search) {
            const q = search.toLowerCase();
            products = products.filter(p =>
                (p.name  || '').toLowerCase().includes(q) ||
                (p.brand || '').toLowerCase().includes(q) ||
                (p.description || '').toLowerCase().includes(q)
            );
        }

        const total     = products.length;
        const paginated = (limit > 0)
            ? products.slice(offset, offset + limit)
            : products;

        return ok({ total, products: paginated });
    } catch (e) {
        return err('Failed to fetch products: ' + e.message, 500);
    }
}

// ─── GET /api/products/:id ───────────────────────────────────
async function handleGetProduct(id, env) {
    const raw = await env.PRODUCTS.get(productKey(id));
    if (!raw) return err('Product not found', 404);
    return ok(JSON.parse(raw));
}

// ─── POST /api/products ──────────────────────────────────────
async function handleCreateProduct(request, env) {
    let body;
    try { body = await request.json(); }
    catch { return err('Invalid JSON body'); }

    const id = body.id || generateId();
    const product = {
        id,
        name:        body.name        || '',
        price:       Number(body.price) || 0,
        category:    body.category    || 'women',
        subCategory: body.subCategory || '',
        brand:       body.brand       || '',
        size:        body.size        || '',
        condition:   body.condition   || '',
        description: body.description || '',
        images:      Array.isArray(body.images) ? body.images : [],
        soldOut:     body.soldOut === true,
        salePercent: Number(body.salePercent) || 0,
        createdAt:   body.createdAt   || new Date().toISOString(),
        updatedAt:   new Date().toISOString(),
    };

    if (!product.name) return err('Product name is required');

    await env.PRODUCTS.put(productKey(id), JSON.stringify(product));
    await addToIndex(env.PRODUCTS, id);

    return ok(product, 201);
}

// ─── PUT /api/products/:id ───────────────────────────────────
async function handleUpdateProduct(id, request, env) {
    const existing = await env.PRODUCTS.get(productKey(id));
    if (!existing) return err('Product not found', 404);

    let body;
    try { body = await request.json(); }
    catch { return err('Invalid JSON body'); }

    const old     = JSON.parse(existing);
    const updated = {
        ...old,
        ...body,
        id,
        updatedAt: new Date().toISOString(),
    };

    await env.PRODUCTS.put(productKey(id), JSON.stringify(updated));
    return ok(updated);
}

// ─── DELETE /api/products/:id ────────────────────────────────
async function handleDeleteProduct(id, env) {
    const existing = await env.PRODUCTS.get(productKey(id));
    if (!existing) return err('Product not found', 404);

    await env.PRODUCTS.delete(productKey(id));
    await removeFromIndex(env.PRODUCTS, id);

    return ok({ success: true, id });
}

// ─── GET /api/settings ───────────────────────────────────────
async function handleGetSettings(env) {
    const raw = await env.PRODUCTS.get(SETTINGS_KEY);
    const defaults = {
        announcementText:    '📦 Free delivery on orders above Rs 3,000 · Nationwide shipping across Pakistan',
        isAnnouncementActive: true,
        clearanceSaleActive:  true,
        marqueeActive:        true,
        marqueeMessages: [
            '📹 <strong>Notice:</strong> Please record a complete unboxing video before opening your parcel.',
            '🏷️ Premium <strong>Preloved Condition</strong> Shoes — Shipped Across Pakistan',
        ],
    };
    return ok(raw ? { ...defaults, ...JSON.parse(raw) } : defaults);
}

// ─── PUT /api/settings ───────────────────────────────────────
async function handleUpdateSettings(request, env) {
    let body;
    try { body = await request.json(); }
    catch { return err('Invalid JSON body'); }

    const raw = await env.PRODUCTS.get(SETTINGS_KEY);
    const existing = raw ? JSON.parse(raw) : {};
    const updated  = { ...existing, ...body, updatedAt: new Date().toISOString() };

    await env.PRODUCTS.put(SETTINGS_KEY, JSON.stringify(updated));
    return ok(updated);
}

// ─── GET /api/catalog.xml ────────────────────────────────────
// Generates a live Meta Commerce XML feed from the current KV state
async function handleGetCatalog(env) {
    try {
        const index = await getIndex(env.PRODUCTS);
        let products = [];
        if (index.length > 0) {
            const fetched = await Promise.all(index.map(id => env.PRODUCTS.get(productKey(id))));
            products = fetched.filter(Boolean).map(raw => JSON.parse(raw)).filter(p => p.soldOut !== true); // Only export in-stock products
        }

        const esc = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
        const SITE_URL = 'https://farihascollection.com';

        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">\n  <channel>\n    <title>Fariha's Collection</title>\n    <link>${SITE_URL}</link>\n    <description>Fariha's Collection Product Feed</description>\n`;

        for (const p of products) {
            const id = p.id || '';
            const name = p.name || 'Untitled';
            const desc = p.description || name;
            const price = Number(p.price) || 0;
            const brand = p.brand || "Fariha's Collection";
            const category = p.category === 'clearance' ? 'clearanceSale' : 'shoe';
            const image = (p.images && p.images[0]) ? p.images[0] : `${SITE_URL}/images/placeholder.jpg`;
            const params = new URLSearchParams({ id, name, price, image, tag: p.subCategory || p.category || '' });
            const link = `${SITE_URL}/product-detail.html?${params.toString()}`;

            xml += `    <item>\n`;
            xml += `      <g:id>${esc(id)}</g:id>\n`;
            xml += `      <g:title>${esc(name)}</g:title>\n`;
            xml += `      <g:description>${esc(desc)}</g:description>\n`;
            xml += `      <g:link>${esc(link)}</g:link>\n`;
            xml += `      <g:image_link>${esc(image)}</g:image_link>\n`;
            xml += `      <g:brand>${esc(brand)}</g:brand>\n`;
            xml += `      <g:condition>new</g:condition>\n`;
            xml += `      <g:availability>in stock</g:availability>\n`;
            xml += `      <g:price>${price}.00 PKR</g:price>\n`;
            
            // Additional images
            if (p.images && p.images.length > 1) {
                for (let i = 1; i < Math.min(p.images.length, 10); i++) {
                    xml += `      <g:additional_image_link>${esc(p.images[i])}</g:additional_image_link>\n`;
                }
            }
            xml += `    </item>\n`;
        }

        xml += `  </channel>\n</rss>`;
        
        return new Response(xml, { 
            status: 200, 
            headers: { 
                ...CORS,
                'Content-Type': 'application/xml',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            } 
        });
    } catch (e) {
        return new Response(`<?xml version="1.0" encoding="UTF-8"?><error>${e.message}</error>`, { status: 500, headers: { 'Content-Type': 'application/xml' }});
    }
}

// ─── POST /api/upload ────────────────────────────────────────
// Uploads an image to Cloudflare R2
async function handleUploadImage(request, env) {
    try {
        const formData = await request.formData();
        const file = formData.get('file');
        
        if (!file || !file.name) {
            return err('No file provided');
        }

        const ext = file.name.split('.').pop().toLowerCase();
        // Just a basic extension check, you could do more validation here
        if (!['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
            return err('Invalid file type');
        }

        // Generate a unique filename
        const filename = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${ext}`;
        
        // Put the file into R2
        await env.IMAGES.put(filename, file.stream(), {
            httpMetadata: { contentType: file.type }
        });

        // The public URL based on what the user provided
        const publicUrl = `https://pub-985d44863924446099d8bbd6f10d7d6e.r2.dev/${filename}`;

        return ok({ url: publicUrl });
    } catch (e) {
        return err('Upload failed: ' + e.message, 500);
    }
}

// ─── POST /api/orders ────────────────────────────────────────
// PUBLIC: called by checkout page when customer places an order
async function handleCreateOrder(request, env) {
    let body;
    try { body = await request.json(); }
    catch { return err('Invalid JSON body'); }

    if (!body.customerName) return err('Customer name is required');
    if (!body.customerPhone) return err('Customer phone is required');

    const now       = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // +24 hours

    const id = 'ORD-' + Date.now() + '-' + Math.floor(Math.random() * 9000 + 1000);

    const order = {
        id,
        status:         'pending',
        customerName:   body.customerName   || '',
        customerPhone:  body.customerPhone  || '',
        customerEmail:  body.customerEmail  || '',
        address:        body.address        || '',
        city:           body.city           || '',
        province:       body.province       || '',
        paymentMethod:  body.paymentMethod  || 'cod',
        totalAmount:    Number(body.totalAmount) || 0,
        promoCode:      body.promoCode      || '',
        items:          Array.isArray(body.items) ? body.items : [],
        notes:          body.notes          || '',
        createdAt:      now.toISOString(),
        expiresAt:      expiresAt.toISOString(),
        confirmedAt:    null,
        cancelledAt:    null,
    };

    await env.PRODUCTS.put(orderKey(id), JSON.stringify(order));
    await addToOrdersIndex(env.PRODUCTS, id);

    return ok(order, 201);
}

// ─── GET /api/orders ─────────────────────────────────────────
// AUTH: dashboard only
async function handleListOrders(env) {
    try {
        const index = await getOrdersIndex(env.PRODUCTS);
        if (index.length === 0) return ok({ total: 0, orders: [] });

        const fetched = await Promise.all(
            index.map(id => env.PRODUCTS.get(orderKey(id)))
        );
        const orders = fetched
            .filter(Boolean)
            .map(raw => JSON.parse(raw));

        return ok({ total: orders.length, orders });
    } catch (e) {
        return err('Failed to fetch orders: ' + e.message, 500);
    }
}

// ─── PUT /api/orders/:id ─────────────────────────────────────
// AUTH: confirm / cancel / update status
async function handleUpdateOrder(id, request, env) {
    const existing = await env.PRODUCTS.get(orderKey(id));
    if (!existing) return err('Order not found', 404);

    let body;
    try { body = await request.json(); }
    catch { return err('Invalid JSON body'); }

    const old     = JSON.parse(existing);
    const now     = new Date().toISOString();
    const updated = {
        ...old,
        ...body,
        id,
        updatedAt: now,
    };

    // Stamp timestamps for status changes
    if (body.status === 'confirmed' && !old.confirmedAt) updated.confirmedAt = now;
    if (body.status === 'cancelled' && !old.cancelledAt) updated.cancelledAt = now;

    await env.PRODUCTS.put(orderKey(id), JSON.stringify(updated));
    return ok(updated);
}

// ─── DELETE /api/orders/:id ──────────────────────────────────
async function handleDeleteOrder(id, env) {
    const existing = await env.PRODUCTS.get(orderKey(id));
    if (!existing) return err('Order not found', 404);

    await env.PRODUCTS.delete(orderKey(id));
    await removeFromOrdersIndex(env.PRODUCTS, id);

    return ok({ success: true, id });
}
