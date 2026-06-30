const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');
const startIdx = content.indexOf('        let chatPrompt = `📋 使用前請先完成（2 分鐘準備）\\n`;');
const endIdx = content.indexOf('    return md;\n}');
console.log(content.substring(startIdx, endIdx));
