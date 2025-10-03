// Direct approach to examine and fix the specific lines around the error
const fs = require('fs');

let content = fs.readFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', 'utf8');

// Split into lines
let lines = content.split('\\n');

// Examine the exact lines around the reported error (line 303, which is index 302)
console.log('Examining lines around the error:');
for (let i = 300; i <= 305; i++) {
  console.log(`${i}: ${JSON.stringify(lines[i])}`);
}

// Let's check what's between lines 300-305 to see if there's a pattern
const section = lines.slice(300, 306);
console.log('\\nSection 300-305:');
section.forEach((line, idx) => {
  console.log(`${idx + 300}: ${JSON.stringify(line)}`);
});

// Try to detect duplicate closing patterns
let duplicatePattern = '';
for (let i = 300; i <= 305; i++) {
  if (lines[i] === '  });') {
    if (duplicatePattern === '  });') {
      console.log(`Found duplicate }); at line ${i}`);
      // Remove this duplicate line
      lines.splice(i, 1);
      console.log('Removed duplicate line');
      break;
    } else {
      duplicatePattern = '  });';
    }
  } else {
    duplicatePattern = '';
  }
}

// Write back the fixed content
content = lines.join('\\n');
fs.writeFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', content);
console.log('\\nFinished processing file.');