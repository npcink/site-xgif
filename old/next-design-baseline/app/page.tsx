"use client";

import { useMemo, useState } from "react";

type View = "all" | "articles" | "images";

const articles = [
  {
    id: "a1",
    title: "当 AI 开始替你使用电脑，真正变化的是什么？",
    summary:
      "从聊天框走向真实操作，AI 的价值不再只是回答问题，而是能否把一段模糊意图拆成可靠、可检查的行动。",
    note: "值得看：它讨论的不是模型跑分，而是人与工具的协作方式。",
    source: "少数派",
    sourceUrl: "https://sspai.com",
    date: "07.09",
    readTime: "3 分钟",
    tags: ["AI", "产品", "效率"],
    accent: "coral",
  },
  {
    id: "a2",
    title: "互联网产品为什么又开始变得“小而美”",
    summary:
      "当流量红利退去，清晰的使用场景、稳定的更新节奏和鲜明的个人判断，重新成为内容产品最耐用的护城河。",
    note: "一句话：不必服务所有人，先让一小群人愿意常来。",
    source: "爱范儿",
    sourceUrl: "https://www.ifanr.com",
    date: "07.08",
    readTime: "4 分钟",
    tags: ["互联网", "产品", "观察"],
    accent: "sage",
  },
  {
    id: "a3",
    title: "上班真正消耗人的，可能不是工作本身",
    summary:
      "频繁切换、模糊反馈和没有边界的在线状态，让注意力在一天结束前就被悄悄掏空。文章给出了几个低成本调整方法。",
    note: "适合收藏：先保护注意力，再谈提高效率。",
    source: "36氪",
    sourceUrl: "https://36kr.com",
    date: "07.07",
    readTime: "5 分钟",
    tags: ["职场", "生活", "效率"],
    accent: "blue",
  },
  {
    id: "a4",
    title: "一张梗图，是怎样成为群聊通用语的",
    summary:
      "表情包是一种压缩后的语境：画面负责情绪，文字负责方向，而转发者用它省掉了最难说出口的那句话。",
    note: "有趣之处：传播的不是图片，是默契。",
    source: "编辑手记",
    sourceUrl: "https://www.xgif.cn",
    date: "07.06",
    readTime: "2 分钟",
    tags: ["表情包", "互联网", "观察"],
    accent: "yellow",
  },
];

const images = [
  {
    id: "i1",
    title: "今天也在努力营业",
    caption: "适合：被问进度时，先稳住场面。",
    image:
      "https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=900&q=85",
    source: "Unsplash · Charles Deluvio",
    tags: ["打工", "回复别人", "无语"],
    ratio: "tall",
  },
  {
    id: "i2",
    title: "我听懂了，但我选择沉默",
    caption: "适合：群聊突然安静、话题逐渐离谱。",
    image:
      "https://images.unsplash.com/photo-1526336024174-e58f5cdd8e13?auto=format&fit=crop&w=900&q=85",
    source: "Unsplash · The Lucky Neko",
    tags: ["群聊", "无语", "疑惑"],
    ratio: "wide",
  },
  {
    id: "i3",
    title: "这就给我整不会了",
    caption: "适合：看到意料之外的操作。",
    image:
      "https://images.unsplash.com/photo-1574158622682-e40e69881006?auto=format&fit=crop&w=900&q=85",
    source: "Unsplash · Manja Vitolic",
    tags: ["震惊", "吐槽", "评论区"],
    ratio: "square",
  },
  {
    id: "i4",
    title: "好消息：快下班了",
    caption: "坏消息：需求也刚刚来了。",
    image:
      "https://images.unsplash.com/photo-1531297484001-80022131f5a1?auto=format&fit=crop&w=900&q=85",
    source: "Unsplash · Ales Nesetril",
    tags: ["打工", "反转", "尴尬"],
    ratio: "wide",
  },
  {
    id: "i5",
    title: "让我看看是谁又在催更",
    caption: "适合：对熟人进行无伤害反击。",
    image:
      "https://images.unsplash.com/photo-1507146426996-ef05306b995a?auto=format&fit=crop&w=900&q=85",
    source: "Unsplash · Pacto Visual",
    tags: ["催更", "嘲讽", "回复别人"],
    ratio: "tall",
  },
  {
    id: "i6",
    title: "已读，正在加载情绪",
    caption: "适合：一时不知道应该开心还是愤怒。",
    image:
      "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=85",
    source: "Unsplash · Harrison Broadbent",
    tags: ["AI", "疑惑", "反应图"],
    ratio: "square",
  },
];

