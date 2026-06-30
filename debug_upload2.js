const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

const uploadIdx = content.indexOf('async function uploadToObsidian');
const conflictIdx = content.indexOf('function showFileConflictModal');
const endUploadIdx = content.indexOf('function showFileConflictModal', uploadIdx);

console.log("=== uploadToObsidian snippet 2 ===");
console.log(content.substring(uploadIdx + 1500, uploadIdx + 3000));
