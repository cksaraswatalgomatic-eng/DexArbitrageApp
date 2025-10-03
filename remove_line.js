// Direct manual fix to remove the duplicate }); at the exact position
const fs = require('fs');

let content = fs.readFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', 'utf8');
let lines = content.split('\\n');

// Remove the duplicate }); at exact index 302
console.log('Before removal - Line 303 (index 302):', JSON.stringify(lines[302]));
lines.splice(302, 1);
console.log('After removal - Line 303 (now index 302):', JSON.stringify(lines[302]));

// Join lines back together
content = lines.join('\\n');

fs.writeFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', content);

console.log('Directly removed the duplicate closing bracket at index 302.');