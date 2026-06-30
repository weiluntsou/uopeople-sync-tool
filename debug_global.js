const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

const matches = content.match(/currentHomepageFilename/g);
console.log(matches);
