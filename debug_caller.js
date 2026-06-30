const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');
const searchString = 'uploadToObsidian(';
let pos = 0;
while ((pos = content.indexOf(searchString, pos)) !== -1) {
    const endPos = content.indexOf('\n', pos);
    console.log(`Line near ${pos}: ${content.substring(pos - 50, endPos + 50)}`);
    pos += searchString.length;
}
