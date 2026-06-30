const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

// Find the try/catch block that calls uploadToObsidian
const uploadCallIdx = content.indexOf("const uploadOk = await uploadToObsidian");
console.log(content.substring(uploadCallIdx - 500, uploadCallIdx + 600));
