const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

const uploadIdx = content.indexOf('async function uploadToObsidian');
const conflictIdx = content.indexOf('if (conflictFiles.length > 0) {', uploadIdx);

console.log(content.substring(conflictIdx - 200, conflictIdx + 200));

