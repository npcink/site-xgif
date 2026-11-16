import { readFile, writeFile, readdir, mkdir, realpath, rename, open } from "node:fs/promises";
import path from "node:path";
import { METADATA_VERSION, PROMPT_VERSION, PROMPT_HASH, PROMPTS, hash, fingerprint, equal, requireCondition,
  parseDocument, selectedFields, fieldValues, validateValues, validateEvidence, validateReview, patchFields, protectedHash } from "./ai-metadata-contract.js";
import { metadataImages, VISUAL_VERSION } from "./ai-metadata-images.js";
import { requestMetadata, providerHash, publicProvider, assertReportedModel, MODEL_IDENTITY_POLICY } from "./ai-metadata-provider.js";
import { withToolLock } from "./tool-lock.js";

const json = async (file) => JSON.parse(await readFile(file, "utf8"));
function contentFile(repoRoot, item) {
  requireCondition(["article", "image"].includes(item.kind) && /^\d{8}-[a-z0-9]{4}$/u.test(item.id), "Invalid run item identity");
  const collection = item.kind === "article" ? "articles" : "images";
  requireCondition(item.file === `site/src/content/${collection}/${item.id}.md`, "Invalid run content path");
  return path.join(repoRoot, item.file);
}
async function replaceContent(file, expected, next) {
  requireCondition(await readFile(file, "utf8") === expected, "Content changed before write");
  const temp = `${file}.${process.pid}.metadata-tmp`;
  await writeFile(temp, next, { flag: "wx" });
  requireCondition(await readFile(file, "utf8") === expected, "Concurrent content edit");
  await rename(temp, file);
}
async function exists(file) { try { await readFile(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } }
export async function writeJson(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 }); await rename(temp, file);
}
function runDirectory(repoRoot, runId) {
  requireCondition(/^[a-z0-9][a-z0-9-]{2,79}$/u.test(runId), "Invalid run ID");
  return path.join(repoRoot, "workflow/.runtime/ai-metadata", runId);
}
async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? filesUnder(path.join(directory, entry.name))
    : entry.name.endsWith(".md") ? [path.join(directory, entry.name)] : []))).flat();
}
export async function collectMetadataInputs({ repoRoot, ids = [], fields = ["all"], keep = [], frames = 12 }) {
  requireCondition(new Set(ids).size === ids.length, "Duplicate selected IDs");
  const root = await realpath(repoRoot); const found = new Set(); const items = [];
  for (const kind of ["article", "image"]) {
    const directory = path.join(root, "site/src/content", kind === "article" ? "articles" : "images");
    for (const file of (await filesUnder(directory)).sort()) {
      const id = path.basename(file, ".md"); if (ids.length && !ids.includes(id)) continue;
      requireCondition(path.relative(directory, file) === `${id}.md`, "Content must use stable ID files directly inside its collection");
      const resolved = await realpath(file);
      requireCondition(resolved.startsWith(directory + path.sep), "Content file resolves outside collection");
      const raw = await readFile(file, "utf8"); const doc = parseDocument(raw);
      requireCondition(/^\d{8}-[a-z0-9]{4}$/u.test(id) && doc.data.contentId === id && !found.has(id), "Content identity mismatch");
      found.add(id);
      const selected = selectedFields(kind, doc.data, fields, keep); if (!selected.length) continue;
      // Article covers are illustrative, not evidence for the original author's claims.
      // Only inspect a cover when its own alt field is being regenerated.
      let visuals;
      try { visuals = kind === "article" && !selected.includes("coverAlt") ? [] : await metadataImages(root, kind, doc.data, { frames }); }
      catch (error) { throw new Error(`${id}: ${error.message}`); }
      const imageManifest = visuals.map(({ base64: _base64, ...image }) => image);
      const sourceHash = fingerprint({ kind, body: doc.body, source: doc.data.source, sourceUrl: doc.data.sourceUrl, images: imageManifest, visualVersion: VISUAL_VERSION });
      items.push({ id, kind, file: path.relative(root, file), raw, data: doc.data, body: doc.body, fields: selected,
        before: fieldValues(doc.data, selected), fileHash: hash(raw), sourceHash, images: imageManifest,
        visuals, protectedHash: protectedHash(raw, selected) });
    }
  }
  requireCondition(items.length > 0 && ids.every((id) => found.has(id)), "Selection is empty or contains unknown IDs");
  return items;
}
function planItem({ raw: _raw, data: _data, body: _body, visuals: _visuals, ...item }) { return item; }
function validateOutput(stage, output, item) {
  requireCondition(output && typeof output === "object", "Missing model output");
  if (stage === "generate") {
    requireCondition(equal(Object.keys(output).sort(), ["evidence", "values"]), "Unexpected generation keys");
    validateValues(output.values, item.fields, item.data); validateEvidence(output.evidence, item.fields);
  } else {
    requireCondition(equal(Object.keys(output), ["fields"]), "Unexpected review keys");
    validateReview(output.fields, item.fields);
  }
}
export function generationIdentity(configs) {
  return { promptHash: PROMPT_HASH, visualVersion: VISUAL_VERSION,
    generation: publicProvider(configs.generation), review: publicProvider(configs.review) };
}
export function validateScreenGate(gate, identity, requestedFields, requiredFields = []) {
  requireCondition(gate?.schemaVersion === "xgif.ai-metadata-gate.v1" && gate.passed === true && gate.modelIdentityVerified === true
    && equal(gate.identity, identity) && gate.sampleCount >= 6 && gate.kinds?.includes("article") && gate.kinds?.includes("image")
    && gate.suite === "site-xgif-metadata-v1"
    && requestedFields.every((field) => gate.requestedFields?.includes(field))
    && requiredFields.every((field) => gate.fieldCoverage?.includes(field)), "A passing matching eval-lab fixed-screen gate is required for more than 12 items");
}

