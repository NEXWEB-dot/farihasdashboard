/**
 * ============================================================
 * Fariha's Collection — Bulk KV Import Script (Step 3)
 * ============================================================
 * Reads:   ./products.json
 * Imports: All 154 products into Cloudflare KV via REST API
 *
 * SETUP — Set these 3 environment variables before running:
 *   $env:CF_ACCOUNT_ID    = "your-cloudflare-account-id"
 *   $env:CF_API_TOKEN     = "your-api-token"
 *   $env:CF_KV_NS_ID      = "your-kv-namespace-id"
 *
 * Run: node cms/import-to-kv.js
 *
 * Where to find these values:
 *   CF_ACCOUNT_ID  → Cloudflare Dashboard → right sidebar
 *   CF_API_TOKEN   → My Profile → API Tokens → Create Token
 *                    (use "Edit Cloudflare Workers" template)
 *   CF_KV_NS_ID    → Workers & Pages → KV → your namespace → ID
 * ============================================================
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');

// ─── Config ──────────────────────────────────────────────────
const ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const API_TOKEN  = process.env.CF_API_TOKEN;
const KV_NS_ID   = process.env.CF_KV_NS_ID;
const JSON_PATH  = path.join(__dirname, 'products.json');

// Cloudflare KV REST API: bulk write endpoint allows up to 10,000 pairs per request
const KV_BASE    = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_NS_ID}`;
const INDEX_KEY  = 'products:index';

// ─── Validation ──────────────────────────────────────────────
if (!ACCOUNT_ID || !API_TOKEN || !KV_NS_ID) {
    console.error(`
❌  Missing environment variables. Please set:

    PowerShell:
        $env:CF_ACCOUNT_ID = "your-account-id"
        $env:CF_API_TOKEN  = "your-api-token"
        $env:CF_KV_NS_ID   = "your-kv-namespace-id"

    Then run:  node cms/import-to-kv.js
`);
    process.exit(1);
}

if (!fs.existsSync(JSON_PATH)) {
    console.error('❌  products.json not found. Run: node cms/parse-xml.js first.');
    process.exit(1);
}

// ─── HTTP helper ─────────────────────────────────────────────
function apiRequest(method, endpoint, body) {
    return new Promise((resolve, reject) => {
        const url     = new URL(KV_BASE + endpoint);
        const payload = body ? JSON.stringify(body) : null;

        const options = {
            hostname: url.hostname,
            path:     url.pathname + url.search,
            method,
            headers: {
                'Authorization': `Bearer ${API_TOKEN}`,
                'Content-Type':  'application/json',
            },
        };
        if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);

        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: data }); }
            });
        });

        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

// ─── KV bulk write helper (Cloudflare limit: 10,000 pairs) ──
async function kvBulkWrite(pairs) {
    // pairs: [{ key: string, value: string, expiration_ttl?: number }]
    const CHUNK = 500; // stay well within limits
    for (let i = 0; i < pairs.length; i += CHUNK) {
        const chunk = pairs.slice(i, i + CHUNK);
        const res = await apiRequest('PUT', '/bulk', chunk);
        if (!res.body.success) {
            throw new Error(`KV bulk write failed: ${JSON.stringify(res.body.errors)}`);
        }
    }
}

// ─── Main ────────────────────────────────────────────────────
(async () => {
    console.log('📂 Reading products.json …');
    const products = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
    console.log(`   Found ${products.length} products\n`);

    // Build KV pairs: one entry per product + one index entry
    const kvPairs = products.map(p => ({
        key:   `product:${p.id}`,
        value: JSON.stringify(p),
    }));

    // Index = array of all IDs (newest first = keep original order)
    const indexIds = products.map(p => p.id);
    kvPairs.push({
        key:   INDEX_KEY,
        value: JSON.stringify(indexIds),
    });

    console.log(`📤 Uploading ${kvPairs.length} KV entries …`);
    const t0 = Date.now();

    try {
        await kvBulkWrite(kvPairs);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        console.log(`\n✅  Import complete in ${elapsed}s!`);
        console.log(`   Products in KV : ${products.length}`);
        console.log(`   Index updated  : ${INDEX_KEY}`);
        console.log('\n🎉 Your Worker can now serve all products.');
        console.log('   Next step: open dashboard.html in a browser.\n');
    } catch (e) {
        console.error('\n❌  Import failed:', e.message);
        process.exit(1);
    }
})();
