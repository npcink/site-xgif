export function preservePublicationHold(current, markdown) {
  if (current.publicationHold !== true) return markdown;
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/u);
  if (!frontmatter) throw new Error("历史版本缺少完整元数据，无法保留发布限制。");
  const newline = frontmatter[0].includes("\r\n") ? "\r\n" : "\n";
  const fields = frontmatter[1].split(/\r?\n/u).filter((line) => !/^(?:draft|publicationHold):/u.test(line));
  return `---${newline}${fields.join(newline)}${newline}publicationHold: true${newline}draft: true${newline}---${markdown.slice(frontmatter[0].length)}`;
}
