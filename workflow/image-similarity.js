import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { parseContentDocument } from "./content-audit.js";
import { inspectR2PrivateBackup } from "./r2-private-backup.js";

const VERSION = 1;
const MAX_BYTES = 8 * 1024 * 1024;
const COSINES = Array.from({ length: 8 }, (_, frequency) =>
  Array.from({ length: 32 }, (_, position) => Math.cos((2 * position + 1) * frequency * Math.PI / 64)));
const hashBits = (bits) => bits.reduce((hash, bit) => (hash << 1n) | BigInt(bit), 0n).toString(16).padStart(16, "0");
const digest = (buffer) => createHash("sha256").update(buffer).digest("hex");

export async function perceptualFingerprint(buffer) {
  if (!buffer.length || buffer.length > MAX_BYTES) throw new Error("图片字节超过相似图检查范围。");
  // Compare the first displayed frame only; never flatten a whole animation.
  const image = sharp(buffer, { pages: 1, limitInputPixels: 36_000_000 }).rotate().flatten({ background: "#fff" }).greyscale();
  const metadata = await sharp(buffer).metadata();
  const pixels = await image.clone().resize(32, 32, { fit: "fill" }).raw().toBuffer();
  const differences = await image.clone().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  const coefficients = [];
  for (let v = 0; v < 8; v += 1) {
    for (let u = 0; u < 8; u += 1) {
      if (!u && !v) continue;
      let value = 0;
      for (let y = 0; y < 32; y += 1) {
        for (let x = 0; x < 32; x += 1) value += pixels[y * 32 + x] * COSINES[u][x] * COSINES[v][y];
      }
      coefficients.push(value);
    }
  }
  const median = [...coefficients].sort((a, b) => a - b)[31];
  const mean = pixels.reduce((sum, value) => sum + value, 0) / pixels.length;
  const variance = pixels.reduce((sum, value) => sum + (value - mean) ** 2, 0) / pixels.length;
  return {
    phash: hashBits(coefficients.map((value) => value > median)),
    dhash: hashBits(Array.from({ length: 64 }, (_, index) => {
      const position = Math.floor(index / 8) * 9 + index % 8;
      return differences[position] > differences[position + 1];
    })),
    ratio: metadata.autoOrient.width / metadata.autoOrient.height,
    variance,
    animated: Number(metadata.pages || 1) > 1,
  };
}

function distance(left, right) {
  let bits = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;
  while (bits) { bits &= bits - 1n; count += 1; }
  return count;
}

export function compareImageFingerprints(left, right) {
  const phash = distance(left.phash, right.phash);
  const dhash = distance(left.dhash, right.dhash);
  // Flat images and very different crops produce misleadingly close hashes.
  const similar = left.variance >= 25 && right.variance >= 25
    && Math.abs(Math.log(left.ratio / right.ratio)) <= 0.08 && phash <= 8 && dhash <= 12;
  return { similar, distance: phash + dhash };
}

function validFingerprint(value) {
  return value && /^[a-f0-9]{16}$/u.test(value.phash) && /^[a-f0-9]{16}$/u.test(value.dhash)
    && Number.isFinite(value.ratio) && value.ratio > 0
    && Number.isFinite(value.variance) && value.variance >= 0 && typeof value.animated === "boolean";
}

export class ImageSimilarityIndex {
  constructor({ repoRoot, cachePath = path.join(repoRoot, "workflow/.runtime/image-fingerprints-v1.json") }) {
    this.repoRoot = repoRoot;
    this.cachePath = cachePath;
    this.fingerprints = new Map();
    this.loaded = null;
    this.pendingWrite = Promise.resolve();
  }

  async load() {
    this.loaded ||= (async () => {
      try {
        const cache = JSON.parse(await readFile(this.cachePath, "utf8"));
        if (cache.version !== VERSION) return;
        for (const [hash, fingerprint] of Object.entries(cache.fingerprints || {})) {
          if (/^[a-f0-9]{64}$/u.test(hash) && validFingerprint(fingerprint)) this.fingerprints.set(hash, fingerprint);
        }
      } catch { /* Derived cache is disposable; source bytes remain authoritative. */ }
    })();
    await this.loaded;
  }

  async persist() {
    const save = async () => {
      await mkdir(path.dirname(this.cachePath), { recursive: true });
      const temporary = `${this.cachePath}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify({ version: VERSION, fingerprints: Object.fromEntries(this.fingerprints) }));
      await rename(temporary, this.cachePath);
    };
    this.pendingWrite = this.pendingWrite.catch(() => {}).then(save);
    await this.pendingWrite;
  }

  async sourceFingerprint(image, ledger) {
    let buffer;
    let hash;
    if (image.startsWith("/") && !image.startsWith("//")) {
      const root = await realpath(path.join(this.repoRoot, "site/public"));
      const file = await realpath(path.resolve(root, `.${image}`));
      if (!file.startsWith(`${root}${path.sep}`)) throw new Error("图片路径不在公开资源目录。");
      buffer = await readFile(file);
      hash = digest(buffer);
    } else {
      const row = ledger.find((item) => item.publicUrl === image);
      if (!row || !/^[a-f0-9]{64}$/u.test(row.sha256)) throw new Error("缺少可核验的图片字节。");
      hash = row.sha256;
      if (!this.fingerprints.has(hash)) {
        const backup = await inspectR2PrivateBackup({ row, directory: path.join(this.repoRoot, "workflow/private-sources/r2-assets") });
        if (!backup.ok) throw new Error("图片字节尚未备份。");
        buffer = await readFile(backup.filePath);
      }
    }
    if (!this.fingerprints.has(hash)) this.fingerprints.set(hash, await perceptualFingerprint(buffer));
    return { hash, fingerprint: this.fingerprints.get(hash) };
  }

  async check({ buffer, excludeFile = "" }) {
    await this.load();
    const query = await perceptualFingerprint(buffer);
    const queryHash = digest(buffer);
    const directory = path.join(this.repoRoot, "site/src/content/images");
    const [files, ledgerText] = await Promise.all([
      readdir(directory).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error)),
      readFile(path.join(this.repoRoot, "workflow/records/r2-assets.jsonl"), "utf8")
        .catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error)),
    ]);
    const ledger = ledgerText.split(/\r?\n/u).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
    const matches = [];
    const images = new Set();
    let checked = 0;
    let unavailable = 0;
    for (const file of files.filter((name) => /\.md$/iu.test(name)).sort()) {
      const relative = `site/src/content/images/${file}`;
      if (relative === excludeFile) continue;
      const { data } = parseContentDocument(await readFile(path.join(directory, file), "utf8"));
      const image = String(data.image || "");
      if (!image || images.has(image)) continue;
      images.add(image);
      try {
        const candidate = await this.sourceFingerprint(image, ledger);
        checked += 1;
        const comparison = compareImageFingerprints(query, candidate.fingerprint);
        if (queryHash === candidate.hash || comparison.similar) matches.push({
          file: relative,
          title: String(data.title || "未命名图片"),
          image,
          kind: queryHash === candidate.hash ? "exact" : "similar",
          animated: query.animated || candidate.fingerprint.animated,
          distance: comparison.distance,
        });
      } catch { unavailable += 1; }
    }
    let cacheSaved = true;
    try { await this.persist(); } catch { cacheSaved = false; }
    return {
      checked, unavailable, cacheSaved,
      matches: matches.sort((a, b) => (a.kind === "exact" ? -1 : a.distance) - (b.kind === "exact" ? -1 : b.distance))
        .slice(0, 4).map(({ file, title, image, kind, animated }) => ({ file, title, image, kind, animated })),
    };
  }
}
