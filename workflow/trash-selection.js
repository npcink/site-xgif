export function resolveAuthoritativeTrashSelection(
  requestedItems,
  indexedItems,
  { maxItems = 500 } = {},
) {
  if (!Array.isArray(requestedItems) || requestedItems.length === 0 || requestedItems.length > maxItems) {
    const error = new Error("没有可以处理的回收站内容。");
    error.statusCode = 400;
    throw error;
  }

  const indexedById = new Map(
    (indexedItems || []).map((item) => [String(item?.id || ""), item]),
  );
  const seen = new Set();
  return requestedItems.map((item) => {
    const id = String(item?.id || "").trim();
    if (!id || seen.has(id)) {
      const error = new Error(id ? `回收站选择中存在重复记录：${id}` : "回收站记录缺少有效 ID。");
      error.statusCode = 400;
      throw error;
    }
    seen.add(id);
    const authoritative = indexedById.get(id);
    if (!authoritative) {
      const error = new Error(`回收站记录已经变化，请刷新后重试：${id}`);
      error.statusCode = 409;
      throw error;
    }
    return authoritative;
  });
}
