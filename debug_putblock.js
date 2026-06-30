const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

// Find the PUT loop
const startIdx = content.indexOf('    // Sequential PUT requests to Obsidian');
const endIdx = content.indexOf('function showFileConflictModal');
console.log(content.substring(startIdx, endIdx));
