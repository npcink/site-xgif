export function isPublicArticle({ data }) {
  return !data.draft && !data.publicationHold;
}

/** @param {{ editorNote?: string }} data */
export function publicArticleNote({ editorNote }) {
  return editorNote?.trim() || "";
}