export async function generateMetadataRun({ repoRoot, runId, configs, ids, fields = ["all"], keep = [], frames = 12,
  maxCalls = 24, gate, fetchImpl = fetch, onProgress = () => {} }) {
  return withToolLock(path.join(repoRoot, "workflow"), async () => {
    requireCondition(Number.isInteger(maxCalls) && maxCalls >= 1 && maxCalls <= 2000, "Explicit call budget must be 1–2000");
    const items = await collectMetadataInputs({ repoRoot, ids, fields, keep, frames });
    requireCondition(maxCalls >= items.length * 2, `Selection needs at most ${items.length * 2} calls; increase max-calls explicitly or select fewer items`);
    requireCondition(items.every((item) => !item.images.length || (configs.generation.vision && configs.review.vision)), "Both generator and reviewer must support vision");
    const identity = generationIdentity(configs);
    if (items.length > 12) validateScreenGate(gate, identity, fields, [...new Set(items.flatMap((item) => item.fields))]);
    const directory = runDirectory(repoRoot, runId);
    const plan = { schemaVersion: METADATA_VERSION, runId, identity, promptVersion: PROMPT_VERSION,
      fields, keep, frames, maxCalls, items: items.map(planItem) };
    const planPath = path.join(directory, "plan.json");
    if (await exists(planPath)) requireCondition(equal(await json(planPath), plan), "Run inputs/configuration changed; use a new run ID");
    else {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      for (const item of items) await writeFile(path.join(directory, `${item.id}.before.md`), item.raw, { flag: "wx", mode: 0o600 });
      await writeJson(planPath, plan);
    }
    const attempts = (await readdir(directory)).filter((name) => name.endsWith(".attempt.json"));
    let used = attempts.length; const results = []; let stopped = false;
    for (const item of items) {
      const result = { id: item.id, fields: item.fields, state: "failed" };
      try {
        requireCondition(!stopped, "Provider unavailable earlier in batch; not dispatched");
        const input = { id: item.id, kind: item.kind, fields: item.fields, originalBody: item.body,
          sourceLabel: String(item.data.source ?? ""), sourceUrl: String(item.data.sourceUrl ?? ""),
          currentMetadataForComparisonOnly: item.before, imagesInOrder: item.images };
        let generated;
        for (const stage of ["generate", "review"]) {
          const config = configs[stage === "generate" ? "generation" : "review"];
          const payload = stage === "generate" ? input : { ...input, candidate: generated };
          const requestHash = fingerprint({ payload, system: PROMPTS[stage], provider: providerHash(config) });
          const attemptPath = path.join(directory, `${item.id}.${stage}.attempt.json`);
          let record;
          if (await exists(attemptPath)) {
            record = await json(attemptPath);
            if (record.stopBatch || record.state === "claimed") stopped = true;
            requireCondition(record.requestHash === requestHash && record.state === "succeeded", `Existing ${stage} attempt is incomplete/failed; no replay. Use a new run after inspection`);
          } else {
            requireCondition(used < maxCalls, "Call budget exhausted"); used++;
            const claim = await open(attemptPath, "wx", 0o600);
            record = { state: "claimed", requestHash, requestedModel: config.model, startedAt: new Date().toISOString() };
            await claim.writeFile(JSON.stringify(record)); await claim.sync(); await claim.close();
            const start = Date.now();
            try {
              const response = await requestMetadata({ config, system: PROMPTS[stage], input: payload,
                images: item.visuals.map((image) => image.base64), fetchImpl });
              record = { ...record, ...response };
              requireCondition(!Object.values(configs).some((c) => c.apiKey && JSON.stringify(response.output).includes(c.apiKey)), "Provider output echoed a credential; rejected");
              validateOutput(stage, response.output, item);
              record.state = "succeeded";
            } catch (error) { record.state = "failed"; record.error = error.message; record.stopBatch = Boolean(error.stopBatch); stopped ||= record.stopBatch; }
            record.elapsedMs = Date.now() - start;
            // Provider error text and echoed credentials must never enter artifacts.
            let safe = JSON.stringify(record);
            for (const c of Object.values(configs)) if (c.apiKey) safe = safe.replaceAll(c.apiKey, "[redacted]");
            record = JSON.parse(safe);
            await writeJson(attemptPath, record);
            requireCondition(record.state === "succeeded", `Recorded ${stage} failure: ${record.error}`);
          }
          assertReportedModel(config, record.reportedModel);
          validateOutput(stage, record.output, item);
          if (stage === "generate") generated = record.output;
          else {
            result.values = generated.values; result.evidence = generated.evidence; result.review = record.output.fields;
            result.state = item.fields.every((field) => result.review[field].pass) ? "ready" : "needs_revision";
            result.reportedModels = { generation: (await json(path.join(directory, `${item.id}.generate.attempt.json`))).reportedModel, review: record.reportedModel };
          }
        }
      } catch (error) { stopped ||= Boolean(error.stopBatch); result.error = error.message; }
      results.push(result); await writeJson(path.join(directory, "results.json"), results);
      onProgress({ id: item.id, state: result.state, calls: used });
    }
    const report = await exportMetadataRun({ repoRoot, runId });
    return { runId, directory, calls: used, ready: results.filter((r) => r.state === "ready").length, total: results.length, report };
  });
}

