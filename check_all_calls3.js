const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

// Get all function definitions
const defs = [...content.matchAll(/^function ([a-zA-Z]+)\s*\(/gm)].map(m => m[1]);
console.log("=== Defined functions ===");
defs.sort().forEach(d => console.log(' -', d));
