const fs = require('fs');
const path = require('path');

const WORKER_URL = 'https://fc-cms.faisalshayan444.workers.dev';
const TOKEN = process.argv[2];

if (!TOKEN) {
    console.error('❌ Please provide your ADMIN_TOKEN.');
    console.error('Example: node cms/upload.js mySecretToken123');
    process.exit(1);
}

const products = JSON.parse(fs.readFileSync(path.join(__dirname, 'products.json'), 'utf-8'));

async function upload() {
    console.log(`🚀 Starting upload of ${products.length} products to ${WORKER_URL} ...\n`);
    let count = 0;
    
    for (const p of products) {
        try {
            const res = await fetch(WORKER_URL + '/api/products', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${TOKEN}`
                },
                body: JSON.stringify(p)
            });
            
            if (!res.ok) {
                const text = await res.text();
                console.error(`\n❌ Failed to upload ${p.name}: ${res.statusText} - ${text}`);
            } else {
                count++;
                process.stdout.write(`\r✅ Uploaded: ${count} / ${products.length}`);
            }
        } catch (e) {
            console.error(`\n❌ Error on ${p.name}:`, e.message);
        }
    }
    
    console.log('\n\n🎉 All done! Your new CMS is live and has all the products.');
    console.log('You can now open dashboard.html in your browser.');
}

upload();
