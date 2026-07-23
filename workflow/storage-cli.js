import path from "node:path";
import os from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { LocalDataStore } from "./local-data-store.js";
import { LocalContentBackup } from "./local-content-backup.js";

const workflowRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(workflowRoot, "..");
const command = process.argv[2] || "status";
const store = new LocalDataStore({ repoRoot, workflowRoot });
const contentBackup = new LocalContentBackup({ repoRoot, workflowRoot });

try {
  if (command === "verify-recovery") {
    const probeRoot = await mkdtemp(path.join(os.tmpdir(), "xgif-recovery-check-"));
    const databasePath = path.join(probeRoot, "xgif.sqlite3");
    let probe = new LocalDataStore({
      repoRoot,
      workflowRoot,
      databasePath,
      backupsDir: path.join(probeRoot, "backups"),
    });
    try {
      const before = await probe.initialize();
      probe.close();
      await writeFile(databasePath, "simulated database corruption", "utf8");
      probe = new LocalDataStore({
        repoRoot,
        workflowRoot,
        databasePath,
        backupsDir: path.join(probeRoot, "backups"),
      });
      const after = await probe.initialize();
      if (before.content !== after.content || before.trash !== after.trash || !after.recovery?.recovered) {
        throw new Error("恢复演练前后数量不一致。");
      }
      console.log(JSON.stringify({
        ok: true,
        content: after.content,
        trash: after.trash,
        corruptDatabaseWasQuarantined: true,
      }, null, 2));
    } finally {
      probe.close();
      await rm(probeRoot, { recursive: true, force: true });
    }
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
