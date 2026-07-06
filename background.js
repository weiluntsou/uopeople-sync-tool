// ─────────────────────────────────────────────────────────────────────
// Syllabus AI Parser — Port-based (長連線) 版本
//
// 背景說明：MV3 Service Worker 在等待非同步 fetch 時可能被 Chrome 終止，
// 導致 sendMessage 的 channel 關閉（"message channel closed before response"）。
// 改用 chrome.runtime.connect() Port 連線可在 Port 存活期間保持 SW 不被回收。
// ─────────────────────────────────────────────────────────────────────

const SYLLABUS_PARSE_PROMPT = `請閱讀以下課程大綱（Syllabus）文字內容，並嚴格按照以下規則，只做「抽取」不做「摘要」或「詮釋」：

1. 找到標題為 "Grading Weights" 或 "Evaluation and Grading" 的表格區塊。逐列抽取：
   - category（類別）
   - gradeItem（該類別底下的具體項目，例如 "Unit 3 – Graded Quiz"）
   - unit（該項目對應的Unit編號，例如從 "Unit 3" 抽取出 "3"）
   - associatedClos（該列對應的CLO編號清單，例如 ["CLO1", "CLO2"]）

2. 找到 "Course Schedule" 區塊，逐一抽取每個 UNIT 的 unitNumber 與 unitTitle。

3. 找到 "Course Learning Outcomes (CLOs)" 區塊，逐一抽取 cloNumber 與 description。

4. 輸出格式，嚴格採用以下JSON結構，不要加入任何說明文字、
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
  "units": [
    { "unitNumber": "1", "unitTitle": "..." }
  ],
  "clos": [
    { "cloNumber": "CLO1", "description": "..." }
  ]
}

若大綱中找不到上述任一區塊，該欄位回傳空陣列 []，不要編造內容。`;

// ── Port 長連線：讓 Service Worker 保持活躍直到 AI API 回應完畢 ──
function computeCoveredUnits(gradingItems, units, clos) {
    const itemsList = gradingItems || [];
    const unitsList = units || [];
    const closList = clos || [];
    return itemsList.map(item => {
        const relatedClos = (item.associatedClos || [])
            .map(cloNum => closList.find(c => c.cloNumber === cloNum))
            .filter(Boolean);
        
        const coveredUnitTitles = new Set();
        // 一定包含自己所屬的Unit
        const ownUnit = unitsList.find(u => u.unitNumber === item.unit?.toString());
        if (ownUnit) coveredUnitTitles.add(ownUnit.unitTitle);

        // 依CLO描述文字關鍵字，比對每個Unit標題是否有明顯重疊
        for (const clo of relatedClos) {
            const cloWords = (clo.description || "").toLowerCase()
                .split(/\W+/).filter(w => w.length > 4);
            for (const unit of unitsList) {
                const unitWords = (unit.unitTitle || "").toLowerCase()
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

chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "syllabus-parser") return;

    port.onMessage.addListener(async (msg) => {
        if (msg.action !== "parseSyllabusPDF") return;

        try {
            const stored = await chrome.storage.local.get(["ai_base_url", "ai_api_key", "ai_model"]);
            const baseUrl = stored.ai_base_url || "http://127.0.0.1:8000/v1";
            const apiKey  = stored.ai_api_key  || "";
            const model   = stored.ai_model    || "gemma-4-E4B-it-qat-4bit";

            // 截斷過長的 PDF 文字，避免超過 token 上限（保留前 12000 字）
            const text = typeof msg.text === "string" ? msg.text.slice(0, 12000) : "";

            const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {})
                },
                body: JSON.stringify({
                    model: model,
                    max_tokens: 2000,
                    messages: [{
                        role: "user",
                        content: `${SYLLABUS_PARSE_PROMPT}\n\n[課程大綱文字內容開始]\n${text}\n[課程大綱文字內容結束]`
                    }]
                })
            });

            const data  = await response.json();
            const reply = data.choices?.[0]?.message?.content;
            if (!reply) {
                port.postMessage({ success: false, error: "API未回傳文字內容: " + JSON.stringify(data) });
                return;
            }

            // 嘗試抽取 JSON（支援有/無 markdown code block 兩種格式）
            let cleaned = reply.trim();
            const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (jsonMatch) {
                cleaned = jsonMatch[1].trim();
            } else {
                const firstBrace = cleaned.indexOf('{');
                const lastBrace  = cleaned.lastIndexOf('}');
                if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
                }
            }

            const parsed = JSON.parse(cleaned);
            parsed.gradingItems = computeCoveredUnits(parsed.gradingItems, parsed.units, parsed.clos);
            port.postMessage({ success: true, data: parsed });

        } catch (e) {
            port.postMessage({ success: false, error: e.message });
        }
    });
});
