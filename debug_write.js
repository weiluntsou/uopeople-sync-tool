const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

const searchString = 'const writeResult = await fetch(';
const pos = content.indexOf(searchString);
if(pos !== -1) {
    const endPos = content.indexOf(';', pos + 100);
    console.log(`Line near ${pos}: ${content.substring(pos - 50, endPos + 50)}`);
} else {
    console.log("Write fetch not found");
}

