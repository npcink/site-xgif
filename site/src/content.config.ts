import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const httpUrl = z.url().refine((value) => /^https?:\/\//.test(value), {
  message: "必须使用 http 或 https 地址",
});

const sourceKind = z.enum(["original", "publication", "editorial", "unknown"]);
const imageSourceKind = z.enum(["original", "user_provided", "unknown"]);
const contentId = z.string().regex(/^\d{8}-[a-z0-9]{4}$/, {
  message: "内容 ID 必须使用 YYYYMMDD-4位小写字母数字",
});

const imagePath = z.string().refine((value) => value.startsWith("/") || /^https?:\/\//.test(value), {
  message: "图片必须使用 public 目录路径或 http/https 地址",
});

const articles = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/articles" }),
  schema: z.object({
    title: z.string(),
    contentId,
    summary: z.string(),
    source: z.string(),
    sourceUrl: httpUrl.optional(),
    sourceKind: sourceKind.default("original"),
    tags: z.array(z.string()).min(1),
    pubDate: z.coerce.date(),
    readTime: z.string(),
    editorNote: z.string().optional(),
    internalNote: z.string().optional(),
    note: z.string().optional(),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
  }).superRefine((data, context) => {
    if (["publication", "editorial"].includes(data.sourceKind) && !data.sourceUrl) {
      context.addIssue({ code: "custom", path: ["sourceUrl"], message: "外部来源文章必须保留来源链接" });
    }
    if (data.sourceKind === "unknown" && !data.draft) {
      context.addIssue({ code: "custom", path: ["sourceKind"], message: "来源待确认的文章只能保存为草稿" });
    }
  }),
});

const images = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/images" }),
  schema: z.object({
    title: z.string(),
    contentId,
    description: z.string(),
    image: imagePath,
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    source: z.string(),
    sourceKind: imageSourceKind.default("original"),
    sourceUrl: httpUrl.optional(),
    author: z.string().optional(),
    license: z.string().optional(),
    licenseUrl: httpUrl.optional(),
    tags: z.array(z.string()).min(1),
    category: z.string(),
    mood: z.array(z.string()).default([]),
    scenes: z.array(z.string()).default([]),
    pubDate: z.coerce.date(),
    public: z.boolean().default(true),
    ratio: z.enum(["wide", "tall", "square"]).default("square"),
    draft: z.boolean().default(false),
  }).superRefine((data, context) => {
    if (data.sourceKind === "user_provided" || data.sourceKind === "unknown") return;
    for (const [name, value] of Object.entries({
      sourceUrl: data.sourceUrl,
      author: data.author,
      license: data.license,
      licenseUrl: data.licenseUrl,
    })) {
      if (!value) context.addIssue({ code: "custom", path: [name], message: "外部来源图片必须保留完整署名与授权信息" });
    }
  }),
});

export const collections = { articles, images };
