const internalNotePatterns = [
  /flomo\s*私人(?:笔记|收藏)?导入/iu,
  /请在公开前复核/iu,
  /来源待确认/iu,
  /内部导入/iu,
];

export function classifyLegacyArticleNote(note) {
  const value = String(note || "").trim();
  if (!value) return { field: "", value: "" };
  return {
    field: internalNotePatterns.some((pattern) => pattern.test(value)) ? "internalNote" : "editorNote",
    value,
  };
}

export function migrateArticleNote(markdown) {
  const input = String(markdown || "");
  const match = input.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u);
  if (!match) return { changed: false, markdown: input, field: "", value: "" };
  const noteLine = match[1].match(/^note:\s*(.+)$/mu);
  if (!noteLine) return { changed: false, markdown: input, field: "", value: "" };
  let value = noteLine[1].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    try {
      value = JSON.parse(value);
    } catch {
      value = value.slice(1, -1);
    }
  }
  const classified = classifyLegacyArticleNote(value);
  const replacement = classified.field ? `${classified.field}: ${JSON.stringify(classified.value)}` : "";
  const frontmatter = match[1].replace(/^note:\s*.+(?:\r?\n)?/mu, replacement ? `${replacement}\n` : "");
  return {
    changed: frontmatter !== match[1],
    field: classified.field,
    value: classified.value,
    markdown: `---\n${frontmatter.trimEnd()}\n---\n\n${match[2].trim()}\n`,
  };
}
