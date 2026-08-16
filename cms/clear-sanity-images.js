/**
 * clear-sanity-images.js
 * Fetches ALL products from the Worker API and removes any cdn.sanity.io
 * image URLs, replacing them with an empty array so the frontend shows placeholder.
 *
 * Usage:
 *   node clear-sanity-images.js <ADMIN_TOKEN>
 */

const WORKER_URL = 'https://fc-cms.faisalshayan444.workers.dev';
const ADMIN_TOKEN = process.argv[2];

if (!ADMIN_TOKEN) {
    console.error('❌  Usage: node clear-sanity-images.js <ADMIN_TOKEN>');
    process.exit(1);
}

async function run() {
    // 1. Fetch all products
    console.log('📦 Fetching all products...');
    const res = await fetch(`${WORKER_URL}/api/products?limit=9999`);
    const json = await res.json();
    const products = json.products || [];
    console.log(`✅ Got ${products.length} products`);

    let fixed = 0;
    let skipped = 0;

    for (const p of products) {
        const hasSanityImage = p.images && p.images.some(u => u && u.includes('cdn.sanity.io'));
        if (!hasSanityImage) { skipped++; continue; }

        // Strip out all sanity URLs
        const cleanImages = (p.images || []).filter(u => u && !u.includes('cdn.sanity.io'));

        const updated = { ...p, images: cleanImages };

        const putRes = await fetch(`${WORKER_URL}/api/products/${p.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${ADMIN_TOKEN}`
            },
            body: JSON.stringify(updated)
        });

        if (putRes.ok) {
            fixed++;
            console.log(`  ✅ Cleared images for: ${p.name}`);
        } else {
            const errText = await putRes.text();
            console.error(`  ❌ Failed for ${p.name}: ${putRes.status} ${errText}`);
        }

        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 100));
    }

    console.log(`\n🎉 Done! Fixed: ${fixed}, Already clean: ${skipped}`);
}

run().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
