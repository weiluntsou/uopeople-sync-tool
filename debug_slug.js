const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

const matches = content.match(/function getUnitSlug/g);
console.log(matches);
