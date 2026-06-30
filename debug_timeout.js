const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

const matches = content.match(/AbortSignal/g);
console.log("AbortSignal occurrences:", matches ? matches.length : 0);

const matches2 = content.match(/signal:/g);
console.log("signal occurrences:", matches2 ? matches2.length : 0);

