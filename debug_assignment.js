const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

const startIdx = content.indexOf('function buildAssignmentContent');
console.log(content.substring(startIdx, startIdx + 300));
