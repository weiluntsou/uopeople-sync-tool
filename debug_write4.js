const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

const uploadIdx = content.indexOf('async function uploadToObsidian');
let pos = content.indexOf('PUT', uploadIdx);
if (pos === -1) pos = content.indexOf('POST', uploadIdx);
console.log(content.substring(pos - 150, pos + 250));
