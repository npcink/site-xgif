import { randomInt } from "node:crypto";

export const CONTENT_ID_PATTERN = /^\d{8}-[a-z0-9]{4}$/u;
const CONTENT_ID_SPACE = 36 ** 4;

export function contentIdDatePrefix(pubDate) {
  const value = String(pubDate || "").trim();
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) throw new Error("内容 ID 需要有效的 YYYY-MM-DD 发布日期。");

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("内容 ID 需要有效的 YYYY-MM-DD 发布日期。");
  }
  return `${match[1]}${match[2]}${match[3]}`;
}

export function isContentId(value) {
  return CONTENT_ID_PATTERN.test(String(value || ""));
}

export function createContentId(pubDate, existingIds = new Set(), randomIndex = () => randomInt(CONTENT_ID_SPACE)) {
  const prefix = contentIdDatePrefix(pubDate);
  const occupied = existingIds instanceof Set ? existingIds : new Set(existingIds);

  for (let attempt = 0; attempt < 128; attempt += 1) {
    const suffix = Number(randomIndex()).toString(36).padStart(4, "0").slice(-4);
    const contentId = `${prefix}-${suffix}`;
    if (!occupied.has(contentId)) return contentId;
  }
  throw new Error("无法生成唯一内容 ID，请重试。");
}
