const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

const uploadIdx = content.indexOf('async function uploadToObsidian');
const conflictIdx = content.indexOf('function showFileConflictModal');
const endUploadIdx = content.indexOf('function showFileConflictModal', uploadIdx);

console.log("=== uploadToObsidian snippet ===");
console.log(content.substring(uploadIdx, uploadIdx + 1500));

console.log("\n=== showFileConflictModal snippet ===");
console.log(content.substring(conflictIdx, conflictIdx + 1500));

