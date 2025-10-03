// Read the app.js file and revert to the exact original regex patterns
const fs = require('fs');

// Read the current file
let content = fs.readFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', 'utf8');

// The issue was with my previous incorrect replacements. Let me revert those.
// The correct patterns in the original file:
// 1. explorerApiBase.replace(/\\/?$/, '') - This was correct originally
// 2. (server.explorerSite || '').replace(/\\/?$/, '') - This should also be correct
// 3. (BALANCES_URL || '').replace(/\\/(balance|balances).*/, '') - This was correct originally

// Actually revert the incorrect changes I made
content = content.split("(server.explorerSite || '').replace(/\\/?$, '')").join("(server.explorerSite || '').replace(/\\/?$/, '')");

// Write back the fixed content
fs.writeFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', content);

console.log('Fixed the incorrect regex replacement!');