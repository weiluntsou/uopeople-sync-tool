const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

const matches = [...content.matchAll(/.*signal:.*/g)];
matches.forEach(m => console.log(m[0]));
