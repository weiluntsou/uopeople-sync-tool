const SYLLABUS_PARSE_PROMPT = `You are a curriculum assistant. Analyze the syllabus PDF provided and output a JSON object containing the following details:
1. "clos": An array of Course Learning Outcomes (CLOs) or Course Objectives.
2. "gradingWeights": An array of objects representing assessment weights, e.g. [{"assessment": "Discussion Forum", "weight": "15%"}, {"assessment": "Written Assignment", "weight": "25%"}].
3. "schedule": An array of objects representing weekly/unit schedule, e.g. [{"unit": "Unit 1", "topic": "Topic Name", "activities": "Discussion Forum, Written Assignment"}].

Your output must be a valid JSON object, optionally wrapped in \`\`\`json ... \`\`\`. Do not include any other conversational text. Format:
{
  "courseCode": "...",
  "courseTitle": "...",
  "clos": ["CLO 1...", "CLO 2..."],
  "gradingWeights": [{"assessment": "...", "weight": "..."}],
  "schedule": [{"unit": "...", "topic": "...", "activities": "..."}]
}`;

async function getStoredApiKey() {
    return new Promise((resolve) => {
        chrome.storage.local.get(["ai_key", "anthropic_api_key"], (res) => {
            resolve(res.ai_key || res.anthropic_api_key || "");
        });
    });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "parseSyllabusPDF") {
        (async () => {
            try {
                const apiKey = await getStoredApiKey(); // 從 chrome.storage.local 取得
                if (!apiKey) {
                    sendResponse({ success: false, error: "Missing Anthropic API Key (ai_key / anthropic_api_key in chrome.storage.local)" });
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
                if (!response.ok) {
                    const errorText = await response.text();
                    sendResponse({ success: false, error: `Anthropic API error (HTTP ${response.status}): ${errorText}` });
                    return;
                }
                const data = await response.json();
                const text = data.content.find(b => b.type === "text")?.text || "";
                try {
                    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
                    sendResponse({ success: true, data: parsed });
                } catch (e) {
                    sendResponse({ success: false, error: "JSON解析失敗", raw: text });
                }
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }
});
