// Fix duplications systematically in the app.js file
const fs = require('fs');

let content = fs.readFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', 'utf8');

// First, let's fix the duplication around line 303 in handleProfitNotifications function
// Pattern: function ends with }); } but has an extra }); in between
// Find the area around the handleProfitNotifications function
const profitFuncPattern = /(function handleProfitNotifications\\(server, newTrades\\) \\{[\\s\\S]*?\\n  \\}\\);\\n\\n\\n\\n  \\}\\);\\n\\}\\nfunction)/g;
const profitFuncReplacement = (match) => {
  // Replace the extra }); with nothing, keeping the proper structure
  return match.replace(/\\n\\n\\n\\n  \\}\\);\\n\\}/, '\\n\\n}');
};

content = content.replace(profitFuncPattern, profitFuncReplacement);

// Second, fix the duplication around handleLowGasNotifications function
const lowGasFuncPattern = /(function handleLowGasNotifications\\(server, items\\) \\{[\\s\\S]*?\\n  \\}\\);\\n\\n\\n\\n  \\}\\);\\n\\}\\nfunction)/g;
const lowGasFuncReplacement = (match) => {
  // Replace the extra }); with nothing
  return match.replace(/\\n\\n\\n\\n  \\}\\);\\n\\}/, '\\n\\n}');
};

content = content.replace(lowGasFuncPattern, lowGasFuncReplacement);

fs.writeFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', content);

console.log('Fixed duplication issues in notification functions.');