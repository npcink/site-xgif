import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { PROMPTS, parseDocument, protectedHash, selectedFields, patchFields, validateValues, validateReview } from "../ai-metadata-contract.js";
import { providerConfig, requestMetadata } from "../ai-metadata-provider.js";
import { collectMetadataInputs, generateMetadataRun, applyMetadataRun, rollbackMetadataRun, validateScreenGate } from "../ai-metadata-runner.js";
import { metadataImages } from "../ai-metadata-images.js";

const configs = {
  generation: { provider: "openai", model: "generator", baseUrl: "https://model.test/v1", apiKey: "private-fixture-key", vision: true, timeoutMs: 1000, maxOutputTokens: 4000 },
  review: { provider: "openai", model: "reviewer", baseUrl: "https://model.test/v1", apiKey: "private-fixture-key", vision: true, timeoutMs: 1000, maxOutputTokens: 4000 },
};
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "xgif-metadata-")); t.after(() => rm(root, { recursive: true, force: true }));
  for (const dir of ["articles", "images"]) await mkdir(path.join(root, "site/src/content", dir), { recursive: true });
  await mkdir(path.join(root, "site/public/images"), { recursive: true });
  for (const color of ["red", "blue"]) await sharp({ create: { width: 20, height: 20, channels: 3, background: color } }).png().toFile(path.join(root, `site/public/images/${color}.png`));
  const article = '---\r\ntitle: "旧题"\r\ncontentId: "20261113-aaaa"\r\nsummary: "旧摘要"\r\ntags: ["生活"]\r\nsource: "来源原样"\r\nsourceKind: "original"\r\npubDate: "2026-11-13"\r\ncoverImage: "/images/red.png"\r\ndraft: true\r\n---\r\n\r\n快35岁了，我不再争口头输赢。\r\n标点、、错字不修；顺序不动！\r\n';
  const image = '---\ntitle: "两色方块"\ncontentId: "20261113-bbbb"\ndescription: "旧描述"\ntags: ["反应图"]\nimage: "/images/red.png"\nimages: [{"src":"/images/red.png","width":20,"height":20},{"src":"/images/blue.png","width":20,"height":20,"altText":"旧蓝色"}]\nwidth: 20\nheight: 20\nsource: "原图来源"\nsourceKind: "user_provided"\ncategory: "反应图"\nmood: []\nscenes: []\npublic: false\ndraft: true\n---\n\n原始图注保持。\n';
  const files = ["site/src/content/articles/20261113-aaaa.md", "site/src/content/images/20261113-bbbb.md"];
  await writeFile(path.join(root, files[0]), article); await writeFile(path.join(root, files[1]), image);
  return { root, files, article, image };
}
function mockProvider({ rejectReview = false, mutate } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const wire = JSON.parse(init.body); const input = JSON.parse(wire.messages[1].content[0].text);
    calls.push({ url, wire, input });
    const values = Object.fromEntries(input.fields.map((field) => [field, ({ title: "快35岁，我不再争口头输赢", summary: "作者临近35岁，不再执着于与人争口头输赢。", tags: ["生活"],
      coverAlt: "红色方块", description: "两张图分别展示红色和蓝色方块。", category: "反应图", altText: "红色方块", galleryAltText: ["红色方块", "蓝色方块"], mood: [], scenes: ["颜色展示"] })[field]]));
    const evidence = Object.fromEntries(input.fields.map((field) => [field, ["来自原文或可见画面"]]));
    let output = wire.messages[0].content === PROMPTS.generate ? { values, evidence } : { fields: Object.fromEntries(input.fields.map((field) => [field,
      { scores: { faithfulness: rejectReview ? 1 : 2, core: 2, clarity: 2, naturalness: 2 }, pass: !rejectReview, reason: "依据该条原文及画面核对。", evidence: evidence[field] }])) };
    if (mutate) output = mutate(output, input);
    return { ok: true, status: 200, json: async () => ({ model: wire.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }) };
  };
  return { calls, fetchImpl };
}

