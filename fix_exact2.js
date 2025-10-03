// Fix the second occurrence of duplicate closing brackets
const fs = require('fs');

let content = fs.readFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', 'utf8');

// Look for the second duplicate pattern - this one is in handleLowGasNotifications function
// Pattern around line 348: there's an extra }); after the proper function closure
content = content.replace(/\r\n\r\n\r\n\r\n  \}\);\r\n\}/, '\r\n\r\n}');

fs.writeFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', content);

console.log('Fixed the second occurrence of duplicate closing brackets.');