async function readRun(repoRoot, runId) {
  const directory = runDirectory(repoRoot, runId); const plan = await json(path.join(directory, "plan.json"));
  requireCondition(plan.schemaVersion === METADATA_VERSION && plan.runId === runId && plan.items?.length > 0, "Invalid run plan");
  requireCondition(new Set(plan.items.map((item) => item.id)).size === plan.items.length, "Duplicate run plan identities");
  for (const item of plan.items) contentFile(repoRoot, item);
  requireCondition(plan.identity?.generation?.modelIdentityPolicy === MODEL_IDENTITY_POLICY
    && plan.identity?.review?.modelIdentityPolicy === MODEL_IDENTITY_POLICY, "Run predates strict model identity verification; create a new run");
  const results = await json(path.join(directory, "results.json"));
  requireCondition(results.length === plan.items.length && new Set(results.map((r) => r.id)).size === results.length
    && results.every((r) => plan.items.some((item) => item.id === r.id)), "Incomplete/invalid result identities");
  for (const result of results.filter((item) => ["ready", "needs_revision"].includes(item.state))) {
    for (const [role, stage] of [["generation", "generate"], ["review", "review"]]) {
      const attempt = await json(path.join(directory, `${result.id}.${stage}.attempt.json`));
      requireCondition(attempt.state === "succeeded" && attempt.requestedModel === plan.identity[role].model
        && attempt.reportedModel === result.reportedModels?.[role], "Attempt/result model identity mismatch");
      assertReportedModel(plan.identity[role], attempt.reportedModel);
    }
  }
  return { directory, plan, results };
}

