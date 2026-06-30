const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

// Find the actual callback
const sendMsgIdx = content.indexOf('chrome.tabs.sendMessage(tab.id, { action: "scanPage" }');
console.log(content.substring(sendMsgIdx - 100, sendMsgIdx + 2000));
