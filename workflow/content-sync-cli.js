import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditContentLibrary } from "./content-audit.js";
import { buildPublicationBundle, normalizePublicContentFile } from "./publication-bundle.js";
import { contentSha256, PublicationReceiptStore } from "./publication-receipts.js";
import { isolatedContentSync, retryContentSyncPush, cleanupContentSyncBranch } from "./isolated-content-sync.js";
import { retryPublicationBatch } from "./publication-batch-recovery.js";
import { ensureGitHubPullRequest } from "./github-pull-request.js";
import { safeProcessError } from "./safe-process-error.js";
import { withToolLock } from "./tool-lock.js";

export async function planContentSync({ repoRoot, files }) {
  const selected = [...new Set(files.map(normalizePublicContentFile))];
  if (!selected.length) throw new Error("请指定仓库根目录下的公开 Markdown 路径。");
  const hashes = new Map(await Promise.all(selected.map(async (file) => [
    file, contentSha256(await readFile(path.join(repoRoot, file), "utf8")),
  ])));
  const report = await auditContentLibrary({ repoRoot });
  const items = selected.map((file) => {
    const item = report.items.find((entry) => entry.file === file);
    if (!item || item.draft || item.status !== "ready") {
      throw new Error(`不能同步 ${file}：${item?.draft ? "仍是草稿；" : ""}${[...(item?.blockers || []), ...(item?.warnings || [])].join("；") || "未通过内容检查"}`);
    }
    return { file, contentId: item.contentId, contentSha256: hashes.get(file) };
  });
  const bundle = await buildPublicationBundle({ repoRoot, items });
  const root = await realpath(repoRoot);
  for (const file of bundle.files) {
    if (await realpath(path.join(repoRoot, file)) !== path.join(root, file)) throw new Error(`拒绝同步符号链接：${file}`);
  }
  return bundle;
}

export async function runContentSync({ repoRoot, files, apply = false, retry = "", createPullRequest = ensureGitHubPullRequest }) {
  const workflowRoot = path.join(repoRoot, "workflow");
  if (retry && (!apply || files.length)) throw new Error("重试请使用 --apply --retry <原内容分支>，不要同时指定文件。");
  const receipts = new PublicationReceiptStore({ filePath: path.join(workflowRoot, "records/publication-events.jsonl") });
  return withToolLock(workflowRoot, async () => {
    let result;
    if (retry) {
      const referenceReceipt = (await receipts.list()).findLast((record) => record.branch === retry);
      if (!referenceReceipt) throw new Error("没有这个分支的本机发布回执，请先核实 GitHub 和本地分支。");
      result = referenceReceipt.pushOk ? {
        branch: retry, commitSha: referenceReceipt.commitSha, push: { ok: true, attempted: false },
      } : await retryPublicationBatch({
        referenceReceipt,
        receiptStore: receipts,
        retryPush: ({ branch }) => retryContentSyncPush({ repoRoot, branch, expectedCommitSha: referenceReceipt.commitSha }),
        appendReceiptBatch: (input) => receipts.appendBatch(input),
        cleanupBranch: ({ branch }) => cleanupContentSyncBranch({ repoRoot, branch }),
      });
    } else {
      const bundle = await planContentSync({ repoRoot, files });
      if (!apply) return { ok: true, mode: "dry-run", ...bundle };
      const previous = await receipts.latestByFileAndHash(bundle.items);
      if (previous.size) throw new Error(`此版本已有发布回执，请核对原分支或使用 --apply --retry：${[...new Set([...previous.values()].map((record) => record.branch))].join("、")}`);
      let batchId;
      result = await isolatedContentSync({
        repoRoot,
        files: bundle.files,
        expectedFileSha256: bundle.expectedFileSha256,
        message: "Publish selected XGIF content",
        onPrepared: async ({ branch, commitSha }) => {
          const records = await receipts.appendBatch({ action: "sync", branch, commitSha, state: "prepared", items: bundle.items });
          batchId = records[0].batchId;
        },
      });
      await receipts.appendBatch({ action: "sync", ...result, items: bundle.items, batchId });
      if (result.push.ok) await cleanupContentSyncBranch({ repoRoot, branch: result.branch });
    }
    if (!result.push.ok) return { ok: false, ...result };
    const pullRequest = await createPullRequest({
      repoRoot,
      branch: result.branch,
      title: "Publish XGIF content",
      body: "同步所选公开 Markdown 及其引用的本地图片。内容已通过检查；合并后由 Cloudflare 构建，线上状态仍需单独核验。",
    });
    return { ...result, ok: pullRequest.ok, pullRequest };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log("content:sync -- [--apply] <site/src/content/...md> ...\ncontent:sync -- --apply --retry <content-sync/原分支>\n默认只检查；--apply 推送隔离分支并创建 PR，不会合并。");
  } else {
    try {
      const retryIndex = args.indexOf("--retry");
      if (retryIndex >= 0 && (!args[retryIndex + 1] || args[retryIndex + 1].startsWith("--"))) throw new Error("--retry 缺少分支。");
      const files = args.filter((arg, index) => arg !== "--apply" && !(retryIndex >= 0 && (index === retryIndex || index === retryIndex + 1)));
      if (files.some((arg) => arg.startsWith("--"))) throw new Error("未知参数。");
      const result = await runContentSync({
        repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
        files,
        apply: args.includes("--apply"),
        retry: retryIndex >= 0 ? args[retryIndex + 1] : "",
      });
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    } catch (error) {
      console.error(safeProcessError(error));
      process.exitCode = 1;
    }
  }
}