test("full field rerun is preview-only; apply protects raw body, statuses, sources and gallery identity; rollback preserves later edits", async (t) => {
  const { root, files, article, image } = await fixture(t); const mock = mockProvider();
  const result = await generateMetadataRun({ repoRoot: root, runId: "round-one", configs, fetchImpl: mock.fetchImpl });
  assert.equal(result.ready, 2); assert.equal(mock.calls.length, 4);
  assert.equal(await readFile(path.join(root, files[0]), "utf8"), article);
  assert.equal(await readFile(path.join(root, files[1]), "utf8"), image);
  assert.equal(mock.calls[0].input.originalBody, parseDocument(article).body);
  assert.equal(mock.calls[2].input.imagesInOrder.length, 2);
  assert.equal(mock.calls[2].input.imagesInOrder[1].sourceIndex, 1);
  assert.equal((await applyMetadataRun({ repoRoot: root, runId: "round-one" })).mode, "dry-run");
  const applied = await applyMetadataRun({ repoRoot: root, runId: "round-one", apply: true });
  assert.equal(applied.recommendationRefreshRequired, false);
  assert.equal(applied.recommendationCheckRequired, true);
  const changed = await readFile(path.join(root, files[0]), "utf8");
  assert.equal(parseDocument(changed).body, parseDocument(article).body);
  assert.equal(parseDocument(changed).data.draft, true);
  assert.equal(protectedHash(changed, ["title", "summary", "tags", "coverAlt"]), protectedHash(article, ["title", "summary", "tags", "coverAlt"]));
  const data = parseDocument(await readFile(path.join(root, files[1]), "utf8")).data;
  assert.equal(data.images[1].src, "/images/blue.png"); assert.equal(data.images[1].width, 20);
  assert.equal(data.images[1].altText, "蓝色方块"); assert.equal(data.public, false);
  await writeFile(path.join(root, files[0]), changed.replace('source: "来源原样"', 'source: "后来补充的来源"') + "后来新增正文。\r\n");
  await rollbackMetadataRun({ repoRoot: root, runId: "round-one", apply: true });
  assert.equal(await readFile(path.join(root, files[0]), "utf8"), article.replace('source: "来源原样"', 'source: "后来补充的来源"') + "后来新增正文。\r\n");
  assert.equal(await readFile(path.join(root, files[1]), "utf8"), image);
});

test("resume reuses successful calls but rejects changed provider, prompt inputs or budget", async (t) => {
  const { root, files } = await fixture(t); const mock = mockProvider();
  const options = { repoRoot: root, runId: "resume-test", configs, fetchImpl: mock.fetchImpl, fields: ["title"] };
  await generateMetadataRun(options); await generateMetadataRun(options); assert.equal(mock.calls.length, 4);
  await assert.rejects(generateMetadataRun({ ...options, configs: { ...configs, generation: { ...configs.generation, model: "other" } } }), /changed/u);
  await writeFile(path.join(root, files[0]), (await readFile(path.join(root, files[0]), "utf8")) + "新段落");
  await assert.rejects(generateMetadataRun(options), /changed/u); assert.equal(mock.calls.length, 4);
});

test("stale content or image bytes block the whole batch before any write", async (t) => {
  const { root, files, article, image } = await fixture(t); const mock = mockProvider();
  await generateMetadataRun({ repoRoot: root, runId: "stale-test", configs, fetchImpl: mock.fetchImpl, fields: ["title"] });
  await writeFile(path.join(root, files[1]), image + "用户新增");
  await assert.rejects(applyMetadataRun({ repoRoot: root, runId: "stale-test", apply: true }), /changed/u);
  assert.equal(await readFile(path.join(root, files[0]), "utf8"), article);
  await writeFile(path.join(root, files[1]), image);
  await sharp({ create: { width: 20, height: 20, channels: 3, background: "green" } }).png().toFile(path.join(root, "site/public/images/red.png"));
  await assert.rejects(applyMetadataRun({ repoRoot: root, runId: "stale-test", apply: true }), /image bytes changed/u);
  assert.equal(await readFile(path.join(root, files[0]), "utf8"), article);
});

