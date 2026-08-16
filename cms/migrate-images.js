/**
 * migrate-images.js
 * 
 * Downloads all product images from Sanity (using API token to bypass CDN block)
 * and uploads them to Cloudinary, then updates the Worker KV with new URLs.
 * 
 * Usage: node cms/migrate-images.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const SANITY_PROJECT_ID  = 'kxnjofhp';
const SANITY_DATASET     = 'production';
const SANITY_TOKEN       = 'sk4gBst01MP4UhsqWFWXExFkFHQcjzohJIaK4xlKZf2sHhR8SK5WmPK7vz68G8IbQtj6mHbTpwVD0EFhFrWAAtbEgEb1CZIWdaoRhXiCH17MXq4PHpy78D8azMlZ5uxU8q1cA5c1eornNj0VDj1W91kDnulqdTmbKnxX47ezHeiObwIDBlbk';
const CLOUDINARY_CLOUD   = 'z0vndntn';
const CLOUDINARY_PRESET  = 'farihas_upload';
const WORKER_URL         = 'https://fc-cms.faisalshayan444.workers.dev';
const WORKER_TOKEN       = process.argv[2];

if (!WORKER_TOKEN) {
    console.error('❌  Please provide your Worker ADMIN_TOKEN as an argument.');
    console.error('    Example: node cms/migrate-images.js FC_Secret_2024!');
    process.exit(1);
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/** Convert a cdn.sanity.io URL to the source asset API URL (bypasses bandwidth quota) */
function toSourceUrl(cdnUrl) {
    // CDN:    https://cdn.sanity.io/images/PROJECT/DATASET/HASH-WxH.EXT
    // Source: https://PROJECT.api.sanity.io/v1/assets/images/DATASET/image-HASH-WxH-EXT
    const match = cdnUrl.match(/\/images\/([^/]+)\/([^/]+)\/(.+)$/);
    if (!match) return cdnUrl;
    const [, project, dataset, filename] = match;
    const assetId = 'image-' + filename.replace(/\.([a-z]+)$/, '-$1');
    return `https://${project}.api.sanity.io/v1/assets/images/${dataset}/${assetId}`;
}

/** Download a URL into a Buffer, following redirects, with auth header if needed */
function downloadBuffer(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        const req = lib.get(url, { headers }, (res) => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return resolve(downloadBuffer(res.headers.location, headers));
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
    });
}

/** Upload a Buffer to Cloudinary via unsigned upload preset */
function uploadToCloudinary(buffer, filename) {
    return new Promise((resolve, reject) => {
        const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
        const ext = filename.endsWith('.png') ? 'png' : 'jpg';
        const mime = ext === 'png' ? 'image/png' : 'image/jpeg';

        const header = [
            `--${boundary}`,
            `Content-Disposition: form-data; name="file"; filename="${filename}"`,
            `Content-Type: ${mime}`,
            '',
            ''
        ].join('\r\n');

        const presetPart = [
            `--${boundary}`,
            `Content-Disposition: form-data; name="upload_preset"`,
            '',
            CLOUDINARY_PRESET,
            `--${boundary}--`,
            ''
        ].join('\r\n');

        const body = Buffer.concat([
            Buffer.from(header),
            buffer,
            Buffer.from('\r\n' + presetPart)
        ]);

        const options = {
            hostname: 'api.cloudinary.com',
            path: `/v1_1/${CLOUDINARY_CLOUD}/image/upload`,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.secure_url) resolve(json.secure_url);
                    else reject(new Error('Cloudinary error: ' + data));
                } catch (e) {
                    reject(new Error('Cloudinary parse error: ' + data));
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

/** Fetch all products from Worker */
async function fetchWorkerProducts() {
    const res = await fetch(`${WORKER_URL}/api/products?limit=200`);
    const json = await res.json();
    return json.products || [];
}

/** Update a product in Worker with new image URL */
async function updateWorkerProduct(id, images) {
    const getRes = await fetch(`${WORKER_URL}/api/products/${id}`);
    const product = await getRes.json();
    product.images = images;

    const res = await fetch(`${WORKER_URL}/api/products/${id}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${WORKER_TOKEN}`
        },
        body: JSON.stringify(product)
    });
    return res.ok;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('🚀  Starting image migration: Sanity → Cloudinary → Worker\n');

    // Load local products.json to get image URLs
    const products = JSON.parse(fs.readFileSync(path.join(__dirname, 'products.json'), 'utf-8'));

    let migrated = 0;
    let skipped  = 0;
    let failed   = 0;
    const log    = [];

    for (let i = 0; i < products.length; i++) {
        const p = products[i];
        const sanityUrl = p.images && p.images[0];

        if (!sanityUrl || sanityUrl.includes('res.cloudinary.com')) {
            skipped++;
            continue;
        }

        process.stdout.write(`\r[${i + 1}/${products.length}] Processing: ${p.name.slice(0, 50).padEnd(50)}`);

        try {
            // 1. Download from Sanity SOURCE API using token (not CDN — bypasses bandwidth quota)
            const sourceUrl = toSourceUrl(sanityUrl);
            const buffer = await downloadBuffer(sourceUrl, {
                Authorization: `Bearer ${SANITY_TOKEN}`
            });

            // 2. Upload to Cloudinary
            const filename = `farihas_${p.id}.${sanityUrl.endsWith('.png') ? 'png' : 'jpg'}`;
            const cloudinaryUrl = await uploadToCloudinary(buffer, filename);

            // 3. Update Worker KV with new URL
            const newImages = [cloudinaryUrl, ...p.images.slice(1)];
            const ok = await updateWorkerProduct(p.id, newImages);

            if (ok) {
                // Also update local products.json for reference
                p.images[0] = cloudinaryUrl;
                migrated++;
                log.push({ id: p.id, name: p.name, url: cloudinaryUrl, status: 'ok' });
            } else {
                failed++;
                log.push({ id: p.id, name: p.name, status: 'worker_update_failed' });
            }
        } catch (err) {
            failed++;
            log.push({ id: p.id, name: p.name, status: 'error', error: err.message });
            process.stdout.write(`\n  ❌ ${p.name}: ${err.message}\n`);
        }
    }

    // Save updated products.json
    fs.writeFileSync(path.join(__dirname, 'products.json'), JSON.stringify(products, null, 2));

    // Save migration log
    const logPath = path.join(__dirname, 'migration-log.json');
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2));

    console.log('\n\n══════════════════════════════════════════');
    console.log(`✅  Migrated  : ${migrated}`);
    console.log(`⏭️  Skipped   : ${skipped} (already Cloudinary or no image)`);
    console.log(`❌  Failed    : ${failed}`);
    console.log(`📄  Log saved : cms/migration-log.json`);
    console.log('══════════════════════════════════════════');
    console.log('\n🎉  Done! Refresh your shop — all images should now load from Cloudinary.\n');
}

main().catch(err => {
    console.error('\n💥 Fatal error:', err);
    process.exit(1);
});
