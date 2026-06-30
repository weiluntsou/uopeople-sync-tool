const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

// Find the sendMessage for deep scan
const sendMsgIdx = content.indexOf('chrome.tabs.sendMessage(tab.id, { action: "deepScan"');
if (sendMsgIdx === -1) {
    console.log("deepScan not found, looking for alternatives:");
    const matches = content.match(/sendMessage[\s\S]{0,100}/g);
    if (matches) matches.slice(0,5).forEach(m => console.log(m));
} else {
    console.log(content.substring(sendMsgIdx - 100, sendMsgIdx + 1500));
}
