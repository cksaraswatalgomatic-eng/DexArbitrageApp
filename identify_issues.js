// Script to identify potential bracket mismatches in the app.js file
const fs = require('fs');

const content = fs.readFileSync('D:\\\\Project\\\\DexArbitrageApp\\\\app.js', 'utf8');
const lines = content.split('\\n');

let braceCount = 0;
let parenCount = 0;
let bracketCount = 0;
const errors = [];

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    
    // Count brackets in the line
    const openBraces = (line.match(/{/g) || []).length;
    const closeBraces = (line.match(/}/g) || []).length;
    const openParens = (line.match(/\(/g) || []).length;
    const closeParens = (line.match(/\)/g) || []).length;
    const openBrackets = (line.match(/\[/g) || []).length;
    const closeBrackets = (line.match(/\]/g) || []).length;
    
    braceCount += openBraces - closeBraces;
    parenCount += openParens - closeParens;
    bracketCount += openBrackets - closeBrackets;
    
    // Check for negative counts (more closing than opening)
    if (braceCount < 0 || parenCount < 0 || bracketCount < 0) {
        errors.push({
            line: lineNum,
            content: line.trim(),
            error: `Count went negative: braces=${braceCount}, parens=${parenCount}, brackets=${bracketCount}`
        });
        // Reset to 0 if negative
        if (braceCount < 0) braceCount = 0;
        if (parenCount < 0) parenCount = 0;
        if (bracketCount < 0) bracketCount = 0;
    }
}

console.log(`Final counts - braces: ${braceCount}, parens: ${parenCount}, brackets: ${bracketCount}`);
if (errors.length > 0) {
    console.log('Errors found:');
    errors.forEach(err => console.log(`Line ${err.line}: ${err.error} - "${err.content}"`));
} else {
    console.log('No immediate bracket mismatches found at the character level.');
}

// Also look for specific duplicate patterns
console.log('\\nLooking for duplicate closing patterns...');
const duplicatePattern = /\\n\\s*\\}\\);[\\s\\n\\r]*\\}\\);/g;
let match;
let patternMatches = [];
while ((match = duplicatePattern.exec(content)) !== null) {
    const beforeMatch = content.substring(0, match.index);
    const lineNum = beforeMatch.split('\\n').length;
    patternMatches.push({line: lineNum, match: match[0]});
}

if (patternMatches.length > 0) {
    console.log('Duplicate closing patterns found:');
    patternMatches.forEach(m => console.log(`Around line ${m.line}: ${JSON.stringify(m.match.substring(0, 50))}...`));
} else {
    console.log('No duplicate closing patterns found.');
}