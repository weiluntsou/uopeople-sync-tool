const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

// Find the sync button handler
const startIdx = content.indexOf("chrome.tabs.sendMessage");
console.log(content.substring(startIdx - 200, startIdx + 200));
