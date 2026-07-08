const fs = require('fs');
const path = require('path');

const distRoot = path.resolve(__dirname, '..', 'dist');
const indexPath = path.join(distRoot, 'index.html');

if (!fs.existsSync(indexPath)) {
  console.error('inject-modulepreload: dist/index.html not found. Run the Angular build first.');
  process.exit(1);
}

const chunkFiles = fs.readdirSync(distRoot)
  .filter(name => /^chunk-[\w-]+\.js$/.test(name))
  .sort((left, right) => fs.statSync(path.join(distRoot, right)).size - fs.statSync(path.join(distRoot, left)).size);

let indexHtml = fs.readFileSync(indexPath, 'utf8');
if (indexHtml.includes('rel="modulepreload"')) {
  console.log('inject-modulepreload: preload links already present.');
  process.exit(0);
}
if (chunkFiles.length === 0) {
  console.log('inject-modulepreload: no chunk files found, nothing to do.');
  process.exit(0);
}

const preloadLinks = chunkFiles.map(name => `<link rel="modulepreload" href="${name}">`).join('');
indexHtml = indexHtml.replace('</head>', `${preloadLinks}</head>`);
fs.writeFileSync(indexPath, indexHtml);
console.log(`inject-modulepreload: added ${chunkFiles.length} preload link(s): ${chunkFiles.join(', ')}`);
