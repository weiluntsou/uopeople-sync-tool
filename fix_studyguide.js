const fs = require('fs');

try {
    let content = fs.readFileSync('popup.js', 'utf8');

    // 1. Update Rhythm guide mentions
    content = content.replace(
        /接著跑 🔬 費曼四段 Prompt 確認理解後撰寫討論帖初稿。/g,
        '並根據 AI 的引導逐步完成費曼檢核與初稿。'
    );
    content = content.replace(
        /接著跑 🔬 費曼四段 Prompt。⚠️ Prompt 3 的盲點 \(blind spots\) 就是你最需要補讀的部分。/g,
        '並跟隨 AI 的逐步費曼檢核 (Feynman Check) 指引，找出盲點 (blind spots) 加強閱讀。'
    );
    
    // 2. Update prompt guide link
    content = content.replace(
        /> - 🔬 費曼四段 Prompt（用於主動回憶與理解檢核）\\n/g,
        '> - 🔬 逐步費曼檢核（已整合至 Chat Prompt 輸出中）\\n'
    );
    
    // 3. Update the user sections
    const oldSections = `    md += \`## 🧠 AI 學習指南輸出 (AI Study Guide Output)\\n\`;
    md += \`> 使用說明：將 🤖 Chat Prompt（在 CourseSummary）的 AI 回應貼在此處\\n\\n\`;
    md += \`[空白，等待貼入 AI 回應]\\n\\n\`;

    md += \`---\\n\`;
    md += \`## 🔬 費曼檢核記錄 (Feynman Check Record)\\n\\n\`;
    md += \`### 我的核心概念解釋（Prompt 2 自填）\\n\`;
    md += \`[空白，使用者用自己的話寫 3–5 句]\\n\\n\`;
    md += \`### AI 指出的盲點（Prompt 3 輸出）\\n\`;
    md += \`[空白，貼入 AI 回應]\\n\\n\`;
    md += \`### 本週最強類比（Prompt 4 輸出，選 1 個）\\n\`;
    md += \`[空白，貼入最有共鳴的那個類比]\\n\\n\`;
    md += \`---\\n\\n\`;`;

    const newSections = `    md += \`## 🧠 AI 學習指南與逐步費曼檢核 (AI Study Guide & Feynman Output)\\n\`;
    md += \`> 使用說明：將 🤖 Chat Prompt 的 AI 回應貼在此處。模型會在此引導你逐步進行費曼檢核，並在看筆記和寫作業的過程中，協同寫出費曼回饋。\\n\\n\`;
    md += \`[空白，等待貼入 AI 回應與進行費曼互動]\\n\\n\`;

    md += \`---\\n\\n\`;`;
    
    if (content.includes(oldSections)) {
        content = content.replace(oldSections, newSections);
    } else {
        console.log("Could not find the old sections to replace. Here is what I searched for:\n" + oldSections);
        process.exit(1);
    }

    fs.writeFileSync('popup.js', content, 'utf8');
    console.log("Fixed buildStudyGuideContent successfully.");
} catch (e) {
    console.error("Error:", e);
}
