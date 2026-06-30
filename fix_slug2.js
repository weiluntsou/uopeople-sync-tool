const fs = require('fs');
let content = fs.readFileSync('popup.js', 'utf8');

// First remove the bad getUnitSlug
const badMatch = content.match(/function getUnitSlug[\s\S]*?\}/);
if (badMatch) {
    content = content.replace(badMatch[0], "");
}

const slugFunc = `
function getUnitSlug(unitName) {
    if (!unitName) return "Gen";
    const match = unitName.match(/Unit\\s+(\\d+)/i);
    return match ? 'U' + match[1] : unitName.replace(/[^a-zA-Z0-9]/g, "");
}
`;

// Insert it right after obsidianNoteName
const targetStr = 'function obsidianNoteName(course, title) {\n';
const endIdx = content.indexOf('}', content.indexOf(targetStr)) + 1;
content = content.substring(0, endIdx) + '\n' + slugFunc + content.substring(endIdx);

fs.writeFileSync('popup.js', content, 'utf8');
console.log("Fixed getUnitSlug.");
