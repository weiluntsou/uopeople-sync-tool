const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

const startIdx = 0;
const endIdx = 2000;
console.log(content.substring(startIdx, endIdx));
