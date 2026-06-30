const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

const matches = content.match(/function buildAssignmentContent[\s\S]{0,500}/g);
if (matches) {
    matches.forEach(m => console.log(m));
} else {
    console.log("Not found");
}
