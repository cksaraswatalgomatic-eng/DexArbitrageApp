const fs = require('fs');
const zlib = require('zlib');

const filesToCompress = [
  'public/consolidated-tracking.html',
  'public/consolidated-tracking-updated.html'
];

filesToCompress.forEach(file => {
  const content = fs.readFileSync(file);
  const compressed = zlib.gzipSync(content);
  fs.writeFileSync(file + '.gz', compressed);
  console.log(`Compressed ${file} to ${file}.gz`);
});
