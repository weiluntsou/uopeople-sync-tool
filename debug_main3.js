const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

// Find the full try/catch around uploadToObsidian
const startIdx = content.indexOf("try {");
const startIdx2 = content.indexOf("try {", startIdx + 10);
const startIdx3 = content.indexOf("try {", startIdx2 + 10);
console.log("Third try block:", content.substring(startIdx3 - 100, startIdx3 + 500));
