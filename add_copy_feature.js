const fs = require('fs');
let content = fs.readFileSync('popup.js', 'utf8');

// 1. Add stripCalloutPrefix helper function below calloutLines
const calloutLinesSearch = `function calloutLines(text) {
    return text.split("\\n").map(l => \`> \${l}\`).join("\\n");
}`;

const calloutLinesReplace = `function calloutLines(text) {
    return text.split("\\n").map(l => \`> \${l}\`).join("\\n");
}

function stripCalloutPrefix(text) {
    if (!text) return "";
    return text.split("\\n").map(line => {
        if (line.startsWith("> ")) return line.substring(2);
        if (line.startsWith(">")) return line.substring(1);
        return line;
    }).join("\\n");
}`;

if (content.includes(calloutLinesSearch)) {
    content = content.replace(calloutLinesSearch, calloutLinesReplace);
    console.log("Added stripCalloutPrefix function.");
} else {
    console.log("Could not find calloutLines function definition.");
    process.exit(1);
}

// 2. Locate the place where md += \`> [!🎧]- 點擊展開：生成 Podcast 的 Audio Prompt... is appended
const audioSearch = `        md += \`> [!🎧]- 點擊展開：生成 Podcast 的 Audio Prompt (供聆聽吸收)\\n\`;
        md += audioPart + "\\n\\n";`;

const audioReplace = `        let cleanAudio = stripCalloutPrefix(audioPart);
        md += \`> [!🎧]- 點擊展開：生成 Podcast 的 Audio Prompt (供聆聽吸收)\\n\`;
        md += \`> \`\`\`markdown\\n\`;
        md += calloutLines(cleanAudio) + "\\n";
        md += \`> \`\`\`\\n\\n\`;`;

if (content.includes(audioSearch)) {
    content = content.replace(audioSearch, audioReplace);
    console.log("Updated Audio Prompt layout to include markdown code block.");
} else {
    console.log("Could not find Audio Prompt insertion code.");
    process.exit(1);
}

// 3. Locate the place where md += \`> [!🤖]- 點擊展開：生成作業破關攻略的 Chat Prompt... is appended
const chatSearch = `        md += \`> [!🤖]- 點擊展開：生成作業破關攻略的 Chat Prompt (供實作檢核)\\n\`;
        md += calloutLines(chatPrompt) + "\\n\\n";`;

const chatReplace = `        md += \`> [!🤖]- 點擊展開：生成作業破關攻略的 Chat Prompt (供實作檢核)\\n\`;
        md += \`> \`\`\`markdown\\n\`;
        md += calloutLines(chatPrompt) + "\\n";
        md += \`> \`\`\`\\n\\n\`;`;

if (content.includes(chatSearch)) {
    content = content.replace(chatSearch, chatReplace);
    console.log("Updated Chat Prompt layout to include markdown code block.");
} else {
    console.log("Could not find Chat Prompt insertion code.");
    process.exit(1);
}

fs.writeFileSync('popup.js', content, 'utf8');
console.log("Popup.js modified successfully.");
