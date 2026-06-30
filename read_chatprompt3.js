const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');
const searchString = '        let assignmentUrlForPrompt = "";';
const startIdx = content.indexOf(searchString);
const endIdx = content.indexOf('    return md;\n}', startIdx);
console.log(content.substring(startIdx, endIdx));
