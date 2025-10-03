// Simple approach to read the file and check its structure
const fs = require('fs');

let content = fs.readFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', 'utf8');

// Show first 500 characters to understand the file
console.log('First 500 characters:');
console.log(content.substring(0, 500));

// Show last 500 characters to understand the file
console.log('\\n\\nLast 500 characters:');
console.log(content.substring(content.length - 500));

// Count lines
let lines = content.split('\\n');
console.log('\\n\\nTotal lines:', lines.length);

// Show lines around the error area
console.log('\\n\\nLines 300-310:');
for (let i = 300; i <= 310 && i < lines.length; i++) {
  console.log(`${i}: ${JSON.stringify(lines[i])}`);
}