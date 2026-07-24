function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderInline(value) {
  return escapeHtml(value)
    .replace(/\*\*([^*\n]+)\*\*/gu, "<strong>$1</strong>")
    .replace(/`([^`\n]+)`/gu, "<code>$1</code>");
}

function renderList(block, pattern, tagName) {
  const items = block.split("\n").map((line) => line.match(pattern)?.[1]);
  if (items.some((item) => item === undefined)) return "";
  return `<${tagName}>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tagName}>`;
}

export function renderMarkdownPreview(value) {
  const blocks = String(value || "").trim().split(/\n[ \t]*\n/gu).filter(Boolean);
  if (!blocks.length) return '<p class="empty-copy">正文内容会在这里显示。</p>';

  return blocks.map((rawBlock) => {
    const block = rawBlock.trim();
    const unorderedList = renderList(block, /^\s*[-*+]\s+(.+)$/u, "ul");
    if (unorderedList) return unorderedList;
    const orderedList = renderList(block, /^\s*\d+[.)]\s+(.+)$/u, "ol");
    if (orderedList) return orderedList;

    const heading = block.match(/^(#{1,3})\s+(.+)$/su);
    if (heading && !heading[2].includes("\n")) {
      const level = Math.min(heading[1].length + 1, 3);
      return `<h${level}>${renderInline(heading[2])}</h${level}>`;
    }

    const lines = block.split("\n");
    if (lines.every((line) => /^\s*>\s?/u.test(line))) {
      return `<blockquote>${lines.map((line) => renderInline(line.replace(/^\s*>\s?/u, ""))).join("<br />")}</blockquote>`;
    }

    return `<p>${lines.map(renderInline).join("<br />")}</p>`;
  }).join("");
}
