import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFrontmatter } from "astro/markdown";
import { readGalleryFrontmatter } from "./gallery-frontmatter.mjs";

export async function checkImageGalleryFormats(directory) {
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.mdx?$/u.test(entry.name)) continue;
    const file = join(entry.parentPath, entry.name);
    const markdown = await readFile(file, "utf8");
    try {
      const { frontmatter } = parseFrontmatter(markdown);
      readGalleryFrontmatter(markdown, { expected: Object.hasOwn(frontmatter, "images") });
    } catch (error) {
      throw new Error(`图片内容 ${relative(directory, file)}：${error.message}`, { cause: error });
    }
  }
}

export default function galleryFormatCheck() {
  return {
    name: "xgif-gallery-format-check",
    hooks: {
      "astro:build:start": async () => {
        await checkImageGalleryFormats(fileURLToPath(new URL("../content/images/", import.meta.url)));
      },
    },
  };
}
