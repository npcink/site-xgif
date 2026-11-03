import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { galleryImages, validateGalleryImages } from "../../site/src/lib/image-gallery.mjs";
import { buildPublicationBundle } from "../publication-bundle.js";
import { ImageSimilarityIndex } from "../image-similarity.js";
import { reconcileR2Assets } from "../r2-reconciliation.js";
import { listReusableAssets } from "../asset-library.js";
import { sampleImage } from "./fixtures/image-sample.mjs";

test("gallery limits include the cover and reject empty, repeated, and unsafe members", () => {
  const images = Array.from({ length: 12 }, (_, i) => ({ src: `/images/memes/${i}.png` }));
  assert.equal(validateGalleryImages(images).length, 12);
  for (const value of [[], [...images, { src: "/images/memes/13.png" }], [images[0], images[0]], [{ src: "javascript:alert(1)" }], "invalid"]) {
    assert.throws(() => validateGalleryImages(value));
  }
  assert.deepEqual(galleryImages({ images: [null, { src: 1 }, { src: "/images/valid.png" }] }), [{ src: "/images/valid.png" }]);
  assert.deepEqual(galleryImages({ image: "/images/old.png", width: 320 }), [{ src: "/images/old.png", width: 320, height: undefined, altText: undefined }]);
});

test("bundles, similarity, asset library and R2 reconciliation include non-cover images", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "xgif-gallery-"));
  try {
    const directory = path.join(repoRoot, "site/src/content/images");
    const publicDir = path.join(repoRoot, "site/public/images/memes");
    await mkdir(directory, { recursive: true });
    await mkdir(publicDir, { recursive: true });
    const first = await sampleImage();
    const second = await sampleImage(true);
    await writeFile(path.join(publicDir, "one.png"), first);
    await writeFile(path.join(publicDir, "two.png"), second);
    const images = [{ src: "/images/memes/one.png" }, { src: "/images/memes/two.png" }];
    const file = "site/src/content/images/20990101-gall.md";
    await writeFile(path.join(repoRoot, file), `---\ncontentId: "20990101-gall"\ntitle: "图集"\nimage: "${images[0].src}"\nimages: ${JSON.stringify(images)}\n---\n`);
    const bundle = await buildPublicationBundle({ repoRoot, items: [{ file }] });
    assert.equal(bundle.items[0].assets.length, 2);
    const version = bundle.items[0].publicationSha256;
    await writeFile(path.join(publicDir, "two.png"), first);
    assert.notEqual((await buildPublicationBundle({ repoRoot, items: [{ file }] })).items[0].publicationSha256, version);
    await writeFile(path.join(publicDir, "two.png"), second);
    const similarity = await new ImageSimilarityIndex({ repoRoot }).check({ buffer: second });
    assert.ok(similarity.matches.some((match) => match.image === images[1].src && match.kind === "exact"));
    const library = await listReusableAssets({ repoRoot });
    assert.ok(library.items.some((item) => item.image === images[1].src));
    const remote = [{ src: "https://img.xgif.cn/memes/one.png" }, { src: "https://img.xgif.cn/memes/two.png" }];
    await writeFile(path.join(repoRoot, file), (await readFile(path.join(repoRoot, file), "utf8")).replace(JSON.stringify(images), JSON.stringify(remote)).replace('image: "/images/memes/one.png"', `image: "${remote[0].src}"`));
    await mkdir(path.join(repoRoot, "workflow/records"), { recursive: true });
    await writeFile(path.join(repoRoot, "workflow/records/r2-assets.jsonl"), remote.map((image) => JSON.stringify({ publicUrl: image.src })).join("\n"));
    const report = await reconcileR2Assets({ repoRoot });
    assert.equal(report.counts.references, 2);
    assert.equal(report.ledgerWithoutReference.length, 0);
  } finally { await rm(repoRoot, { recursive: true, force: true }); }
});
