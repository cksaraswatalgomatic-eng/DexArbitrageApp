// Target the specific duplicate pattern around the handleProfitNotifications function
const fs = require('fs');

let content = fs.readFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', 'utf8');

// Look for the specific problematic pattern: a function closing with proper }); } followed by an extra });
// Pattern: code ends with }); on one line, then a blank line, then }); again, then }, then next function
const pattern = /(\\n\\s*\\}\\);\\n\\s*\\n\\s*\\}\\);\\n\\s*\\})/g;
const replacement = '\\n  });\\n}\\n';

content = content.replace(pattern, replacement);

// Write back the fixed content
fs.writeFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', content);

console.log('Attempted to fix the duplicate closing bracket pattern.');