const escape = (text) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export async function exportMetadataRun({ repoRoot, runId }) {
  const { directory, plan, results } = await readRun(repoRoot, runId);
  const cases = []; const blocks = []; const markdown = ["# AI 字段重跑对照", "", "仅候选预览，不代表已写回或上线。", ""];
  for (const item of plan.items) {
    const result = results.find((r) => r.id === item.id);
    cases.push({ id: item.id, kind: item.kind, sourceHash: item.sourceHash, fields: item.fields, before: item.before, ...result });
    blocks.push(`<section><h2>${escape(item.id)} · ${escape(result.state)}</h2>`);
    markdown.push(`## ${item.id} · ${result.state}`, "");
    for (const field of item.fields) {
      const before = JSON.stringify(item.before[field]); const after = JSON.stringify(result.values?.[field] ?? null);
      blocks.push(`<h3>${escape(field)}</h3><p>原值：${escape(before)}</p><p>候选：${escape(after)}</p><p>${escape(result.review?.[field]?.reason ?? result.error ?? "未完成")}</p>`);
      markdown.push(`- ${field}：${before} → ${after}`, `  - ${result.review?.[field]?.reason ?? result.error ?? "未完成"}`);
    }
    const original = await readFile(path.join(directory, `${item.id}.before.md`), "utf8");
    requireCondition(hash(original) === item.fileHash, "Original snapshot changed");
    const doc = parseDocument(original);
    if (result.state === "ready" || result.state === "needs_revision") {
      validateValues(result.values, item.fields, doc.data); validateEvidence(result.evidence, item.fields); validateReview(result.review, item.fields);
    }
    cases[cases.length - 1].contractPassed = ["ready", "needs_revision"].includes(result.state) && Boolean(result.values && result.review);
    blocks.push(`<details><summary>原始正文</summary><pre>${escape(doc.body)}</pre></details>`);
    for (const [index, image] of item.images.filter((image, i) => !i || image.sourceIndex !== item.images[i - 1].sourceIndex).entries()) {
      blocks.push(`<p>图片 ${image.sourceIndex + 1} · 帧 ${image.frame}/${image.totalFrames}</p><img loading="lazy" referrerpolicy="no-referrer" src="${escape(image.source)}" alt="原图 ${index + 1}">`);
    }
    blocks.push("</section>");
  }
  const report = { schemaVersion: "xgif.ai-metadata-eval.v1", runId, identity: plan.identity, requestedFields: plan.fields,
    cases, scope: "candidate-only-no-publish", recommendationRefreshRequiredAfterApply: false, recommendationCheckRequiredAfterApply: true };
  await writeJson(path.join(directory, "evaluation.json"), report);
  await writeFile(path.join(directory, "comparison.md"), markdown.join("\n") + "\n", { mode: 0o600 });
  await writeFile(path.join(directory, "preview.html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>AI 字段重跑对照</title><style>body{font:16px/1.8 system-ui;max-width:1000px;margin:30px auto;padding:0 20px;color:#222;background:#faf9f6}section{border-top:1px solid #ccc;padding:20px 0}p,pre{white-space:pre-wrap;overflow-wrap:anywhere}img{display:block;max-width:100%;max-height:400px;object-fit:contain}h2{font-size:23px}h3{font-size:18px}</style><h1>AI 字段重跑对照</h1><p>${cases.length} 条候选，仅本地预览，尚未写回或发布。</p>${blocks.join("\n")}</html>`, { mode: 0o600 });
  return report;
}

export async function applyMetadataRun({ repoRoot, runId, ids = [], apply = false }) {
  return withToolLock(path.join(repoRoot, "workflow"), async () => {
    const { directory, plan, results } = await readRun(repoRoot, runId); const prepared = [];
    requireCondition(!await exists(path.join(directory, "apply.json")), "Run was already applied; do not replay");
    requireCondition(ids.every((id) => plan.items.some((item) => item.id === id)), "Unknown apply ID");
    for (const item of plan.items.filter((item) => !ids.length || ids.includes(item.id))) {
      const result = results.find((r) => r.id === item.id);
      requireCondition(result.state === "ready", `Unresolved metadata: ${item.id}`);
      const currentPath = await realpath(contentFile(repoRoot, item));
      requireCondition(currentPath.startsWith(await realpath(path.join(repoRoot, "site/src/content")) + path.sep), "Unsafe content path");
      const raw = await readFile(currentPath, "utf8"); const doc = parseDocument(raw);
      requireCondition(doc.data.contentId === item.id && hash(await readFile(path.join(directory, `${item.id}.before.md`))) === item.fileHash, "Original identity/snapshot mismatch");
      requireCondition(hash(raw) === item.fileHash, `Content changed after generation: ${item.id}`);
      requireCondition(equal(selectedFields(item.kind, doc.data, item.fields), item.fields), "Invalid field selection");
      validateValues(result.values, item.fields, doc.data); validateEvidence(result.evidence, item.fields); validateReview(result.review, item.fields);
      requireCondition(item.fields.every((field) => result.review[field].pass), "Review failed");
      const visuals = item.kind === "article" && !item.fields.includes("coverAlt") ? []
        : await metadataImages(repoRoot, item.kind, doc.data, { frames: plan.frames });
      requireCondition(equal(visuals.map(({ base64: _base64, ...image }) => image), item.images), "Original image bytes changed");
      const after = patchFields(raw, result.values);
      requireCondition(protectedHash(after, item.fields) === item.protectedHash, "Protected content changed");
      prepared.push({ id: item.id, kind: item.kind, file: item.file, fields: item.fields, before: raw, after, beforeHash: hash(raw), afterHash: hash(after) });
    }
    const receipt = { schemaVersion: METADATA_VERSION, runId, state: "prepared", items: prepared, recommendationRefreshRequired: false, recommendationCheckRequired: true };
    if (!apply) return { mode: "dry-run", items: prepared.map(({ id, file, fields }) => ({ id, file, fields })) };
    await writeJson(path.join(directory, "apply.json"), receipt);
    for (const item of prepared) {
      const file = path.join(repoRoot, item.file);
      requireCondition(hash(await readFile(file)) === item.beforeHash, `Concurrent edit: ${item.id}`);
      await replaceContent(file, item.before, item.after);
    }
    receipt.state = "applied"; await writeJson(path.join(directory, "apply.json"), receipt);
    return { mode: "applied-local-only", count: prepared.length, recommendationRefreshRequired: false, recommendationCheckRequired: true };
  });
}

export async function rollbackMetadataRun({ repoRoot, runId, apply = false }) {
  return withToolLock(path.join(repoRoot, "workflow"), async () => {
    const directory = runDirectory(repoRoot, runId); const receipt = await json(path.join(directory, "apply.json"));
    requireCondition(receipt.schemaVersion === METADATA_VERSION && receipt.runId === runId && ["prepared", "applied"].includes(receipt.state), "Invalid rollback receipt");
    const prepared = [];
    for (const item of receipt.items) {
      const beforeDoc = parseDocument(item.before); const afterDoc = parseDocument(item.after);
      requireCondition(Array.isArray(item.fields) && item.fields.length > 0 && equal(selectedFields(item.kind, beforeDoc.data, item.fields), item.fields), "Invalid rollback fields");
      requireCondition(beforeDoc.data.contentId === item.id && afterDoc.data.contentId === item.id
        && protectedHash(item.before, item.fields) === protectedHash(item.after, item.fields), "Rollback protected content changed");
      requireCondition(hash(item.before) === item.beforeHash && hash(item.after) === item.afterHash, "Rollback snapshot changed");
      const file = await realpath(contentFile(repoRoot, item));
      requireCondition(file.startsWith(await realpath(path.join(repoRoot, "site/src/content")) + path.sep), "Unsafe rollback path");
      const current = await readFile(file, "utf8");
      if (current === item.before) continue; // Also recovers a partially written batch.
      requireCondition(hash(item.before) === item.beforeHash && hash(item.after) === item.afterHash, "Rollback snapshot changed");
      const selectedLines = (text) => { const doc = parseDocument(text); return Object.fromEntries(item.fields.map((field) => {
        const key = field === "galleryAltText" ? "images" : field; return [key, doc.indices[key] === undefined ? null : doc.lines[doc.indices[key]]];
      })); };
      const expected = selectedLines(item.after); const actual = selectedLines(current);
      requireCondition(equal(expected, actual), `Selected fields changed since apply: ${item.id}`);
      const doc = parseDocument(current); const old = selectedLines(item.before);
      const lines = doc.lines.flatMap((line) => {
        const key = line.match(/^([A-Za-z][A-Za-z0-9]*):/u)?.[1];
        return Object.hasOwn(old, key) ? (old[key] === null ? [] : [old[key]]) : [line];
      });
      prepared.push({ file, current, restored: doc.opening + lines.join(doc.eol) + doc.closing + doc.body });
    }
    if (apply) {
      for (const item of prepared) requireCondition(await readFile(item.file, "utf8") === item.current, "Concurrent rollback edit");
      for (const item of prepared) await replaceContent(item.file, item.current, item.restored);
      receipt.state = "rolled-back"; await writeJson(path.join(directory, "apply.json"), receipt);
    }
    return { mode: apply ? "rolled-back-local-only" : "dry-run", count: prepared.length, recommendationRefreshRequired: false, recommendationCheckRequired: true };
  });
}
