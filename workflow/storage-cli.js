import path from "node:path";
import { fileURLToPath } from "node:url";
import { LocalDataStore } from "./local-data-store.js";
import { LocalContentBackup } from "./local-content-backup.js";
import { runRecoveryDrill } from "./recovery-drill.js";
import { publisherSourceVersion } from "./runtime-version.js";

const workflowRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(workflowRoot, "..");
const command = process.argv[2] || "status";
const store = new LocalDataStore({ repoRoot, workflowRoot });
const contentBackup = new LocalContentBackup({ repoRoot, workflowRoot });

try {
  if (command === "verify-recovery") {
    console.log(JSON.stringify(await runRecoveryDrill({
      repoRoot,
      workflowRoot,
      runtimeVersion: publisherSourceVersion(workflowRoot),
    }), null, 2));
  } else {
    await store.initialize();
  }
  if (command === "rebuild") {
    const result = await store.rebuildAll();
    console.log(JSON.stringify({ ok: true, result, status: store.getStatus() }, null, 2));
  } else if (command === "backup") {
    const [destination, contentHistory] = await Promise.all([
      store.createBackup(),
      contentBackup.snapshot("Manual safety backup"),
    ]);
    console.log(JSON.stringify({
      ok: true,
      backup: path.relative(repoRoot, destination),
      contentHistory,
      status: store.getStatus(),
    }, null, 2));
  } else if (command === "status") {
    console.log(JSON.stringify({
      ...store.getStatus(),
      contentHistory: await contentBackup.status(),
    }, null, 2));
  } else if (command !== "verify-recovery") {
    throw new Error(`未知命令：${command}`);
  }
} finally {
  store.close();
}
