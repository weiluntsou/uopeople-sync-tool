const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

// Look at getObsidianBaseUrl usage or vault references
const matches = content.match(/\/vault\/[^`"']+/g);
console.log(matches);
