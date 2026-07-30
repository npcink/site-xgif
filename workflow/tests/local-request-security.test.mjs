import assert from "node:assert/strict";
import { test } from "node:test";
import { localRequestSecurityError } from "../local-request-security.js";

const base = {
  port: 8787,
  csrfToken: "test-token",
};

test("local publisher rejects hostile hosts and origins", () => {
  assert.equal(
    localRequestSecurityError({
      ...base,
      method: "GET",
      headers: { host: "evil.example" },
    })?.statusCode,
    403,
  );
  assert.equal(
    localRequestSecurityError({
      ...base,
      method: "POST",
      headers: {
        host: "127.0.0.1:8787",
        origin: "https://evil.example",
        "content-type": "application/json",
        "x-xgif-csrf": "test-token",
      },
    })?.statusCode,
    403,
  );
});

test("local publisher requires JSON and a valid CSRF token for mutations", () => {
  assert.equal(
    localRequestSecurityError({
      ...base,
      method: "POST",
      headers: { host: "127.0.0.1:8787", "content-type": "text/plain" },
    })?.statusCode,
    415,
  );
  assert.equal(
    localRequestSecurityError({
      ...base,
      method: "POST",
      headers: {
        host: "127.0.0.1:8787",
        "content-type": "application/jsonp",
        "x-xgif-csrf": "test-token",
      },
    })?.statusCode,
    415,
  );
  assert.equal(
    localRequestSecurityError({
      ...base,
      method: "POST",
      headers: { host: "127.0.0.1:8787", "content-type": "application/json" },
    })?.statusCode,
    403,
  );
  assert.equal(
    localRequestSecurityError({
      ...base,
      method: "POST",
      headers: {
        host: "localhost:8787",
        origin: "http://localhost:8787",
        "content-type": "application/json; charset=utf-8",
        "x-xgif-csrf": "test-token",
      },
    }),
    null,
  );
});