test("judge rejection and forbidden response fields cannot be applied", async (t) => {
  const { root, files, article } = await fixture(t); const rejected = mockProvider({ rejectReview: true });
  const options = { repoRoot: root, configs, fields: ["title"] };
  const run = await generateMetadataRun({ ...options, runId: "rejected-test", fetchImpl: rejected.fetchImpl });
  assert.equal(run.ready, 0);
  await assert.rejects(applyMetadataRun({ repoRoot: root, runId: "rejected-test", apply: true }), /Unresolved/u);
  const bad = mockProvider({ mutate: (output) => output.values ? { ...output, values: { ...output.values, body: "改写正文" } } : output });
  const failed = await generateMetadataRun({ ...options, runId: "forbidden-test", fetchImpl: bad.fetchImpl });
  assert.equal(failed.ready, 0); assert.equal(bad.calls.length, 2);
  assert.equal(await readFile(path.join(root, files[0]), "utf8"), article);
});

test("unknown field, missing IDs, inadequate budget and a text-only visual model fail before dispatch", async (t) => {
  const { root } = await fixture(t); const mock = mockProvider(); const options = { repoRoot: root, runId: "invalid-test", configs, fetchImpl: mock.fetchImpl };
  await assert.rejects(generateMetadataRun({ ...options, fields: ["draft"] }), /Unknown editable/u);
  await assert.rejects(generateMetadataRun({ ...options, ids: ["20261113-zzzz"] }), /unknown IDs/u);
  await assert.rejects(generateMetadataRun({ ...options, maxCalls: 1 }), /needs at most/u);
  await assert.rejects(generateMetadataRun({ ...options, configs: { generation: { ...configs.generation, vision: false }, review: configs.review } }), /vision/u);
  assert.equal(mock.calls.length, 0);
});

test("keep excludes selected fields, including from all; unknown keys and wrong gallery lengths fail", () => {
  assert.deepEqual(selectedFields("article", {}, ["all"], ["title"]), ["summary", "tags"]);
  assert.throws(() => validateValues({ title: "正常", draft: false }, ["title"], {}), /field set/u);
  assert.throws(() => validateValues({ tags: ["新造标签"] }, ["tags"], {}), /Invalid/u);
  assert.throws(() => validateValues({ galleryAltText: ["只有一张"] }, ["galleryAltText"], { images: [{}, {}] }), /Invalid/u);
  assert.throws(() => validateReview({ title: { scores: { faithfulness: 0, core: 2, clarity: 2, naturalness: 2 }, pass: true, reason: "假通过", evidence: ["无"] } }, ["title"]), /Inconsistent/u);
});

test("rollback refuses later edits to the selected field", async (t) => {
  const { root, files } = await fixture(t); const mock = mockProvider();
  await generateMetadataRun({ repoRoot: root, runId: "rollback-test", configs, fields: ["title"], fetchImpl: mock.fetchImpl });
  await applyMetadataRun({ repoRoot: root, runId: "rollback-test", apply: true });
  await writeFile(path.join(root, files[0]), patchFields(await readFile(path.join(root, files[0]), "utf8"), { title: "用户后来亲自改的标题" }));
  await assert.rejects(rollbackMetadataRun({ repoRoot: root, runId: "rollback-test", apply: true }), /changed since apply/u);
});

test("failed calls are checkpointed, never silently replayed", async (t) => {
  const { root } = await fixture(t); let calls = 0;
  const options = { repoRoot: root, runId: "http-failure", ids: ["20261113-aaaa"], configs, fields: ["title"], fetchImpl: async () => { calls++; return { ok: false, status: 503 }; } };
  assert.equal((await generateMetadataRun(options)).ready, 0);
  assert.equal((await generateMetadataRun(options)).ready, 0); assert.equal(calls, 1);
});

test("provider outage stops remaining dispatches, including on resume", async (t) => {
  const { root } = await fixture(t); let calls = 0;
  const options = { repoRoot: root, runId: "outage-test", configs, fields: ["title"], fetchImpl: async () => { calls++; return { ok: false, status: 429 }; } };
  const first = await generateMetadataRun(options); assert.equal(first.ready, 0); assert.equal(calls, 1);
  await generateMetadataRun(options); assert.equal(calls, 1);
});

