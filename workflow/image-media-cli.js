import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseContentDocument } from "./content-audit.js";
import { verifiedImageBytes } from "./recommendation-images.js";
import { withToolLock } from "./tool-lock.js";

const hash = text => createHash("sha256").update(text).digest("hex");

export async function planImageMedia(repoRoot) {
  const directory = path.join(repoRoot, "site/src/content/images");
  const changes = [];
  let checkedMembers = 0, animatedMembers = 0;
  for (const name of (await readdir(directory)).filter(name => name.endsWith(".md")).sort()) {
    const file = `site/src/content/images/${name}`;
    const original = await readFile(path.join(repoRoot, file), "utf8");
    const { data } = parseContentDocument(original);
    if (data.draft || data.public === false) continue;
    const verified = await verifiedImageBytes(repoRoot, data);
    const flags = verified.map(image => (image.metadata.pages || 1) > 1);
    checkedMembers += flags.length; animatedMembers += flags.filter(Boolean).length;
    const boundary = original.indexOf("\n---", 4);
    if (boundary < 0) throw new Error(`Missing frontmatter: ${file}`);
    let header = original.slice(0, boundary);
    if (data.images) {
      const match = header.match(/^images:\s*(\[[^\n]*\])\s*$/mu);
      if (!match) throw new Error(`Gallery metadata must use the existing JSON array format: ${file}`);
      const members = JSON.parse(match[1]);
      if (members.length !== flags.length || members.some((member, i) => member.src !== verified[i].src)) throw new Error(`Gallery order mismatch: ${file}`);
      header = header.replace(match[0], `images: ${JSON.stringify(members.map((member, i) => ({ ...member, animated: flags[i] })))}`);
    } else if (/^animated:/mu.test(header)) header = header.replace(/^animated:.*$/mu, `animated: ${flags[0]}`);
    else header = header.replace(/^(image:.*)$/mu, `$1\nanimated: ${flags[0]}`);
    const content = header + original.slice(boundary);
    if (content !== original) changes.push({ file, expectedSha256: hash(original), content });
  }
  return { checkedMembers, animatedMembers, changes };
}

export async function updateImageMedia({ repoRoot, apply = false }) {
  return withToolLock(path.join(repoRoot, "workflow"), async () => {
    const plan = await planImageMedia(repoRoot);
    for (const item of plan.changes) {
      if (hash(await readFile(path.join(repoRoot, item.file), "utf8")) !== item.expectedSha256) throw new Error(`Content changed: ${item.file}`);
    }
    if (apply) for (const item of plan.changes) await writeFile(path.join(repoRoot, item.file), item.content);
    return { mode: apply ? "applied" : "dry-run", checkedMembers: plan.checkedMembers,
      animatedMembers: plan.animatedMembers, changedFiles: plan.changes.map(item => item.file) };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some(arg => arg !== "--apply")) throw new Error("image:media [--apply]");
    console.log(JSON.stringify(await updateImageMedia({ repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), apply: process.argv.includes("--apply") }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
