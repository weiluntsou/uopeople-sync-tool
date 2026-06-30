const fs = require('fs');
let content = fs.readFileSync('popup.js', 'utf8');

// The file currently has a syntax error. Let's fix it manually.
// Find the function definition
let lines = content.split('\n');
let newLines = [];
let skip = false;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('function getUnitSlug(unitName) {')) {
        skip = true;
    }
    if (!skip) {
        newLines.push(lines[i]);
    }
    if (skip && lines[i].includes('}')) {
        skip = false;
    }
}

// Add it correctly
const slugFuncLines = [
    'function getUnitSlug(unitName) {',
    '    if (!unitName) return "Gen";',
    '    const match = unitName.match(/Unit\\s+(\\d+)/i);',
    '    return match ? "U" + match[1] : unitName.replace(/[^a-zA-Z0-9]/g, "");',
    '}'
];

let finalLines = [];
for (let i = 0; i < newLines.length; i++) {
    finalLines.push(newLines[i]);
    if (newLines[i] === 'function obsidianNoteName(course, title) {') {
        // we add after the end of this function
        while (newLines[i+1] && newLines[i+1] !== '}') {
            i++;
            finalLines.push(newLines[i]);
        }
        if (newLines[i+1] === '}') {
            i++;
            finalLines.push(newLines[i]);
            finalLines.push('');
            finalLines = finalLines.concat(slugFuncLines);
        }
    }
}

fs.writeFileSync('popup.js', finalLines.join('\n'), 'utf8');
console.log("Fixed getUnitSlug thoroughly.");
