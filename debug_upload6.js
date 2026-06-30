const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

const uploadIdx = content.indexOf('async function uploadToObsidian');
const endUploadIdx = content.indexOf('    for (const file of filesToUpload) {', uploadIdx);
console.log(content.substring(uploadIdx + 4500, endUploadIdx));
