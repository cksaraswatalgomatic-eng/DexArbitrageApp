// Debugging script to understand the exact structure around the error
const fs = require('fs');

let content = fs.readFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', 'utf8');
let lines = content.split('\\n');

console.log('Lines 295-310:');
for (let i = 295; i <= 310; i++) {
  console.log(`${i}: ${JSON.stringify(lines[i])}`);
}

// Find the exact pattern to remove
const patternToFind = '  });'; // This is the duplicate pattern we want to remove
console.log('\\nLooking for pattern:', JSON.stringify(patternToFind));

let foundIndices = [];
for (let i = 295; i <= 310; i++) {
  if (lines[i] === patternToFind) {
    foundIndices.push(i);
    console.log(`Found pattern at line ${i}: ${JSON.stringify(lines[i])}`);
  }
}

console.log('\\nFound indices:', foundIndices);

// If we found exactly two instances of this pattern, remove the second one
// which should be the duplicate
if (foundIndices.length >= 2) {
  const duplicateIndex = foundIndices[1]; // Second occurrence should be the duplicate
  console.log(`Removing duplicate at index ${duplicateIndex}: ${JSON.stringify(lines[duplicateIndex])}`);
  lines.splice(duplicateIndex, 1);
  
  // Join lines back together
  content = lines.join('\\n');
  fs.writeFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', content);
  console.log('Successfully removed the duplicate closing bracket.');
} else {
  console.log('Could not find the expected duplicate pattern.');
}