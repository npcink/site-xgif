function normalizeLineEndings(value) {
  return String(value || "").replace(/\r\n?/gu, "\n").trim();
}

function containsOnlyInsertedLineBreaks(originalBody, candidateBody) {
  const original = normalizeLineEndings(originalBody);
  const candidate = normalizeLineEndings(candidateBody);
  const originalCharacters = [...original];
  let originalIndex = 0;

  for (const character of candidate) {
    if (character === originalCharacters[originalIndex]) {
      originalIndex += 1;
      continue;
    }
    if (character !== "\n") return false;
  }

  return originalIndex === originalCharacters.length;
}

function paragraphCount(body) {
  return normalizeLineEndings(body)
    .split(/\n[ \t]*\n/gu)
    .filter((paragraph) => paragraph.trim())
    .length;
}

function nonWhitespaceLength(value) {
  return [...String(value || "").replace(/\s/gu, "")].length;
}

function isProseParagraph(value) {
  const paragraph = String(value || "").trimStart();
  return paragraph
    && !/^(?:```|~~~|#{1,6}\s|>\s|<[\w!/]|(?:\|.*\|))/.test(paragraph);
}

function splitProseParagraph(paragraph, maxCharacters) {
  const chunks = [];
  let remaining = paragraph;
  while (nonWhitespaceLength(remaining) > maxCharacters) {
    const characters = [...remaining];
    let length = 0;
    let lastStrongBreak = -1;
    let lastSoftBreak = -1;
    let lastWhitespaceBreak = -1;
    for (let index = 0; index < characters.length; index += 1) {
      const character = characters[index];
      if (!/\s/u.test(character)) length += 1;
      if (length > maxCharacters) break;
      if (/\s/u.test(character)) lastWhitespaceBreak = index + 1;
      if (/[。！？!?…]/u.test(character)) lastStrongBreak = index + 1;
      if (/[；，：]/u.test(character)) lastSoftBreak = index + 1;
      if (
        /[”’」』）】]/u.test(character)
        && lastStrongBreak === index
      ) {
        lastStrongBreak = index + 1;
      }
    }
    const breakAt = lastStrongBreak > 0
      ? lastStrongBreak
      : lastSoftBreak > 0
        ? lastSoftBreak
        : lastWhitespaceBreak;
    if (breakAt < 1) return { paragraph, changed: false, unsplittable: true };
    chunks.push(characters.slice(0, breakAt).join(""));
    remaining = characters.slice(breakAt).join("");
  }

  if (!chunks.length) return { paragraph, changed: false, unsplittable: false };
  chunks.push(remaining);
  return { paragraph: chunks.join("\n\n"), changed: true, unsplittable: false };
}

function overlongParagraphs(body, maxCharacters) {
  return normalizeLineEndings(body)
    .split(/\n[ \t]*\n/gu)
    .filter((paragraph) => paragraph.trim())
    .filter((paragraph) => nonWhitespaceLength(paragraph) > maxCharacters);
}

export function organizeMarkdownParagraphs(originalBody, { maxCharacters = 180 } = {}) {
  const original = normalizeLineEndings(originalBody);
  const parts = original.split(/(\n[ \t]*\n)/gu);
  let changedParagraphs = 0;
  let unsplittableParagraphs = 0;
  const candidate = parts.map((part, index) => {
    if (index % 2 === 1 || !isProseParagraph(part)) return part;
    if (nonWhitespaceLength(part) <= maxCharacters) return part;
    const result = splitProseParagraph(part, maxCharacters);
    if (result.changed) changedParagraphs += 1;
    if (result.unsplittable) unsplittableParagraphs += 1;
    return result.paragraph;
  }).join("");
  const safe = safeParagraphSuggestion(original, candidate);
  const longBefore = overlongParagraphs(original, maxCharacters).length;
  const longAfter = overlongParagraphs(safe.body, maxCharacters).length;

  return {
    ...safe,
    changedParagraphs,
    unsplittableParagraphs,
    longBefore,
    longAfter,
  };
}

export function safeParagraphSuggestion(originalBody, candidateBody, { maxCharacters = Infinity } = {}) {
  const original = normalizeLineEndings(originalBody);
  if ([...original].length > maxCharacters) {
    return { body: original, paragraphFormatting: "too_long" };
  }

  if (typeof candidateBody !== "string") {
    return { body: original, paragraphFormatting: "unchanged" };
  }

  const candidate = normalizeLineEndings(candidateBody);
  if (candidate === original) {
    return { body: original, paragraphFormatting: "unchanged" };
  }

  if (!containsOnlyInsertedLineBreaks(original, candidate)) {
    return { body: original, paragraphFormatting: "rejected" };
  }

  if (paragraphCount(candidate) <= paragraphCount(original)) {
    return { body: original, paragraphFormatting: "rejected" };
  }

  return { body: candidate, paragraphFormatting: "applied" };
}
