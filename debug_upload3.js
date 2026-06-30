const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

const uploadIdx = content.indexOf('async function uploadToObsidian');
console.log("=== uploadToObsidian snippet 3 ===");
console.log(content.substring(uploadIdx + 2950, uploadIdx + 4500));
