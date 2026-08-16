const https = require('https');
const SANITY_TOKEN = 'sk4gBst01MP4UhsqWFWXExFkFHQcjzohJIaK4xlKZf2sHhR8SK5WmPK7vz68G8IbQtj6mHbTpwVD0EFhFrWAAtbEgEb1CZIWdaoRhXiCH17MXq4PHpy78D8azMlZ5uxU8q1cA5c1eornNj0VDj1W91kDnulqdTmbKnxX47ezHeiObwIDBlbk';
const cdnUrl = 'https://cdn.sanity.io/images/kxnjofhp/production/39f94a187ea65123e78695c1be308aded0192bab-896x1195.png';
const match = cdnUrl.match(/\/images\/([^/]+)\/([^/]+)\/(.+)$/);
const [, project, dataset, filename] = match;
const assetId = 'image-' + filename.replace(/\.([a-z]+)$/, function(m, ext) { return '-' + ext; });
const sourceUrl = 'https://' + project + '.api.sanity.io/v1/assets/images/' + dataset + '/' + assetId;
console.log('Trying:', sourceUrl);
const req = https.get(sourceUrl, { headers: { Authorization: 'Bearer ' + SANITY_TOKEN } }, function(res) {
  console.log('Status:', res.statusCode);
  let d = '';
  res.on('data', function(c) { d += c; });
  res.on('end', function() { if (res.statusCode !== 200) console.log(d.slice(0,300)); else console.log('Image size:', res.headers['content-length'], 'bytes. SUCCESS!'); });
});
req.on('error', function(e) { console.error(e); });
