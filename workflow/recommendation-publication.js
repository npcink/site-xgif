import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { galleryImages } from "../site/src/lib/image-gallery.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
export const publicationEvidenceHash = (documents) => hash(JSON.stringify(documents.map((doc) => doc.publicationEvidence)));

/** Offline identity: local bytes or our content-addressed R2 object names. No URL fetches. */
export async function publicationImageEvidence(repoRoot, data) {
  const result = [];
  for (const { src } of galleryImages(data)) {
    let sha256 = null;
    if (src.startsWith("/") && !src.startsWith("//")) {
      const root = await realpath(path.join(repoRoot, "site/public"));
      const file = await realpath(path.resolve(root, `.${decodeURIComponent(src)}`));
      if (!file.startsWith(root + path.sep)) throw new Error("Recommendation image escapes public assets");
      sha256 = hash(await readFile(file));
    } else {
      sha256 = src.match(/^https:\/\/img\.xgif\.cn\/memes\/([a-f0-9]{64})\.(?:jpg|jpeg|png|webp|gif)$/u)?.[1] || null;
    }
    result.push({ src, sha256 });
  }
  return result;
}