test("animation samples retain frame order and original bytes; secrets are redacted in persisted outputs", async (t) => {
  const { root } = await fixture(t);
  const red = await readFile(path.join(root, "site/public/images/red.png")); const blue = await readFile(path.join(root, "site/public/images/blue.png"));
  const gif = await sharp([red, blue], { join: { animated: true } }).gif().toBuffer();
  const file = path.join(root, "site/public/images/two.gif"); await writeFile(file, gif);
  const frames = await metadataImages(root, "image", { image: "/images/two.gif" });
  assert.deepEqual(frames.map(f => f.frame), [0, 1]); assert.notEqual(frames[0].sha256, frames[1].sha256);
  assert.deepEqual(await readFile(file), gif);
  const mock = mockProvider({ mutate: output => output.values ? { ...output, values: { ...output.values, title: configs.generation.apiKey } } : output });
  const result = await generateMetadataRun({ repoRoot: root, runId: "redact-test", configs, fields: ["title"], fetchImpl: mock.fetchImpl });
  assert.equal(result.ready, 0);
  const directory = path.join(root, "workflow/.runtime/ai-metadata/redact-test");
  for (const name of ["plan.json", "results.json", "evaluation.json", "comparison.md", "preview.html", "20261113-aaaa.generate.attempt.json"]) {
    assert.ok(!(await readFile(path.join(directory, name), "utf8")).includes(configs.generation.apiKey));
  }
});

test("rollback rejects forged protected fields and paths", async (t) => {
  const { root } = await fixture(t); const mock = mockProvider();
  await generateMetadataRun({ repoRoot: root, runId: "receipt-test", configs, fields: ["title"], fetchImpl: mock.fetchImpl });
  await applyMetadataRun({ repoRoot: root, runId: "receipt-test", apply: true });
  const file = path.join(root, "workflow/.runtime/ai-metadata/receipt-test/apply.json"); const receipt = JSON.parse(await readFile(file, "utf8"));
  const originalFields = receipt.items[0].fields;
  receipt.items[0].fields = ["draft"]; await writeFile(file, JSON.stringify(receipt));
  await assert.rejects(rollbackMetadataRun({ repoRoot: root, runId: "receipt-test", apply: true }), /Unknown editable|Invalid rollback/u);
  receipt.items[0].fields = originalFields; receipt.items[0].file = "../../unrelated.md";
  await writeFile(file, JSON.stringify(receipt));
  await assert.rejects(rollbackMetadataRun({ repoRoot: root, runId: "receipt-test", apply: true }), /Invalid run content path/u);
});

test("provider configuration isolates credentials across endpoints and records native Ollama requests", async () => {
  assert.throws(() => providerConfig({ XGIF_AI_REVIEW_BASE_URL: "https://other.test/v1" }, "review", configs.generation), /API key/u);
  assert.equal(providerConfig({ XGIF_AI_REVIEW_MODEL: "new-reviewer" }, "review", { ...configs.generation, revision: "generator-only-revision" }).revision, "");
  const local = providerConfig({ XGIF_AI_GENERATION_PROVIDER: "ollama", XGIF_AI_GENERATION_BASE_URL: "http://127.0.0.1:11434", XGIF_AI_GENERATION_MODEL: "local-vl", XGIF_AI_GENERATION_VISION: "true" }, "generation");
  let captured;
  const output = await requestMetadata({ config: local, system: "规则", input: { body: "原文" }, images: ["YWJj"], fetchImpl: async (url, init) => {
    captured = { url, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ model: "local-vl", done: true, done_reason: "stop", message: { content: '{"values":{}}' } }) };
  } });
  assert.equal(captured.url, "http://127.0.0.1:11434/api/chat"); assert.deepEqual(captured.body.messages[1].images, ["YWJj"]);
  assert.equal(output.reportedModel, "local-vl");
  await assert.rejects(requestMetadata({ config: configs.generation, system: "", input: {}, fetchImpl: async () => ({ ok: true, json: async () => ({ model: "generator", choices: [{ finish_reason: "length", message: { content: "{}" } }] }) }) }), /Incomplete/u);
});

