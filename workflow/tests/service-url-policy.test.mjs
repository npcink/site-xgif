import assert from "node:assert/strict";
import test from "node:test";
import { validateServiceBaseUrl } from "../service-url-policy.js";

test("service URL policy permits HTTPS and local loopback HTTP", () => {
  assert.equal(validateServiceBaseUrl("https://api.example.com/v1/"), "https://api.example.com/v1");
  assert.equal(validateServiceBaseUrl("http://localhost:11434/v1"), "http://localhost:11434/v1");
  assert.equal(validateServiceBaseUrl("http://127.0.0.1:11434/v1"), "http://127.0.0.1:11434/v1");
  assert.equal(validateServiceBaseUrl("http://[::1]:11434/v1"), "http://[::1]:11434/v1");
});

test("service URL policy rejects remote cleartext, embedded credentials, and URL suffixes", () => {
  assert.throws(
    () => validateServiceBaseUrl("http://10.0.0.20:11434/v1", { label: "向量服务地址" }),
    /远程服务必须使用 HTTPS/u,
  );
  assert.throws(
    () => validateServiceBaseUrl("https://secret@example.com/v1"),
    /不得在 URL 中包含凭据/u,
  );
  assert.throws(
    () => validateServiceBaseUrl("https://example.com/v1?token=secret"),
    /不得包含查询参数/u,
  );
});
