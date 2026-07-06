chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "parseSyllabusPDF") {
        (async () => {
            try {
                 const stored = await chrome.storage.local.get(["ai_base_url", "ai_api_key", "ai_model"]);
                 const baseUrl = stored.ai_base_url || "http://127.0.0.1:8000/v1";
                 const apiKey = stored.ai_api_key || "";
                 const model = stored.ai_model || "gemma-4-E4B-it-qat-4bit";

                 const SYLLABUS_PARSE_PROMPT = `請閱讀以下課程大綱（Syllabus）文字內容，並嚴格按照以下規則，只做「抽取」不做「摘要」或「詮釋」：

1. 找到標題為 "Grading Weights" 或 "Evaluation and Grading" 的表格區塊。逐列抽取：
   - category（類別）
   - gradeItem（該類別底下的具體項目，例如 "Unit 3 – Graded Quiz"）
   - unit（該項目對應的Unit編號，例如從 "Unit 3" 抽取出 "3"）
   - associatedClos（該列對應的CLO編號清單，例如 ["CLO1", "CLO2"]）

2. 找到 "Course Schedule" 區塊，逐一抽取每個 UNIT 的 unitNumber 與 unitTitle。

3. 找到 "Course Learning Outcomes (CLOs)" 區塊，逐一抽取 cloNumber 與 description。

4. 對每一筆 gradingItems，依 associatedClos 對照 CLO清單，
   再依CLO描述文字與Unit標題的關鍵字重疊程度，反查出 coveredUnits
   （一個字串陣列，包含該評量項目實際涵蓋的所有Unit標題，
   例如 ["Unit 1: Introduction to Server-Side Web Development", "Unit 2: Basics of PHP", "Unit 3: Functions, Arrays and String Manipulation"]）。
   若無法自動配對，coveredUnits只包含該評量項目自身所屬的Unit。

5. 輸出格式，嚴格採用以下JSON結構，不要加入任何卸載說明文字、
   不要用Markdown code block包裹，直接輸出純JSON：

{
  "gradingItems": [
    {
      "category": "...",
      "gradeItem": "...",
      "unit": "...",
      "associatedClos": ["CLO1", "CLO2"],
      "coveredUnits": ["Unit 1: ...", "Unit 2: ...", "Unit 3: ..."]
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
                             content: `${SYLLABUS_PARSE_PROMPT}\n\n[課程大綱文字內容開始]\n${msg.text}\n[課程大綱文字內容結束]`
                         }]
                     })
                 });

                 const data = await response.json();
                 const reply = data.choices?.[0]?.message?.content;
                 if (!reply) {
                     sendResponse({ success: false, error: "API未回傳文字內容: " + JSON.stringify(data) });
                     return;
                 }

                 const cleaned = reply.replace(/```json|```/g, "").trim();
                 const parsed = JSON.parse(cleaned);
                 sendResponse({ success: true, data: parsed });
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true; // 保持通道開啟以支援非同步回應
    }
});