test("large runs require a matching model, rubric and field coverage screen", () => {
  const identity = { generator: "a" }; const gate = { schemaVersion: "xgif.ai-metadata-gate.v1", suite: "site-xgif-metadata-v1", passed: true, modelIdentityVerified: true,
    identity, sampleCount: 6, kinds: ["article", "image"], requestedFields: ["all"], fieldCoverage: ["title"] };
  validateScreenGate(gate, identity, ["all"], ["title"]);
  assert.throws(() => validateScreenGate(gate, { generator: "b" }, ["all"], ["title"]), /matching/u);
  assert.throws(() => validateScreenGate(gate, identity, ["all"], ["description"]), /matching/u);
});

test("unknown sources and image source identity survive field patches; CRLF is preserved", async (t) => {
  const { root, article } = await fixture(t);
  const inputs = await collectMetadataInputs({ repoRoot: root, ids: ["20261113-aaaa"], fields: ["summary"], keep: ["title"] });
  assert.equal(inputs[0].before.summary, "旧摘要");
  assert.equal(inputs[0].images.length, 0);
  const after = patchFields(article, { summary: "重生成摘要" });
  assert.ok(after.includes('\r\nsummary: "重生成摘要"\r\n')); assert.equal(after.replace('summary: "重生成摘要"', 'summary: "旧摘要"'), article);
});

test("preserving an unavailable external article cover allows text metadata without using it as evidence", async (t) => {
  const { root, files, article } = await fixture(t);
  await writeFile(path.join(root, files[0]), article.replace('/images/red.png', 'https://photos.example/old-cover.jpg'));
  await assert.rejects(collectMetadataInputs({ repoRoot: root, ids: ["20261113-aaaa"] }), /20261113-aaaa/u);
  const inputs = await collectMetadataInputs({ repoRoot: root, ids: ["20261113-aaaa"], keep: ["coverAlt"] });
  assert.equal(inputs[0].images.length, 0);
  const mock = mockProvider();
  await generateMetadataRun({ repoRoot: root, runId: "kept-cover", ids: ["20261113-aaaa"], keep: ["coverAlt"], configs, fetchImpl: mock.fetchImpl });
  await applyMetadataRun({ repoRoot: root, runId: "kept-cover", apply: true });
  assert.equal(parseDocument(await readFile(path.join(root, files[0]), "utf8")).data.coverImage, 'https://photos.example/old-cover.jpg');
});

test("model identity is exact by default, explicit aliases are bound to the run, and mismatches stop dispatch", async (t) => {
  const { root } = await fixture(t); const mock = mockProvider(); let calls = 0;
  const wrong = async (...args) => {
    calls++; const response = await mock.fetchImpl(...args); const body = await response.json(); body.model = "unrequested-model";
    return { ok: true, json: async () => body };
  };
  const result = await generateMetadataRun({ repoRoot: root, runId: "wrong-model", configs, fields: ["title"], fetchImpl: wrong });
  assert.equal(result.ready, 0); assert.equal(calls, 1); assert.match(result.report.cases[0].error, /identity mismatch/);
  await generateMetadataRun({ repoRoot: root, runId: "wrong-model", configs, fields: ["title"], fetchImpl: wrong });
  assert.equal(calls, 1);
  const allowed = { generation: { ...configs.generation, reportedModelAliases: ["unrequested-model"] }, review: { ...configs.review, reportedModelAliases: ["unrequested-model"] } };
  const alias = await generateMetadataRun({ repoRoot: root, runId: "allowed-model", configs: allowed, fields: ["title"], fetchImpl: wrong });
  assert.equal(alias.ready, 2);
  await assert.rejects(generateMetadataRun({ repoRoot: root, runId: "allowed-model", configs, fields: ["title"], fetchImpl: wrong }), /configuration changed/);
  // Stored successful records must also be verified when applying/resuming.
  const file = path.join(alias.directory, "20261113-aaaa.generate.attempt.json");
  const attempt = JSON.parse(await readFile(file, "utf8")); attempt.reportedModel = "tampered"; await writeFile(file, JSON.stringify(attempt));
  await assert.rejects(applyMetadataRun({ repoRoot: root, runId: "allowed-model" }), /model identity mismatch/);
  const inherited = providerConfig({ XGIF_AI_REVIEW_MODEL: "new-reviewer" }, "review", { ...configs.generation, reportedModelAliases: ["old-alias"] });
  assert.deepEqual(inherited.reportedModelAliases, []);
});
