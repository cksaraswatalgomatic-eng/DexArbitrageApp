import fs from 'fs';
import zlib from 'zlib';

const filesToCompress = [
  'public/index.html',
  'public/consolidated-tracking.html',
  'public/consolidated-tracking-updated.html',
  'public/contract-analysis.html',
  'public/pair-analysis.html',
  'public/reports.html',
  'public/token-analysis.html',
  'public/servers.html',
  'public/pair-deep.html',
  'public/notifications.html',
  'public/diff-analysis.html',
  'public/docs.html'
];

filesToCompress.forEach(file => {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file);
    const compressed = zlib.gzipSync(content);
    fs.writeFileSync(file + '.gz', compressed);
    console.log(`Compressed ${file} to ${file}.gz`);
  } else {
    console.warn(`File not found: ${file}`);
  }
});
