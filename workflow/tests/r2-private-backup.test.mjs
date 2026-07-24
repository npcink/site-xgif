import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  backupR2LedgerAssets,
  inspectR2PrivateBackup,
  saveR2PrivateBackup,
} from "../r2-private-backup.js";

test("R2 source bytes are stored by hash and can be verified", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xgif-r2-private-"));
  const buffer = Buffer.from("private-r2-source");
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const objectKey = `memes/${sha256}.webp`;
  const saved = await saveR2PrivateBackup({
    asset: { buffer, sha256 },
    objectKey,
    directory,
  });
  assert.equal(saved.created, true);
  assert.deepEqual(await readFile(saved.filePath), buffer);
  assert.equal((await inspectR2PrivateBackup({
    row: { sha256, objectKey },
    directory,
  })).ok, true);
});

test("R2 backup refuses downloaded bytes that do not match the ledger hash", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xgif-r2-private-"));
  const sha256 = "a".repeat(64);
  await assert.rejects(
    backupR2LedgerAssets({
      rows: [{
        sha256,
        objectKey: `memes/${sha256}.webp`,
        publicUrl: `https://img.xgif.cn/memes/${sha256}.webp`,
      }],
      directory,
      fetchImpl: async () => ({
        ok: true,
        arrayBuffer: async () => Buffer.from("wrong"),
      }),
    }),
    /哈希不一致/,
  );
});
