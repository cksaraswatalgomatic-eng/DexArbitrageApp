// Check for unmatched brackets in the file
const fs = require('fs');

let content = fs.readFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', 'utf8');

// Count opening and closing brackets
let openBraces = (content.match(/{/g) || []).length;
let closeBraces = (content.match(/}/g) || []).length;
let openParens = (content.match(/\\(/g) || []).length;
let closeParens = (content.match(/\\)/g) || []).length;
let openBrackets = (content.match(/\\[/g) || []).length;
let closeBrackets = (content.match(/\\]/g) || []).length;

console.log(`Braces: {${openBraces} vs }${closeBraces} - Difference: ${openBraces - closeBraces}`);
console.log(`Parentheses: (${openParens} vs )${closeParens} - Difference: ${openParens - closeParens}`);
console.log(`Brackets: [${openBrackets} vs ]${closeBrackets} - Difference: ${openBrackets - closeBrackets}`);

if (openBraces !== closeBraces || openParens !== closeParens || openBrackets !== closeBrackets) {
  console.log('\\nWARNING: Unmatched brackets detected!');
} else {
  console.log('\\nAll brackets appear to be matched.');
}