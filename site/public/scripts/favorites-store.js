export const FAVORITES_FORMAT = "xgif-favorites";
export const FAVORITES_VERSION = 1;
export const FAVORITES_KEY = "xgif:favorites:v1";
export const FAVORITES_IMPORT_MAX_BYTES = 1024 * 1024;

const CONTENT_ID_PATTERN = /^\d{8}-[a-z0-9]{4}$/;
const VALID_KINDS = new Set(["article", "image"]);

export class FavoritesImportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FavoritesImportError";
    this.code = code;
  }
}

const isoNow = (now) => new Date(now).toISOString();
export const favoriteKey = (item) => `${item.kind}:${item.contentId}`;
export const favoriteHref = (_kind, contentId) => `/${contentId}`;

export function createFavoritesDocument(now = Date.now()) {
  return {
    format: FAVORITES_FORMAT,
    version: FAVORITES_VERSION,
    updatedAt: isoNow(now),
    items: [],
  };
}

function normalizeItem(value) {
  if (!value || typeof value !== "object") return null;

  const contentId = typeof value.contentId === "string" ? value.contentId.trim() : "";
  const kind = typeof value.kind === "string" ? value.kind.trim() : "";
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const parsedSavedAt = typeof value.savedAt === "string" ? Date.parse(value.savedAt) : Number.NaN;

  if (
    !CONTENT_ID_PATTERN.test(contentId) ||
    !VALID_KINDS.has(kind) ||
    !title ||
    title.length > 240 ||
    !Number.isFinite(parsedSavedAt)
  ) {
    return null;
  }

  return {
    contentId,
    kind,
    savedAt: new Date(parsedSavedAt).toISOString(),
    title,
    href: favoriteHref(kind, contentId),
  };
}

function normalizeItems(items) {
  const byKey = new Map();

  for (const value of Array.isArray(items) ? items : []) {
    const item = normalizeItem(value);
    if (!item) continue;

    const key = favoriteKey(item);
    const current = byKey.get(key);
    if (!current || Date.parse(item.savedAt) < Date.parse(current.savedAt)) {
      byKey.set(key, item);
    }
  }

  return [...byKey.values()].sort(
    (a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt) || favoriteKey(a).localeCompare(favoriteKey(b)),
  );
}

function normalizeDocument(value, now = Date.now()) {
  if (
    !value ||
    typeof value !== "object" ||
    value.format !== FAVORITES_FORMAT ||
    value.version !== FAVORITES_VERSION ||
    !Array.isArray(value.items)
  ) {
    return null;
  }

  return {
    format: FAVORITES_FORMAT,
    version: FAVORITES_VERSION,
    updatedAt: Number.isFinite(Date.parse(value.updatedAt))
      ? new Date(value.updatedAt).toISOString()
      : isoNow(now),
    items: normalizeItems(value.items),
  };
}

export function readFavorites(storage = globalThis.localStorage, now = Date.now()) {
  try {
    const raw = storage.getItem(FAVORITES_KEY);
    if (!raw) return { favorites: createFavoritesDocument(now), error: null };

    const favorites = normalizeDocument(JSON.parse(raw), now);
    if (!favorites) {
      return {
        favorites: createFavoritesDocument(now),
        error: "本地收藏数据格式异常，暂未覆盖原数据。",
      };
    }
    return { favorites, error: null };
  } catch {
    return {
      favorites: createFavoritesDocument(now),
      error: "浏览器未允许读取本地收藏。",
    };
  }
}

export function writeFavorites(favorites, storage = globalThis.localStorage, now = Date.now()) {
  const normalized = normalizeDocument(favorites, now);
  if (!normalized) return { ok: false, error: "收藏数据格式无效。" };

  normalized.updatedAt = isoNow(now);
  try {
    storage.setItem(FAVORITES_KEY, JSON.stringify(normalized));
    return { ok: true, favorites: normalized, error: null };
  } catch {
    return { ok: false, error: "浏览器未允许保存本地收藏。" };
  }
}

export function toggleFavorite(favorites, input, now = Date.now()) {
  const current = normalizeDocument(favorites, now) ?? createFavoritesDocument(now);
  const key = favoriteKey(input);
  const existing = current.items.some((item) => favoriteKey(item) === key);

  if (existing) {
    return {
      ...current,
      updatedAt: isoNow(now),
      items: current.items.filter((item) => favoriteKey(item) !== key),
    };
  }

  const item = normalizeItem({ ...input, savedAt: isoNow(now) });
  if (!item) return current;
  return {
    ...current,
    updatedAt: isoNow(now),
    items: normalizeItems([item, ...current.items]),
  };
}

export function serializeFavorites(favorites, now = Date.now()) {
  const normalized = normalizeDocument(favorites, now) ?? createFavoritesDocument(now);
  return `${JSON.stringify({ ...normalized, updatedAt: isoNow(now) }, null, 2)}\n`;
}

export function importFavoritesText(
  text,
  currentFavorites,
  { mode = "merge", knownKeys = null, now = Date.now() } = {},
) {
  if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > FAVORITES_IMPORT_MAX_BYTES) {
    throw new FavoritesImportError("FILE_TOO_LARGE", "导入文件不能超过 1 MB。");
  }
  if (!["merge", "replace"].includes(mode)) {
    throw new FavoritesImportError("INVALID_MODE", "不支持的导入方式。");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new FavoritesImportError("INVALID_JSON", "文件不是有效的 JSON。");
  }

  if (!parsed || typeof parsed !== "object" || parsed.format !== FAVORITES_FORMAT) {
    throw new FavoritesImportError("INVALID_FORMAT", "这不是 XGIF 收藏文件。");
  }
  if (parsed.version !== FAVORITES_VERSION) {
    throw new FavoritesImportError(
      "UNSUPPORTED_VERSION",
      `暂不支持收藏文件版本 ${String(parsed.version)}。`,
    );
  }
  if (!Array.isArray(parsed.items)) {
    throw new FavoritesImportError("INVALID_ITEMS", "收藏文件缺少 items 列表。");
  }

  const validItems = parsed.items.map(normalizeItem).filter(Boolean);
  const invalid = parsed.items.length - validItems.length;
  const current = normalizeDocument(currentFavorites, now) ?? createFavoritesDocument(now);
  const before = new Set(current.items.map(favoriteKey));
  const incoming = normalizeItems(validItems);
  const duplicates = incoming.filter((item) => before.has(favoriteKey(item))).length;
  const items = mode === "replace" ? incoming : normalizeItems([...current.items, ...incoming]);
  const unavailable = knownKeys instanceof Set
    ? items.filter((item) => !knownKeys.has(favoriteKey(item))).length
    : 0;

  return {
    favorites: {
      format: FAVORITES_FORMAT,
      version: FAVORITES_VERSION,
      updatedAt: isoNow(now),
      items,
    },
    stats: {
      added: mode === "replace" ? incoming.length : items.length - current.items.length,
      duplicates,
      invalid,
      unavailable,
      total: items.length,
    },
  };
}
