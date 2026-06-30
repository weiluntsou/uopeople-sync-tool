const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

// Find the try/catch wrapping the sendMessage callback
const sendMsgIdx = content.indexOf('chrome.tabs.sendMessage(tab.id, { action: "ping" }');
// find backward to get the enclosing try
let tryStart = sendMsgIdx;
while (tryStart > 0 && !content.substring(tryStart, tryStart+4).includes('try ')) {
    tryStart--;
}
console.log(content.substring(tryStart, tryStart + 4000));
