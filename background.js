// ─────────────────────────────────────────────────────────────────────
// Syllabus AI Parser — Port-based (長連線) 版本
//
// 背景說明：MV3 Service Worker 在等待非同步 fetch 時可能被 Chrome 終止，
// 導致 sendMessage 的 channel 關閉（"message channel closed before response"）。
// 改用 chrome.runtime.connect() Port 連線可在 Port 存活期間保持 SW 不被回收。
// ─────────────────────────────────────────────────────────────────────

const SYLLABUS_PARSE_PROMPT = `請閱讀附件中的課程大綱（Syllabus）PDF，並嚴格按照以下規則，只做「抽取」不做「摘要」或「詮釋」：

1. 找到標題為 "Grading Weights" 或 "Evaluation and Grading" 的表格區塊。逐列抽取：
   - category（類別）
   - gradeItem（該類別底下的具體項目，例如 "Unit 3 – Graded Quiz"）
   - unit（該項目對應的Unit編號，只填數字，例如從 "Unit 3" 抽取出 "3"）
   - associatedClos（該列對應的CLO編號清單，例如 ["CLO1", "CLO2"]）

2. 找到 "Course Learning Outcomes (CLOs)" 區塊，逐一抽取 cloNumber 與 description。

3. 輸出格式，嚴格採用以下JSON結構，不要加入任何額外說明文字、
   不要用Markdown code block包裹，直接輸出純JSON：

{
  "gradingItems": [
    {
      "category": "...",
      "gradeItem": "...",
      "unit": "...",
      "associatedClos": ["CLO1", "CLO2"]
    }
  ],
  "clos": [
    { "cloNumber": "CLO1", "description": "..." }
  ]
}

若PDF中找不到上述任一區塊，該欄位回傳空陣列 []，不要編造內容。
不要輸出units欄位，Unit清單將由另一個可靠來源提供。`;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "parseSyllabusPDF") {
        (async () => {
            try {
                const stored = await chrome.storage.local.get(["ai_api_key"]);
                const apiKey = stored.ai_api_key;
                if (!apiKey) {
                    sendResponse({ success: false, error: "尚未設定API Key，請至擴充套件設定頁輸入" });
                    return;
                }

                const response = await fetch("https://api.anthropic.com/v1/messages", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-api-key": apiKey,
                        "anthropic-version": "2023-06-01"
                    },
                    body: JSON.stringify({
                        model: "claude-sonnet-4-6",
                        max_tokens: 2000,
                        messages: [{
                            role: "user",
                            content: [
                                { type: "document", source: { type: "base64", 
                                  media_type: "application/pdf", data: msg.pdfBase64 } },
                                { type: "text", text: SYLLABUS_PARSE_PROMPT }
                            ]
                        }]
                    })
                });

                const data = await response.json();
                const textBlock = data.content?.find(b => b.type === "text");
                if (!textBlock) {
                    sendResponse({ success: false, error: "API未回傳文字內容" });
                    return;
                }

                const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
                const parsed = JSON.parse(cleaned);

                // ── 用可靠來源覆蓋units，取代AI可能抽取失敗的版本 ──
                parsed.units = msg.reliableUnitsList || [];

                // ── 執行反查邏輯：計算每個評量項目涵蓋的Unit範圍 ──
                parsed.gradingItems = computeCoveredUnits(
                    parsed.gradingItems || [], 
                    parsed.units, 
                    parsed.clos || []
                );

                sendResponse({ success: true, data: parsed });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }
});

// ── 反查函式：依CLO描述與Unit標題的關鍵字重疊，計算涵蓋範圍 ──
// 此函式放在檔案頂層，與 onMessage listener 平行，不要巢狀寫在內部
function computeCoveredUnits(gradingItems, units, clos) {
    return gradingItems.map(item => {
        const relatedClos = (item.associatedClos || [])
            .map(cloNum => clos.find(c => c.cloNumber === cloNum))
            .filter(Boolean);

        const coveredUnitTitles = new Set();
        const ownUnit = units.find(u => u.unitNumber === item.unit?.toString());
        if (ownUnit) coveredUnitTitles.add(ownUnit.unitTitle);

        for (const clo of relatedClos) {
            if (!clo.description) continue;
            const cloWords = clo.description.toLowerCase()
                .split(/\W+/).filter(w => w.length > 4);
            for (const unit of units) {
                if (!unit.unitTitle) continue;
                const unitWords = unit.unitTitle.toLowerCase()
                    .split(/\W+/).filter(w => w.length > 4);
                const overlap = cloWords.filter(w => unitWords.includes(w));
                if (overlap.length >= 2) {
                    coveredUnitTitles.add(unit.unitTitle);
                }
            }
        }
        return { ...item, coveredUnits: Array.from(coveredUnitTitles) };
    });
}
