const fs = require('fs');

try {
    let content = fs.readFileSync('popup.js', 'utf8');
    
    // 1. Add Interactive Feynman to Chat Prompt
    const searchString = `            chatPrompt += \`         作業頁面 URL：\${assignmentUrlForPrompt}」\\n\\n\`;
            chatPrompt += \`───────────────────────────────────────\\n\`;
            chatPrompt += \`Input Data for this Unit:\\n\`;`;
    
    const replacementString = `            chatPrompt += \`         作業頁面 URL：\${assignmentUrlForPrompt}」\\n\\n\`;
            chatPrompt += \`  🚀 5. Interactive Feynman Coach（費曼引導互動區）\\n\`;
            chatPrompt += \`     - 在學習指南的最後，請你拋出一個「概念核心提問 (Core Concept Question)」給學生。\\n\`;
            chatPrompt += \`     - 告訴學生：「請用 3-5 句話回覆你對本週核心概念的理解。收到後，我將指出你的盲點 (blind spots)，並提供 2 個日常生活類比 (everyday analogies) 幫助你鎖定記憶。」\\n\`;
            chatPrompt += \`     - ⚠️ 請不要一次給出所有答案，必須引導學生親自回覆來完成費曼檢核。\\n\\n\`;
            chatPrompt += \`───────────────────────────────────────\\n\`;
            chatPrompt += \`Input Data for this Unit:\\n\`;`;

    if (content.includes(searchString)) {
        content = content.replace(searchString, replacementString);
    } else {
        console.log("Could not find Chat Prompt search string to inject Feynman Coach.");
        process.exit(1);
    }
    
    // 2. Remove the 4-part Feynman Prompt block entirely
    const feynmanBlockStart = content.indexOf('        // ── 3. Feynman Prompt ──');
    const mdSeparator = content.indexOf('        md += `---\\n\\n`;', feynmanBlockStart);
    
    if (feynmanBlockStart !== -1 && mdSeparator !== -1) {
        // We want to slice out everything from feynmanBlockStart up to (but not including) mdSeparator
        const before = content.substring(0, feynmanBlockStart);
        const after = content.substring(mdSeparator);
        content = before + after;
    } else {
        console.log("Could not locate Feynman block to remove.");
        process.exit(1);
    }

    fs.writeFileSync('popup.js', content, 'utf8');
    console.log("Fixed CourseSummary Chat Prompt & Removed old Feynman prompt successfully.");
} catch (e) {
    console.error("Error:", e);
}
