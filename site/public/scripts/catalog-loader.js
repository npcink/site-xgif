const requests = new Map();
const cards = new Map();
const ID = /^\d{8}-[a-z0-9]{4}$/;

function load(url, decode) {
  if (!requests.has(url)) {
    const request = fetch(url).then(response => {
      if (!response.ok) throw new Error("catalog-unavailable");
      return decode(response);
    }).catch(error => { requests.delete(url); throw error; });
    requests.set(url, request);
  }
  return requests.get(url);
}

export function createCatalog(root) {
  const { catalogBase: base, catalogKind: kind, catalogTag: tag } = root.dataset;
  if (!/^\/catalog\/[a-f0-9]{20}$/.test(base) || !["articles", "images"].includes(kind)) throw new Error("catalog-config");
  const revision = base.split("/").at(-1);
  const grid = root.querySelector(".article-grid, .masonry-grid");
  const imageSizes = root.dataset.catalogImageSizes || grid.querySelector("img")?.getAttribute("sizes");
  for (const card of grid.children) cards.set(`${base}/${kind}/${card.dataset.catalogId}`, card.cloneNode(true));
  let records;
  let search;
  async function json(name) {
    return load(`${base}/${name}.json`, async response => {
      const value = await response.json();
      if (value.format !== 1 || value.revision !== revision || value.kind !== kind || !Array.isArray(value.items)
        || value.items.some(item => !ID.test(item.id))) throw new Error("catalog-format");
      return value.items;
    });
  }
  return {
    root, grid,
    total: Number(root.dataset.catalogTotal),
    async matches({ query, source, media, sourceOnly }) {
      records ??= await json(kind);
      if (query || (source && !sourceOnly)) search ??= new Map((await json(`search-${kind}`)).map(item => [item.id, item.text]));
      return records.filter(item => (!tag || item.tags.includes(tag))
        && (!query || search.get(item.id).includes(query))
        && (!source || (sourceOnly ? item.source === source : search.get(item.id).includes(source)))
        && (!media || (item.mediaTypes || "").split(" ").includes(media)));
    },
    async nodes(items) {
      const pages = [...new Set(items.filter(item => !cards.has(`${base}/${kind}/${item.id}`)).map(item => item.page))];
      // Bound concurrency for scattered search results; unused images have no src.
      for (let start = 0; start < pages.length; start += 4) {
        await Promise.all(pages.slice(start, start + 4).map(page => load(`${base}/cards/${kind}/${page}`, async response => {
          const document = new DOMParser().parseFromString(await response.text(), "text/html");
          const fragment = document.querySelector("[data-catalog-fragment]");
          if (fragment?.dataset.revision !== revision || fragment.dataset.kind !== kind) throw new Error("catalog-fragment");
          for (const card of fragment.children) {
            if (!ID.test(card.dataset.catalogId)) throw new Error("catalog-card");
            const key = `${base}/${kind}/${card.dataset.catalogId}`;
            if (!cards.has(key)) cards.set(key, card);
          }
        })));
      }
      return items.map(item => {
        const card = cards.get(`${base}/${kind}/${item.id}`)?.cloneNode(true);
        if (!card) throw new Error("catalog-card-missing");
        const heading = card.querySelector("h2, h3");
        const level = tag || root.hasAttribute("data-search-group") ? "h3" : "h2";
        if (heading && heading.localName !== level) {
          const replacement = document.createElement(level);
          replacement.className = heading.className;
          replacement.append(...heading.childNodes);
          heading.replaceWith(replacement);
        }
        for (const image of card.querySelectorAll("img[data-card-src]")) {
          if (imageSizes) image.sizes = imageSizes;
          if (image.dataset.cardSrcset) image.srcset = image.dataset.cardSrcset;
          image.src = image.dataset.cardSrc;
          delete image.dataset.cardSrc;
          delete image.dataset.cardSrcset;
        }
        return card;
      });
    },
  };
}
