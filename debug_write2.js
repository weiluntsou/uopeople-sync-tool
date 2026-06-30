const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

const uploadIdx = content.indexOf('async function uploadToObsidian');
const methodPos = content.indexOf('method:', uploadIdx + 1000);
console.log(content.substring(methodPos - 200, methodPos + 500));
