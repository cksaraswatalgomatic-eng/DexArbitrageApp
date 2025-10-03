// Search for the exact duplicate pattern in the entire file
const fs = require('fs');

let content = fs.readFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', 'utf8');

// Look for the specific pattern that causes the syntax error:
// A function that ends with });\n\n  });\n} where the second }); is the duplicate
const pattern = '\\n  \\}\\);\\n\\n  \\}\\);\\n\\}';

console.log('Searching for pattern:', JSON.stringify(pattern));

// Check if this pattern exists in the content
if (content.includes(pattern)) {
  console.log('Found the duplicate pattern! Removing it...');
  
  // Replace with the correct pattern: });\n\n}\n
  const replacement = '\\n  });\\n\\n}';
  content = content.replace(pattern, replacement);
  
  fs.writeFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', content);
  console.log('Successfully fixed the duplicate closing bracket pattern.');
} else {
  console.log('Did not find the expected duplicate pattern.');
  console.log('File length:', content.length, 'characters');
}