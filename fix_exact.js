// Target the specific duplicate pattern using exact string replacement
const fs = require('fs');

let content = fs.readFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', 'utf8');

// Replace the specific pattern of duplicate closing brackets in handleProfitNotifications
// This replaces the pattern where there's an extra }); after the proper function closure
content = content.replace(/\r\n {2}\}\);\r\n\r\n {2}\}\);\r\n\}/, '\r\n  });\r\n}');

fs.writeFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', content);

console.log('Fixed duplicate closing brackets using exact string replacement.');