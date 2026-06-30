const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');
const conflictIdx = content.indexOf('function showFileConflictModal');
console.log(content.substring(conflictIdx, conflictIdx + 2000));
