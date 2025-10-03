// Script to fix duplicate closing brackets in the app.js file
const fs = require('fs');

let content = fs.readFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', 'utf8');

// Replace the problematic duplicates more carefully
// Look for the specific pattern seen in handleProfitNotifications function
content = content.replace(/\\n  \\}\\);\\n\\n\\n\\n  \\}\\);\\n\\}/g, '\\n  });\\n}\\n');

// Also fix other duplicated }); patterns
content = content.replace(/\\n[\\s\\n\\r]*\\}\\);[\\s\\n\\r]*\\}\\);/g, '\\n  });');

fs.writeFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', content);
console.log('Fixed duplicate closing brackets.');