import { validateServiceBaseUrl } from "./service-url-policy.js";

export function seriesVisionConfig(env) {
  const provider = String(env.XGIF_SERIES_VISION_PROVIDER || "openai");
  const baseUrl = validateServiceBaseUrl(env.XGIF_SERIES_VISION_BASE_URL);
  const model = String(env.XGIF_SERIES_VISION_MODEL || "").trim();
  const apiKey = String(env.XGIF_SERIES_VISION_API_KEY || "");
  const timeoutMs = Number(env.XGIF_SERIES_VISION_TIMEOUT_MS || 120000);
  const revision = String(env.XGIF_SERIES_VISION_REVISION || "");
  const aliases = JSON.parse(env.XGIF_SERIES_VISION_REPORTED_MODEL_ALIASES || "[]");
  if (!["openai", "ollama"].includes(provider) || !baseUrl || !model
    || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300000
    || !Array.isArray(aliases) || aliases.length > 20
    || aliases.some(value => typeof value !== "string" || !value.trim() || value.length > 200)) {
    throw new Error("SERIES_VISION_CONFIG_INVALID");
  }
  const url = new URL(baseUrl);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((provider === "ollama" && (!loopback || url.pathname !== "/"))
    || (provider === "openai" && !loopback && !apiKey)) throw new Error("SERIES_VISION_CONFIG_INVALID");
  return { provider, baseUrl, model, apiKey, timeoutMs, revision, aliases: [...new Set(aliases)].sort() };
}

export function publicSeriesVisionConfig({ apiKey: _key, ...config }) { return config; }

export async function requestSeriesVision({ config, system, input, images, fetchImpl = fetch }) {
  const local = config.provider === "ollama";
  const endpoint = local ? `${config.baseUrl}/api/chat`
    : `${config.baseUrl}${config.baseUrl.endsWith("/v1") ? "" : "/v1"}/chat/completions`;
  const text = JSON.stringify(input);
  const payload = local ? {
    model: config.model, stream: false, format: "json", think: false,
    options: { temperature: 0, num_predict: 6000 },
    messages: [{ role: "system", content: system }, { role: "user", content: text, images }],
  } : {
    model: config.model, stream: false, store: false, temperature: 0,
    max_completion_tokens: 6000, response_format: { type: "json_object" },
    messages: [{ role: "system", content: system }, { role: "user", content: [
      { type: "text", text }, ...images.map(image => ({ type: "image_url", image_url: { url: `data:image/png;base64,${image}`, detail: "high" } })),
    ] }],
  };
  let wire;
  try {
    const response = await fetchImpl(endpoint, { method: "POST", redirect: "error",
      signal: AbortSignal.timeout(config.timeoutMs),
      headers: { "content-type": "application/json", ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) },
      body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`SERIES_VISION_HTTP_${response.status}`);
    wire = await response.json();
  } catch (error) {
    throw new Error(/^SERIES_VISION_HTTP_\d{3}$/u.test(error.message) ? error.message : "SERIES_VISION_REQUEST_FAILED");
  }
  if (![config.model, ...config.aliases].includes(wire.model)) throw new Error("SERIES_VISION_MODEL_MISMATCH");
  if (local ? wire.done !== true || wire.done_reason !== "stop" : wire.choices?.[0]?.finish_reason !== "stop") {
    throw new Error("SERIES_VISION_INCOMPLETE_RESPONSE");
  }
  let output;
  try { output = JSON.parse(local ? wire.message.content : wire.choices[0].message.content); }
  catch { throw new Error("SERIES_VISION_INVALID_RESPONSE"); }
  return { output, reportedModel: wire.model };
}
