const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function normalizedHost(value) {
  return String(value || "").trim().toLowerCase();
}

export function localRequestSecurityError({
  method,
  headers = {},
  port,
  csrfToken,
}) {
  const allowedHosts = new Set([
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
  ]);
  const allowedOrigins = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://[::1]:${port}`,
  ]);
  const host = normalizedHost(headers.host);
  if (!allowedHosts.has(host)) {
    return { statusCode: 403, message: "本地发布助手拒绝了无效 Host。" };
  }

  const origin = String(headers.origin || "").trim();
  if (origin && !allowedOrigins.has(origin)) {
    return { statusCode: 403, message: "本地发布助手拒绝了跨站请求。" };
  }

  if (!mutationMethods.has(String(method || "").toUpperCase())) return null;

  const contentType = String(headers["content-type"] || "").toLowerCase();
  if (!/^application\/json(?:\s*;|$)/u.test(contentType)) {
    return { statusCode: 415, message: "修改请求必须使用 application/json。" };
  }
  if (!csrfToken || String(headers["x-xgif-csrf"] || "") !== csrfToken) {
    return { statusCode: 403, message: "本地发布会话已失效，请刷新页面后重试。" };
  }
  return null;
}
