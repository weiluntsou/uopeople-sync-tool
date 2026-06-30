const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

// Find the catch block
const uploadCallIdx = content.indexOf("const uploadOk = await uploadToObsidian");
const afterUpload = content.substring(uploadCallIdx, uploadCallIdx + 1500);
console.log(afterUpload);
