import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalDataStore } from "./local-data-store.js";

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

export async function readRecoveryDrillStatus(statusPath) {
  try {
    return JSON.parse(await readFile(statusPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: false, neverRun: true };
    return { ok: false, error: `无法读取恢复演练记录：${error.message}` };
  }
}

export async function listSqliteBackups(backupsDir) {
  try {
    const files = (await readdir(backupsDir))
      .filter((file) => /^xgif-.*\.sqlite3$/u.test(file))
      .sort()
      .reverse();
    const items = [];
    for (const file of files) {
      const metadata = await stat(path.join(backupsDir, file));
      items.push({
        file,
        bytes: metadata.size,
        modifiedAt: metadata.mtime.toISOString(),
      });
    }
    return items;
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function runRecoveryDrill({
  repoRoot,
  workflowRoot,
  statusPath = path.join(workflowRoot, ".runtime", "recovery-drill.json"),
}) {
  const probeRoot = await mkdtemp(path.join(os.tmpdir(), "xgif-recovery-check-"));
  const databasePath = path.join(probeRoot, "xgif.sqlite3");
  let probe = new LocalDataStore({
    repoRoot,
    workflowRoot,
    databasePath,
    backupsDir: path.join(probeRoot, "backups"),
  });
  const startedAt = new Date().toISOString();
  let result;
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
    result = {
      ok: true,
      startedAt,
      completedAt: new Date().toISOString(),
      content: after.content,
      trash: after.trash,
      corruptDatabaseWasQuarantined: true,
      note: "演练只使用临时数据库，未修改真实 SQLite 或内容文件。",
    };
  } catch (error) {
    result = {
      ok: false,
      startedAt,
      completedAt: new Date().toISOString(),
      error: error.message,
    };
  } finally {
    probe.close();
    await rm(probeRoot, { recursive: true, force: true });
  }
  await writeJsonAtomic(statusPath, result);
  if (!result.ok) throw Object.assign(new Error(result.error), { result });
  return result;
}
