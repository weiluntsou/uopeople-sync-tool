const fs = require('fs');

try {
    let content = fs.readFileSync('popup.js', 'utf8');

    const corruptedPart = `     - Provide actionabl// Helper to construct the content for the assignment draft note (v4.1 — Clean workspace)
function buildAssignmentContent(assignmentActivity, course) {
    const courseType = detectCourseType(course || "");
    const rubricText = assignmentActivity.rubricText || "";`;
    
    // It seems there's a huge block of corrupted text we saw earlier. Let's find exactly where it starts.
    const startIdx = content.indexOf('     - Provide actionabl// Helper to construct');
    
    // We need to find where the NEXT clean function starts to know where to cut the corruption.
    // The next valid function after the duplicated buildAssignmentContent is `function buildStudyGuideContent`
    const endIdx = content.indexOf('// Helper to construct the study guide content for a unit');
    
    if (startIdx === -1 || endIdx === -1) {
        console.log("Could not find start or end markers.");
        process.exit(1);
    }
    
    console.log("Found startIdx:", startIdx, "endIdx:", endIdx);
    
    const replacement = `     - Provide actionable insights on how these concepts integrate.
     - Identify 2 cross-disciplinary applications (e.g. how does this concept apply to Business, Tech, or Society?).

───────────────────────────────────────
Input Data for this Unit:
───────────────────────────────────────
Course Name: \${getCleanedCourseName(course)}
Topics:
\${topicsBlock}
Learning Outcomes:
\${outcomesBlock}
Assignment Details & Rubrics:
\${assignBlock}
Discussion Prompts:
\${discussBlock}\`;
}

// Helper to construct the content for the assignment draft note (v4.1 — Clean workspace)
function buildAssignmentContent(assignmentActivity, course) {
    const rubricText = assignmentActivity.rubricText || "";

    let md = \`# \${assignmentActivity.title}\\n\`;
    md += \`📅 截止日 **(Deadline)**：\${assignmentActivity.deadline || "N/A"}\\n\`;
    md += \`🔗 [前往作業頁面 (Assignment Page)](\${assignmentActivity.url || ""})\\n\\n\`;

    md += \`## 📋 題目內容 (Assignment Prompt)\\n\`;
    if (rubricText.trim().length > 10) {
        md += \`\${rubricText.trim()}\\n\\n\`;
    } else {
        md += \`⚠️ 題目未自動擷取 (Not auto-extracted)，請至上方連結複製題目後貼入此處。\\n\\n\`;
    }

    md += \`## ✍️ 我的草稿 (Draft)\\n\\n\\n\\n\`;

    md += \`## 提交前自我審核 **(Pre-submission Checklist)**\\n\`;
    md += \`- [ ] 符合字數要求 **(Word count requirement met)**\\n\`;
    md += \`- [ ] 已引用 APA 格式 **(APA citations included)**\\n\`;
    md += \`- [ ] 已回應所有子問題 **(All sub-questions / parts addressed)**\\n\`;
    md += \`- [ ] 已閱讀一遍確認無錯字 **(Proofread for typos and grammar)**\\n\`;

    return md;
}

`;

    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx);
    
    fs.writeFileSync('popup.js', before + replacement + after, 'utf8');
    console.log("Fixed popup.js successfully.");
} catch (e) {
    console.error("Error:", e);
}
