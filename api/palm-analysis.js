const DEFAULT_MODEL = "gemini-2.5-flash";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const env = globalThis.process?.env || {};
  const apiKey = env.GEMINI_API_KEY || env.PALMISTRY_AI_API_KEY;
  if (!apiKey) {
    return res.status(501).json({
      error: "AI API key is not configured",
      engineLabel: "AI 분석 준비 중",
    });
  }

  const { leftImage, rightImage, quality } = req.body || {};
  if (!leftImage || !rightImage) {
    return res.status(400).json({ error: "Both leftImage and rightImage are required" });
  }

  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const geminiResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(buildGeminiRequest(leftImage, rightImage, quality)),
    }
  );

  const payload = await geminiResponse.json().catch(() => ({}));
  if (!geminiResponse.ok) {
    return res.status(geminiResponse.status).json({
      error: "Gemini analysis failed",
      detail: payload?.error?.message || "Unknown Gemini API error",
      engineLabel: "Gemini 분석 실패",
    });
  }

  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  let result;
  try {
    result = parseGeminiJson(text);
  } catch (error) {
    return res.status(502).json({
      error: "Gemini response did not contain valid JSON",
      detail: error.message,
      engineLabel: "Gemini 분석 실패",
    });
  }

  return res.status(200).json({
    engineLabel: `Gemini ${model}`,
    scores: result.scores,
    insights: result.insights,
    advice: result.advice,
  });
}

function buildGeminiRequest(leftImage, rightImage, quality) {
  return {
    contents: [
      {
        parts: [
          imagePart(leftImage),
          imagePart(rightImage),
          { text: buildPrompt(quality) },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.45,
    },
  };
}

function imagePart(dataUrl) {
  const { mimeType, data } = parseDataUrl(dataUrl);
  return {
    inline_data: {
      mime_type: mimeType,
      data,
    },
  };
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl).match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return { mimeType: "image/jpeg", data: String(dataUrl).split(",").pop() || "" };
  return { mimeType: match[1] || "image/jpeg", data: match[2] || "" };
}

function buildPrompt(quality) {
  return [
    "You are generating an entertainment-only palm reading report from left and right palm photos.",
    "Return Korean text. Do not provide medical, legal, financial, or deterministic claims.",
    "Use the images only as visual inspiration for a playful self-reflection report.",
    "Use a balanced tone: mostly positive and encouraging, but include one realistic caution and one practical improvement suggestion overall.",
    "For every insight field, avoid pure praise. Mention a strength plus a gentle caution or balancing advice in one concise sentence.",
    "Do not frighten, shame, diagnose, or predict fixed destiny. Phrase cautions as self-reflection hints.",
    "Scores must be integers from 0 to 100.",
    "Keep every insight sentence concise and suitable for a mobile UI, preferably one sentence each.",
    "The advice.text must include a positive point, a caution point, and an improvement suggestion.",
    "Return JSON only. Do not wrap it in Markdown.",
    "Use this exact JSON shape:",
    JSON.stringify(responseSchema()),
    `Local image quality metadata: ${JSON.stringify(quality || {})}`,
  ].join("\n");
}

function responseSchema() {
  return {
    type: "object",
    properties: {
      scores: {
        type: "object",
        properties: {
          confidence: { type: "integer" },
          life: { type: "integer" },
          head: { type: "integer" },
          heart: { type: "integer" },
          fate: { type: "integer" },
        },
        required: ["confidence", "life", "head", "heart", "fate"],
      },
      insights: {
        type: "object",
        properties: {
          left: { type: "string" },
          right: { type: "string" },
          personality: { type: "string" },
          emotion: { type: "string" },
          thinking: { type: "string" },
          relation: { type: "string" },
        },
        required: ["left", "right", "personality", "emotion", "thinking", "relation"],
      },
      advice: {
        type: "object",
        properties: {
          level: { type: "string", enum: ["good", "warn", "bad"] },
          title: { type: "string" },
          text: { type: "string" },
        },
        required: ["level", "title", "text"],
      },
    },
    required: ["scores", "insights", "advice"],
  };
}

function parseGeminiJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Gemini response did not contain valid JSON");
  }
}
