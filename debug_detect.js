const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

const startIdx = content.indexOf('async function detectObsidianProtocol');
const endIdx = content.indexOf('}', startIdx + 300);
console.log(content.substring(startIdx, endIdx + 1));
