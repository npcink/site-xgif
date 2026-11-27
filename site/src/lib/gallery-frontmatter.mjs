const formatError = "图集 images 必须是单行 JSON 数组，每项都要有非空的 src。";

// Astro's parsed array cannot tell JSON and multiline YAML apart. Check the source
// form here so the publisher and the static build apply the same authoring rule.
export function readGalleryFrontmatter(markdown, { expected = false } = {}) {
  const header = markdown.match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u)?.[1] ?? "";
  const fields = header.split(/\r?\n/u).filter(line => /^(?:images|"images"|'images')[ \t]*:/u.test(line));
  if (!fields.length && !expected) return undefined;
  if (fields.length !== 1 || !fields[0].startsWith("images:")) throw new Error(formatError);

  let images;
  try { images = JSON.parse(fields[0].slice("images:".length)); }
  catch { throw new Error(formatError); }
  if (!Array.isArray(images) || !images.length
    || images.some(image => typeof image?.src !== "string" || !image.src.trim())) {
    throw new Error(formatError);
  }
  return images;
}
