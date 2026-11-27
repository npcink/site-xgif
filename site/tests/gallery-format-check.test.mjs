import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkImageGalleryFormats } from "../src/lib/gallery-format-check.mjs";

test("gallery authoring accepts ordered single-line JSON and ignores examples in the body", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "xgif-gallery-format-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "gallery.md"), '---\r\nimages: [{"src":"/first.webp"},{"src":"/second.webp"}]\r\n---\r\n');
  await writeFile(join(directory, "single.md"), "---\nimage: /single.webp\n---\n\n```yaml\nimages:\n  - src: /example.webp\n```\n");
  await checkImageGalleryFormats(directory);
});

test("gallery build check rejects YAML galleries even when Astro parses them as arrays", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "xgif-gallery-format-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "nested"));
  const file = join(directory, "nested", "gallery.mdx");
  for (const header of [
    "images:\n  - src: /first.webp",
    'images: [{src: "/first.webp"}]',
    '"images": [{"src":"/first.webp"}]',
    '{images: [{src: "/first.webp"}]}',
  ]) {
    await writeFile(file, `---\n${header}\n---\n`);
    await assert.rejects(checkImageGalleryFormats(directory), /gallery\.mdx.*单行 JSON/u);
  }
});
