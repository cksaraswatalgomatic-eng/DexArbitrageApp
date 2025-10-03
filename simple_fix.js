// Simple fix for the duplicate closing bracket in handleProfitNotifications
const fs = require('fs');

let content = fs.readFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', 'utf8');

// Replace the specific problematic pattern with the correct one
// Pattern: });\n\n  });\n} -> });\n\n}\n
const oldPattern = '\\n  });\\n\\n  });\\n}';
const newPattern = '\\n  });\\n\\n}';

content = content.split(oldPattern).join(newPattern);

fs.writeFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', content);

console.log('Fixed the duplicate closing bracket in handleProfitNotifications.');