const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

const uploadIdx = content.indexOf('async function uploadToObsidian');
const methodPos = content.indexOf('method:', uploadIdx + 2000);
const methodPos2 = content.indexOf('method:', methodPos + 10);
console.log(content.substring(methodPos2 - 100, methodPos2 + 300));
