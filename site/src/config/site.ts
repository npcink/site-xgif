export const siteConfig = {
  url: "https://www.xgif.cn",
  name: "xgif.cn",
  brand: {
    base: "xgif",
    suffix: ".cn",
  },
  locale: "zh-CN",
  defaultTitle: "xgif.cn · GIF 动图、表情包与文章选读",
  description: "收录有趣的 GIF 动图、表情包和文章。图片可按情绪和场景浏览，文章保留编辑摘要、正文与来源信息。",
  defaultSocialImage: "/og.png",
  publisherName: "xgif.cn",
  mainNavigation: [
    { href: "/articles", label: "文章" },
    { href: "/images", label: "图片 / GIF" },
    { href: "/tags", label: "标签" },
  ],
  footerNavigation: [
    {
      label: "实用功能",
      links: [{ href: "/activity", label: "本次浏览" }],
    },
    {
      label: "站点信息",
      links: [
        { href: "/about", label: "关于" },
        { href: "/privacy", label: "隐私" },
        { href: "/rights", label: "版权与更正" },
        { href: "/rss.xml", label: "RSS" },
      ],
    },
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