const popularTags = [
  "AI",
  "互联网",
  "搞笑",
  "打工",
  "无语",
  "反转",
  "群聊",
  "职场",
];

export default function Home() {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("all");
  const [selectedImage, setSelectedImage] = useState<(typeof images)[number] | null>(
    null,
  );

  const normalized = query.trim().toLowerCase();

  const filteredArticles = useMemo(
    () =>
      articles.filter((item) =>
        [item.title, item.summary, item.source, ...item.tags]
          .join(" ")
          .toLowerCase()
          .includes(normalized),
      ),
    [normalized],
  );

  const filteredImages = useMemo(
    () =>
      images.filter((item) =>
        [item.title, item.caption, item.source, ...item.tags]
          .join(" ")
          .toLowerCase()
          .includes(normalized),
      ),
    [normalized],
  );

  const resultCount =
    (view === "images" ? 0 : filteredArticles.length) +
    (view === "articles" ? 0 : filteredImages.length);

  const chooseTag = (tag: string) => {
    setQuery(tag);
    document.getElementById("explore")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="xgif.cn 首页">
          xgif<span>.cn</span>
        </a>
        <nav className="desktop-nav" aria-label="主导航">
          <a href="#articles">文章</a>
          <a href="#images">图片 / GIF</a>
          <a href="#tags">标签</a>
        </nav>
        <a className="header-search" href="#explore">
          <span aria-hidden="true">⌕</span> 搜一搜
        </a>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span /> 轻内容，每日手工整理</p>
          <h1>
            值得看的，
            <br />
            <em>三分钟看懂。</em>
          </h1>
          <p className="hero-intro">
            文章负责整理信息，图片负责表达情绪。
            <br />
            AI 帮忙归纳，最后由人决定什么值得留下。
          </p>
          <div className="hero-actions">
            <a className="primary-button" href="#explore">开始浏览 <span>↘</span></a>
            <span className="edition">VOL. 001 · JUL 2026</span>
          </div>
        </div>

        <div className="hero-feature" aria-label="今日推荐">
          <div className="feature-topline">
            <span>今日推荐</span><span>01 / 04</span>
          </div>
          <div className="feature-visual">
            <div className="feature-orbit orbit-one" />
            <div className="feature-orbit orbit-two" />
            <div className="feature-face">◉</div>
            <div className="feature-sticker">AI<br />观察</div>
          </div>
          <div className="feature-copy">
            <span className="mini-label">READ · 3 MIN</span>
            <h2>当 AI 开始替你使用电脑，真正变化的是什么？</h2>
            <a href="#article-a1">读摘要 <span>→</span></a>
          </div>
        </div>
      </section>

      <section className="tag-ticker" aria-label="热门标签">
        <div className="ticker-label">本周热词</div>
        <div className="ticker-track">
          {["#AI Agent", "#今天不想上班", "#互联网考古", "#猫猫统治世界", "#反转"].map(
            (tag) => (
              <button key={tag} onClick={() => chooseTag(tag.replace("#", ""))}>{tag}</button>
            ),
          )}
        </div>
      </section>

      <section className="explore" id="explore">
        <div className="section-heading">
          <div>
            <p className="section-kicker">DISCOVER / 发现</p>
            <h2>今天有什么好东西？</h2>
          </div>
          <p>从摘要快速了解，也用一张图说完复杂情绪。</p>
        </div>

        <div className="search-panel">
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索文章、图片、标签或来源…"
              aria-label="搜索内容"
            />
            {query && <button onClick={() => setQuery("")} aria-label="清空搜索">×</button>}
          </label>
          <div className="view-tabs" role="group" aria-label="内容类型">
            {([
              ["all", "全部"],
              ["articles", "文章摘要"],
              ["images", "图片 / GIF"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                className={view === id ? "active" : ""}
                onClick={() => setView(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {query && (
          <p className="result-note">
            关于“{query}”找到 <strong>{resultCount}</strong> 条内容
          </p>
        )}

        {view !== "images" && (
          <div className="content-section" id="articles">
            <div className="content-title">
              <h3>文章摘要 <sup>{filteredArticles.length.toString().padStart(2, "0")}</sup></h3>
              <span>省下时间，不省掉重点</span>
            </div>
            <div className="article-grid">
              {filteredArticles.map((article, index) => (
                <article className={`article-card ${article.accent}`} key={article.id} id={`article-${article.id}`}>
                  <div className="article-meta">
                    <span>{article.source}</span>
                    <span>{article.date}</span>
                  </div>
                  <div className="article-number">0{index + 1}</div>
                  <h4>{article.title}</h4>
                  <p>{article.summary}</p>
                  <blockquote>{article.note}</blockquote>
                  <div className="card-tags">
                    {article.tags.map((tag) => (
                      <button key={tag} onClick={() => chooseTag(tag)}>#{tag}</button>
                    ))}
                  </div>
                  <div className="article-footer">
                    <span>{article.readTime}</span>
                    <a href={article.sourceUrl} target="_blank" rel="noreferrer">
                      去看原文 <span aria-hidden="true">↗</span>
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}

        {view !== "articles" && (
          <div className="content-section image-section" id="images">
            <div className="content-title">
              <h3>图片 / 表情包 <sup>{filteredImages.length.toString().padStart(2, "0")}</sup></h3>
              <span>不知道怎么说？那就发张图</span>
            </div>
            <div className="masonry-grid">
              {filteredImages.map((item) => (
                <button
                  className={`image-card ${item.ratio}`}
                  key={item.id}
                  onClick={() => setSelectedImage(item)}
                  aria-label={`查看图片：${item.title}`}
                >
                  <img src={item.image} alt="" />
                  <div className="image-shade" />
                  <div className="image-copy">
                    <div className="image-tags">{item.tags.slice(0, 2).map((tag) => <span key={tag}>#{tag}</span>)}</div>
                    <h4>{item.title}</h4>
                    <p>{item.caption}</p>
                  </div>
                  <span className="open-mark" aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {resultCount === 0 && (
          <div className="empty-state">
            <span>¯\_(ツ)_/¯</span>
            <h3>这次真的什么都没搜到</h3>
            <p>换个更短的关键词，或者从热门标签开始。</p>
            <button onClick={() => { setQuery(""); setView("all"); }}>看看全部内容</button>
          </div>
        )}
      </section>

      <section className="tag-library" id="tags">
        <div className="tag-intro">
          <p className="section-kicker">INDEX / 标签索引</p>
          <h2>沿着标签，<br />继续逛下去。</h2>
          <p>主题、情绪和使用场景，共同把文章与表情包连接起来。</p>
        </div>
        <div className="tag-cloud">
          {popularTags.map((tag, index) => (
            <button key={tag} onClick={() => chooseTag(tag)}>
              <span>0{index + 1}</span> {tag} <b>↗</b>
            </button>
          ))}
        </div>
      </section>

      <section className="newsletter">
        <div className="newsletter-mark">每周<br />一封</div>
        <div>
          <p className="section-kicker">WEEKLY DIGEST</p>
          <h2>别追热点，让好内容来找你。</h2>
          <p>每周一次，只有文章摘要、图片和一点编辑判断。无广告轰炸。</p>
        </div>
        <form onSubmit={(event) => event.preventDefault()}>
          <input type="email" placeholder="你的邮箱" aria-label="邮箱地址" />
          <button type="submit">暂存订阅 <span>→</span></button>
          <small>演示入口 · 第一阶段暂不收集数据</small>
        </form>
      </section>

      <footer>
        <div className="footer-brand">xgif<span>.cn</span></div>
        <p>有趣的信息，被认真地整理。</p>
        <div className="footer-links">
          <a href="#articles">文章</a><a href="#images">图片</a><a href="#tags">标签</a>
        </div>
        <div className="footer-bottom">
          <span>© 2026 xgif.cn</span>
          <span>AI 辅助整理 · 人工确认发布</span>
        </div>
      </footer>

      {selectedImage && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setSelectedImage(null)}>
          <div
            className="image-modal"
            role="dialog"
            aria-modal="true"
            aria-label={selectedImage.title}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setSelectedImage(null)} aria-label="关闭">×</button>
            <div className="modal-image"><img src={selectedImage.image} alt={selectedImage.title} /></div>
            <div className="modal-copy">
              <p className="section-kicker">REACTION / 图片详情</p>
              <h2>{selectedImage.title}</h2>
              <p>{selectedImage.caption}</p>
              <div className="card-tags">
                {selectedImage.tags.map((tag) => <button key={tag} onClick={() => { setSelectedImage(null); chooseTag(tag); }}>#{tag}</button>)}
              </div>
              <small>图片来源备注：{selectedImage.source}</small>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
