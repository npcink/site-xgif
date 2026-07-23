import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isContentId } from "./content-id.js";

export const PUBLIC_ARTICLE_DISCLOSURE = [
  "> 本页只提供编辑摘要，不转载来源站全文。",
  "",
  "请通过页面中的“查看原始来源”链接阅读完整内容。",
].join("\n");

export function isExternalArticle(payload) {
  return ["publication", "editorial"].includes(String(payload?.sourceKind || ""));
}

export function isPublicArticleDisclosure(body) {
  return String(body || "").trim() === PUBLIC_ARTICLE_DISCLOSURE;
}

export function privateArticleSourcePath({ workflowRoot, contentId }) {
  if (!isContentId(contentId)) throw new Error("私有文章来源需要有效的内容 ID。");
  return path.join(workflowRoot, "private-sources", "articles", `${contentId}.md`);
}

async function readPrivateBody(filePath) {
  try {
    return (await readFile(filePath, "utf8")).trim();
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

async function writePrivateBody(filePath, body) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${String(body || "").trim()}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

export async function prepareArticlePublication(payload, { workflowRoot }) {
  const article = { ...payload, body: String(payload?.body || "").trim() };
  if (!isExternalArticle(article)) return { payload: article, privateSourcePath: "" };

  const privateSourcePath = privateArticleSourcePath({
    workflowRoot,
    contentId: article.contentId,
  });
  const privateBody = await readPrivateBody(privateSourcePath);
  const editableBody = isPublicArticleDisclosure(article.body)
    ? privateBody
    : article.body;

  if (editableBody) await writePrivateBody(privateSourcePath, editableBody);

  return {
    payload: {
      ...article,
      body: article.draft
        ? (editableBody || article.body)
        : PUBLIC_ARTICLE_DISCLOSURE,
    },
    privateSourcePath,
  };
}

export async function readEditableArticleBody(payload, { workflowRoot }) {
  if (!isExternalArticle(payload)) return String(payload?.body || "").trim();
  const privateSourcePath = privateArticleSourcePath({
    workflowRoot,
    contentId: payload.contentId,
  });
  return (await readPrivateBody(privateSourcePath)) || String(payload?.body || "").trim();
}
