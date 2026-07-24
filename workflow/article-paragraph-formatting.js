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
