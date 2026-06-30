const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

const startIdx = content.indexOf('    const existingFilenames = new Set(');
const endIdx = content.indexOf('    for (const [unit, data] of Object.entries(unitMap)) {');
console.log(content.substring(startIdx, endIdx));
