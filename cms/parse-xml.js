/**
 * ============================================================
 * Fariha's Collection — XML → JSON Parser (Step 1)
 * ============================================================
 * Reads:  ../catalog-feed.xml
 * Writes: ./products.json
 *
 * Run: node cms/parse-xml.js
 * Requires Node.js 14+ (uses built-in modules only, no npm install)
 * ============================================================
 */

const fs   = require('fs');
const path = require('path');

// ─── Paths ──────────────────────────────────────────────────
const XML_PATH  = path.join(__dirname, '..', 'catalog-feed.xml');
const JSON_PATH = path.join(__dirname, 'products.json');

// ─── Helpers ────────────────────────────────────────────────

/** Extract the text content between an XML tag, stripping CDATA wrappers. */
function extractTag(block, tag) {
    const re = new RegExp(`<g:${tag}[^>]*>([\\s\\S]*?)<\\/g:${tag}>`, 'i');
    const m  = block.match(re);
    if (!m) return '';
    return m[1]
        .replace(/<!\[CDATA\[/g, '')
        .replace(/\]\]>/g, '')
        .replace(/&amp;/g,  '&')
        .replace(/&gt;/g,   '>')
        .replace(/&lt;/g,   '<')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g,  "'")
        .trim();
}

/**
 * Map g:product_type  ("Shoes > heels")  to { category, subCategory }.
 * Rules match the filter pills used in shop.html.
 *
 * NOTE: Check "women" / "unisex" BEFORE checking "men" so that
 * "women" is never false-matched by a "men" substring search.
 */
function parseCategory(productType, gender) {
    if (!productType) {
        // Fall back to gender field
        if (gender === 'male') return { category: 'men', subCategory: '' };
        return { category: 'women', subCategory: '' };
    }

    const raw = productType.toLowerCase();

    // ── Sub-categories (check these first, order matters) ──
    const subTypes = ['heels', 'flats', 'slides', 'sneakers', 'pumps', 'loafers', 'sandals', 'boots'];
    for (const sub of subTypes) {
        if (raw.includes(sub)) {
            // Gender from the gender field
            const cat = (gender === 'male') ? 'men' : 'women';
            return { category: cat, subCategory: sub };
        }
    }

    // ── Top-level categories ──
    if (raw.includes('clearance')) return { category: 'women', subCategory: 'clearance' };
    if (raw.includes('tagged'))    return { category: 'women', subCategory: 'tagged' };
    if (raw.includes('unisex'))    return { category: 'unisex', subCategory: '' };

    // Check "women" before "men" (order critical!)
    if (raw.includes('women'))     return { category: 'women', subCategory: '' };
    if (raw.includes('men'))       return { category: 'men',   subCategory: '' };

    // Fall back to gender field
    if (gender === 'male')         return { category: 'men',   subCategory: '' };
    return { category: 'women', subCategory: '' };
}

// ─── Main ────────────────────────────────────────────────────

console.log('📂 Reading XML:', XML_PATH);

if (!fs.existsSync(XML_PATH)) {
    console.error('❌ catalog-feed.xml not found. Make sure you run this from the project root area.');
    process.exit(1);
}

const xml = fs.readFileSync(XML_PATH, 'utf-8');

// Split into individual <item> blocks
const itemRegex = /<item>([\s\S]*?)<\/item>/g;
const products  = [];
let match;

while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    const id          = extractTag(block, 'id');
    const name        = extractTag(block, 'title');
    const description = extractTag(block, 'description');
    const imageUrl    = extractTag(block, 'image_link');
    const priceRaw    = extractTag(block, 'price');     // e.g. "1200 PKR"
    const avail       = extractTag(block, 'availability'); // "in stock" | "out of stock"
    const brand       = extractTag(block, 'brand').trim();
    const productType = extractTag(block, 'product_type'); // "Shoes > heels"
    const size        = extractTag(block, 'size');          // "EU 40"
    const gender      = extractTag(block, 'gender');

    // Price: strip currency, parse number
    const price = parseInt(priceRaw.replace(/[^0-9]/g, ''), 10) || 0;

    // Sold out
    const soldOut = avail.toLowerCase().includes('out of stock');

    // Category / subCategory
    const { category, subCategory } = parseCategory(productType, gender);

    if (!id) {
        console.warn('⚠️  Skipping item without ID');
        continue;
    }

    products.push({
        id,
        name:        name  || 'Untitled Product',
        price,
        category,
        subCategory,
        brand:       brand || '',
        size,
        gender,
        description: description || name || '',
        images:      imageUrl ? [imageUrl] : [],
        soldOut,
        createdAt:   '2026-08-03T00:00:00.000Z',
    });
}

console.log(`✅  Parsed ${products.length} products`);

// Write output
fs.writeFileSync(JSON_PATH, JSON.stringify(products, null, 2), 'utf-8');
console.log(`💾  Written to: ${JSON_PATH}`);

// Summary
const categories = {};
products.forEach(p => {
    const key = p.subCategory || p.category;
    categories[key] = (categories[key] || 0) + 1;
});
console.log('\n📊 Category breakdown:');
Object.entries(categories)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`   ${k.padEnd(12)} ${v}`));

const soldOutCount = products.filter(p => p.soldOut).length;
console.log(`\n🔴 Sold out: ${soldOutCount}  ✅ In stock: ${products.length - soldOutCount}`);
console.log('\n🎉 Done! Next step: node cms/import-to-kv.js');
