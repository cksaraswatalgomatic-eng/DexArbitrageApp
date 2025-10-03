// Read the app.js file to fix the duplicate closing bracket (again)
const fs = require('fs');

let content = fs.readFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', 'utf8');
let lines = content.split('\\n');

console.log(`Before fix: lines 298-308:`);
for (let i = 297; i <= 307; i++) {
  if (i < lines.length) {
    console.log(`${i + 1}: ${JSON.stringify(lines[i])}`);
  }
}

// Looking at the output, the duplicate is at lines[302] (which is line 303)
// Remove the duplicate line at index 302 (which is line 303 since 0-indexed)
// This removes the extra '  });' after the proper closing
lines.splice(302, 1);

console.log(`After fix: lines 298-308:`);
for (let i = 297; i <= 307; i++) {
  if (i < lines.length) {
    console.log(`${i + 1}: ${JSON.stringify(lines[i])}`);
  }
}

// Join the lines back together
content = lines.join('\\n');

// Write back the fixed content
fs.writeFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', content);

console.log('Fixed duplicate closing bracket at handleProfitNotifications.');