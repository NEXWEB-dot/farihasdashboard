/**
 * upload-placeholder.js
 * Uploads the placeholder image to Cloudinary and prints the URL
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const CLOUDINARY_CLOUD  = 'z0vndntn';
const CLOUDINARY_PRESET = 'farihas_upload';

const imgPath = path.join(__dirname, '..', 'images', 'placeholder.jpg');
const buffer  = fs.readFileSync(imgPath);

const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);

const header = [
    '--' + boundary,
    'Content-Disposition: form-data; name="file"; filename="placeholder.jpg"',
    'Content-Type: image/jpeg',
    '',
    ''
].join('\r\n');

const presetPart = [
    '--' + boundary,
    'Content-Disposition: form-data; name="upload_preset"',
    '',
    CLOUDINARY_PRESET,
    '--' + boundary + '--',
    ''
].join('\r\n');

const body = Buffer.concat([Buffer.from(header), buffer, Buffer.from('\r\n' + presetPart)]);

const options = {
    hostname: 'api.cloudinary.com',
    path: '/v1_1/' + CLOUDINARY_CLOUD + '/image/upload',
    method: 'POST',
    headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length
    }
};

console.log('Uploading placeholder to Cloudinary...');
const req = https.request(options, function(res) {
    let data = '';
    res.on('data', function(c) { data += c; });
    res.on('end', function() {
        const json = JSON.parse(data);
        if (json.secure_url) {
            console.log('\n✅ Placeholder uploaded!');
            console.log('URL:', json.secure_url);
        } else {
            console.error('❌ Failed:', data);
        }
    });
});
req.on('error', function(e) { console.error(e); });
req.write(body);
req.end();
