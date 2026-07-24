export const siteConfig = {
  url: "https://www.xgif.cn",
  name: "xgif.cn",
  brand: {
    base: "xgif",
    suffix: ".cn",
  },
  locale: "zh-CN",
  defaultTitle: "xgif.cn — 值得看的，三分钟看懂",
  description: "整理有趣文章、编辑摘要、网络热点、图片和表情包的轻内容站。",
  defaultSocialImage: "/og.png",
  publisherName: "xgif.cn",
  mainNavigation: [
    { href: "/articles", label: "文章" },
    { href: "/images", label: "图片 / GIF" },
    { href: "/tags", label: "标签" },
  ],
  footerNavigation: [
    { href: "/articles", label: "文章" },
    { href: "/images", label: "图片" },
    { href: "/tags", label: "标签" },
    { href: "/about", label: "关于" },
    { href: "/rights", label: "版权与更正" },
    { href: "/privacy", label: "隐私" },
    { href: "/rss.xml", label: "RSS" },
  ],
  rss: {
    path: "/rss.xml",
    title: "xgif.cn 文章",
    description: "值得看的文章、编辑摘要与来源索引。",
    language: "zh-CN",
    maxItems: 50,
  },
} as const;

export function pageTitle(title: string) {
  return `${title} — ${siteConfig.name}`;
}
