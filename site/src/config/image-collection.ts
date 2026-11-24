export const imageCollections = [
  {
    slug: "costume-dialogue",
    title: "古装剧接话三连",
    description: "三张古装对白表情图：先接话，再打趣，最后吐槽。",
    members: [
      { id: "20261124-1mr5", caption: "接话" },
      { id: "20261124-ba5f", caption: "打趣" },
      { id: "20261124-bcea", caption: "吐槽" },
    ],
  },
  {
    slug: "white-horned-mask",
    title: "白色长角面具",
    description: "同一角色主题的两张二创：一张是暖光下的扮装，一张是蓝绿光中的红披风。",
    members: [
      { id: "20261123-aqco", caption: "暖色逆光" },
      { id: "20261123-9t6t", caption: "蓝绿光与红披风" },
    ],
  },
  {
    slug: "lopital",
    title: "洛必达两连",
    description: "先喊「洛必达法则天下第一」，再来一道洛来洛去又回到原题的极限。",
    members: [
      { id: "20261123-coe2", caption: "洛必达法则天下第一" },
      { id: "20261123-muyj", caption: "反复用洛必达" },
    ],
  },
];

export const imageCollectionHref = (slug: string) => `/images/collections/${slug}`;
