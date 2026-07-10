import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const httpUrl = z.url().refine((value) => /^https?:\/\//.test(value), {
  message: "必须使用 http 或 https 地址",
});

const sourceKind = z.enum(["original", "publication", "editorial"]);

const imagePath = z.string().refine((value) => value.startsWith("/") || /^https?:\/\//.test(value), {
  message: "图片必须使用 public 目录路径或 http/https 地址",
});

const articles = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/articles" }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    source: z.string(),
    sourceUrl: httpUrl,
    sourceKind: sourceKind.default("original"),
    tags: z.array(z.string()).min(1),
    pubDate: z.coerce.date(),
    readTime: z.string(),
    note: z.string().optional(),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

const images = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/images" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    image: imagePath,
    source: z.string(),
    sourceUrl: httpUrl,
    author: z.string(),
    license: z.string(),
    licenseUrl: httpUrl,
    tags: z.array(z.string()).min(1),
    category: z.string(),
    mood: z.array(z.string()).default([]),
    scenes: z.array(z.string()).default([]),
    pubDate: z.coerce.date(),
    public: z.boolean().default(true),
    ratio: z.enum(["wide", "tall", "square"]).default("square"),
    draft: z.boolean().default(false),
  }),
});

export const collections = { articles, images };
