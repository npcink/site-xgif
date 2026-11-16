import { fingerprint, requireCondition } from "./ai-metadata-contract.js";

export function providerConfig(env, role, fallback) {
  const prefix = `XGIF_AI_${role.toUpperCase()}_`;
  const value = (key, defaultValue) => env[prefix + key] ?? defaultValue;
  const provider = value("PROVIDER", fallback?.provider ?? "openai");
  const baseUrl = String(value("BASE_URL", fallback?.baseUrl ?? "")).replace(/\/+$/u, "");
  const model = String(value("MODEL", fallback?.model ?? "")).trim();
  requireCondition(["openai", "ollama"].includes(provider) && baseUrl && model, `Configure ${prefix}PROVIDER, BASE_URL and MODEL`);
  const url = new URL(baseUrl); const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  requireCondition(!url.username && !url.password && !url.search && !url.hash && (url.protocol === "https:" || (url.protocol === "http:" && loopback)), "AI endpoint must use HTTPS or local loopback HTTP");
  requireCondition(provider !== "ollama" || (loopback && url.pathname === "/"), "Ollama requires a loopback root URL (SSH forwarding supported)");
  const sameEndpoint = fallback?.provider === provider && fallback?.baseUrl === baseUrl;
  let aliases;
  try { aliases = JSON.parse(value("REPORTED_MODEL_ALIASES", JSON.stringify(sameEndpoint && fallback.model === model ? (fallback.reportedModelAliases || []) : []))); }
  catch { throw new Error("REPORTED_MODEL_ALIASES must be a JSON array"); }
  requireCondition(Array.isArray(aliases) && aliases.length <= 20 && aliases.every((alias) => typeof alias === "string" && alias.trim() === alias && alias.length > 0 && alias.length < 200), "Invalid reported model aliases");
  const config = { provider, baseUrl, model, reportedModelAliases: [...new Set(aliases)].sort(),
    apiKey: String(value("API_KEY", sameEndpoint ? fallback.apiKey : "")),
    vision: String(value("VISION", String(sameEndpoint && fallback.model === model ? fallback.vision : false))) === "true",
    revision: String(value("REVISION", sameEndpoint && fallback.model === model ? (fallback.revision ?? "") : "")),
    timeoutMs: Number(value("TIMEOUT_MS", fallback?.timeoutMs ?? 120000)),
    maxOutputTokens: Number(value("MAX_OUTPUT_TOKENS", fallback?.maxOutputTokens ?? 6000)),
    reasoningEffort: String(value("REASONING_EFFORT", fallback?.reasoningEffort ?? "")),
  };
  requireCondition(Number.isInteger(config.timeoutMs) && config.timeoutMs >= 100 && config.timeoutMs <= 300000, "Invalid AI timeout");
  requireCondition(Number.isInteger(config.maxOutputTokens) && config.maxOutputTokens >= 128 && config.maxOutputTokens <= 32000, "Invalid output budget");
  requireCondition(provider !== "openai" || config.apiKey || loopback, "Cloud AI requires an API key");
  return config;
}
export const MODEL_IDENTITY_POLICY = "reported-model-allowlist-v1";
export function publicProvider({ apiKey: _key, ...config }) { return { ...config, reportedModelAliases: [...new Set(config.reportedModelAliases || [])].sort(), modelIdentityPolicy: MODEL_IDENTITY_POLICY }; }
export function assertReportedModel(config, reportedModel) {
  if (typeof reportedModel !== "string" || ![config.model, ...(config.reportedModelAliases || [])].includes(reportedModel)) {
    throw unavailable("AI reported model identity mismatch or missing; batch stopped; inspect provider or configure an explicit permitted alias in a new run");
  }
}
export function providerHash(config) { return fingerprint(publicProvider(config)); }
function unavailable(message) {
  return Object.assign(new Error(message), { stopBatch: true });
}

/** No automatic retries: a failed/ambiguous request remains a recorded attempt. */
export async function requestMetadata({ config, system, input, images = [], fetchImpl = fetch }) {
  requireCondition(!images.length || config.vision, "Selected content requires a vision model");
  const text = JSON.stringify(input);
  const endpoint = config.provider === "ollama" ? `${config.baseUrl}/api/chat`
    : `${config.baseUrl}${config.baseUrl.endsWith("/v1") ? "" : "/v1"}/chat/completions`;
  const payload = config.provider === "ollama" ? {
    model: config.model, stream: false, format: "json", think: false,
    options: { temperature: 0, num_predict: config.maxOutputTokens },
    messages: [{ role: "system", content: system }, { role: "user", content: text, ...(images.length ? { images } : {}) }],
  } : {
    model: config.model, stream: false, store: false, temperature: 0,
    max_completion_tokens: config.maxOutputTokens, response_format: { type: "json_object" },
    ...(config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
    messages: [{ role: "system", content: system }, { role: "user", content: [
      { type: "text", text }, ...images.map((image) => ({ type: "image_url", image_url: { url: `data:image/png;base64,${image}`, detail: "high" } })),
    ] }],
  };
  let response;
  try {
    response = await fetchImpl(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(config.timeoutMs),
      headers: { "Content-Type": "application/json", ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) }, body: JSON.stringify(payload) });
  } catch { throw unavailable("AI transport failed or timed out; batch stopped; attempt will not be replayed"); }
  if (!response.ok) throw unavailable(`AI HTTP ${response.status}; batch stopped; attempt will not be replayed`);
  let wire;
  try { wire = await response.json(); } catch { throw new Error("Provider returned invalid JSON"); }
  assertReportedModel(config, wire.model);
  const content = config.provider === "ollama" ? wire.message?.content : wire.choices?.[0]?.message?.content;
  requireCondition(config.provider === "ollama" ? wire.done === true && wire.done_reason === "stop" : wire.choices?.[0]?.finish_reason === "stop", "Incomplete AI response");
  requireCondition(typeof content === "string", "Provider returned no text");
  let output;
  try { output = JSON.parse(content); } catch { throw new Error("AI response is not a JSON object"); }
  return { output, reportedModel: wire.model, usage: wire.usage ?? { prompt_tokens: wire.prompt_eval_count, completion_tokens: wire.eval_count }, responseHash: fingerprint(wire) };
}
