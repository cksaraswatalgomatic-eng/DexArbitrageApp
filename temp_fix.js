// Script to find potential bracket mismatches
const fs = require('fs');

const content = fs.readFileSync('D:\\Project\\DexArbitrageApp\\app.js', 'utf8');
const lines = content.split('\n');

let openBraces = 0;
let openParens = 0;
let openBrackets = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  // Count opening and closing braces
  const openBracesInLine = (line.match(/\{/g) || []).length;
  const closeBracesInLine = (line.match(/\}/g) || []).length;
  const openParensInLine = (line.match(/\(/g) || []).length;
  const closeParensInLine = (line.match(/\)/g) || []).length;
  
  openBraces += openBracesInLine - closeBracesInLine;
  openParens += openParensInLine - closeParensInLine;
  
  if (openBraces < 0 || openParens < 0) {
    console.log(`Potential issue at line ${i + 1}: openBraces=${openBraces}, openParens=${openParens}`);
    console.log(`Line ${i + 1}: ${JSON.stringify(line)}`);
    // Reset counters as we found a mismatch
    if (openBraces < 0) openBraces = 0;
    if (openParens < 0) openParens = 0;
  }
}

console.log('\\nFinal counts - Braces:', openBraces, 'Parens:', openParens);

// Also look for suspicious patterns like standalone closing brackets
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === '});' || lines[i].trim() === '});' || lines[i].trim() === '});' || lines[i].trim() === '});') {
    // Find any line that has only a closing bracket or just closing brackets
    if (lines[i].trim().startsWith('});') && lines[i].trim() !== '});') {
      console.log(`Suspicious line ${i + 1}:`, JSON.stringify(lines[i]));
    } else if (lines[i].trim() === '});') {
      // Check if this is a standalone closing bracket line
      console.log(`Standalone }); at line ${i + 1}:`, JSON.stringify(lines[i]));
      console.log(`Previous line:`, JSON.stringify(lines[i-1]));
      console.log(`Next line:`, JSON.stringify(lines[i+1]));
    }
  }
}