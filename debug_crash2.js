const fs = require('fs');
const content = fs.readFileSync('popup.js', 'utf8');

const startIdx = content.indexOf('    const existingFilenames = new Set(');
const endIdx = content.indexOf('} // End of uploadToObsidian', startIdx);
if (endIdx === -1) {
    const backupEnd = content.indexOf('function showFileConflictModal', startIdx);
    console.log(content.substring(startIdx, backupEnd));
} else {
    console.log(content.substring(startIdx, endIdx));
}
