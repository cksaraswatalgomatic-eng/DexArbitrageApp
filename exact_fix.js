// Fix the duplication issue using exact string replacement
const fs = require('fs');

// Read file as text
let content = fs.readFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', 'utf8');

// I know from debugging that there are multiple line endings, so I'll check the actual format
// The key is to match the exact text pattern that was duplicated

// First, fix the pattern in handleProfitNotifications function (around line ~300)
// The original duplication pattern where extra }); was added
content = content.replace(/\n {2}\}\);\n\n\n\n {2}\}\);\n}/, '\n  });\n}');

// Second, fix the pattern in handleLowGasNotifications function (around line ~345)
content = content.replace(/\n {2}\}\);\n\n\n\n {2}\}\);\n}/, '\n  });\n}');

// Write the fixed content back
fs.writeFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', content);

console.log('Fixed duplicate closing brackets.');