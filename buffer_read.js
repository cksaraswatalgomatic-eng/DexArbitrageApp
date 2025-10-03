// Try reading with explicit utf8 encoding and different line splitting
const fs = require('fs');

// Read as buffer first to see the raw content
const buffer = fs.readFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js');
console.log('Buffer length:', buffer.length);

// Convert to string
let content = buffer.toString('utf8');
console.log('String length:', content.length);

// Try splitting with different line endings
let lines = content.split('\\r\\n'); // Windows line endings
if (lines.length < 100) {
  lines = content.split('\\n'); // Unix line endings
}
console.log('Lines after split:', lines.length);

if (lines.length > 310) {
  console.log('Lines 300-310:');
  for (let i = 300; i <= 310; i++) {
    console.log(`${i}: ${JSON.stringify(lines[i])}`);
  }
  
  // Check for the problematic pattern
  console.log('\\nChecking for }); pattern:');
  let bracketCount = 0;
  for (let i = 300; i <= 310; i++) {
    if (lines[i] === '  });') {
      bracketCount++;
      console.log(`Found }); at line ${i} (#${bracketCount})`);
      if (bracketCount === 2) {
        console.log(`Removing duplicate at line ${i}`);
        lines.splice(i, 1);
        break;
      }
    }
  }
  
  // Rejoin and write back
  content = lines.join('\\n');
  fs.writeFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', content);
  console.log('File updated.');
} else {
  console.log('Not enough lines to check.');
}