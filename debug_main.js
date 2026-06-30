const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

// Find the main click handler
const startIdx = content.indexOf("uploadToObsidian(courseName");
console.log(content.substring(startIdx - 400, startIdx + 400));
