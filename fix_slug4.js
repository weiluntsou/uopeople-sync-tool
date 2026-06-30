const fs = require('fs');
let content = fs.readFileSync('popup.js', 'utf8');

// The file currently has a syntax error around obsidianNoteName.
// Let's replace the whole block manually to ensure correctness.

const badBlockRegex = /function obsidianNoteName\(course, title\) \{[\s\S]*?\/\/ Generate a clean Markdown heading/m;

const replacement = `function obsidianNoteName(course, title) {
    const courseCode = getCourseCode(course);
    const safeCourse = courseCode.replace(/[/\\\\?%*:|"<>]/g, "-").trim();
    const safeTitle = title.replace(/[/\\\\?%*:|"<>]/g, "-").replace(/\\[|\\]/g, "").trim();
    return \`\${safeCourse}_\${safeTitle}\`;
}

function getUnitSlug(unitName) {
    if (!unitName) return "Gen";
    const match = unitName.match(/Unit\\s+(\\d+)/i);
    return match ? "U" + match[1] : unitName.replace(/[^a-zA-Z0-9]/g, "");
}

// Generate a clean Markdown heading`;

content = content.replace(badBlockRegex, replacement);

fs.writeFileSync('popup.js', content, 'utf8');
console.log("Fixed obsidianNoteName and getUnitSlug.");
