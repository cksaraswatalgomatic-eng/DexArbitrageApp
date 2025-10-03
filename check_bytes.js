// Check the first few bytes of the file for special characters
const fs = require('fs');

// Read first 1000 bytes as buffer
const buffer = fs.readFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', { encoding: null });

console.log('First 100 bytes as hex:');
for (let i = 0; i < Math.min(100, buffer.length); i++) {
  process.stdout.write(buffer[i].toString(16).padStart(2, '0') + ' ');
  if ((i + 1) % 16 === 0) console.log();
}
console.log('\\n');

console.log('\\nFirst 100 bytes as characters:');
for (let i = 0; i < Math.min(100, buffer.length); i++) {
  const char = String.fromCharCode(buffer[i]);
  if (char === '\\r' || char === '\\n') {
    process.stdout.write(char === '\\r' ? '\\\\r' : '\\\\n');
  } else if (buffer[i] < 32 || buffer[i] > 126) {
    process.stdout.write('.');
  } else {
    process.stdout.write(char);
  }
}
console.log('\\n');

// Check if there's a null byte early in the file
const nullByteIndex = buffer.indexOf(0);
if (nullByteIndex !== -1 && nullByteIndex < 1000) {
  console.log(`\\nWARNING: Null byte found at position ${nullByteIndex} which may terminate string reading early!`);
}