const loopbackHostnames = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
]);

export function validateServiceBaseUrl(value, {
  label = "服务地址",
} = {}) {
  const source = String(value || "").trim().replace(/\/+$/u, "");
  if (!source) return "";

  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    throw new Error(`${label}必须是有效的 HTTP(S) URL。`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${label}只允许 HTTP(S) URL。`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label}不得在 URL 中包含凭据。`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error(`${label}不得包含查询参数或片段。`);
  }
  if (parsed.protocol === "http:" && !loopbackHostnames.has(parsed.hostname.toLowerCase())) {
    throw new Error(`${label}使用 HTTP 时只能连接本机回环地址；远程服务必须使用 HTTPS。`);
  }
  return source;
}
