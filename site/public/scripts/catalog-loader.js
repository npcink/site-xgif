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
  // Later pages stay lazy, including sizes=auto, even when the first card is eager.
  const imageSizes = root.dataset.catalogImageSizes
    || (grid.querySelector('img[loading="lazy"]') || grid.querySelector("img"))?.getAttribute("sizes");
  for (const card of grid.children) {
    // Cloning into the active document can fetch even disconnected lazy images.
    // Template contents stay inert until a cached card is restored to the list.
    const template = document.createElement("template");
    template.innerHTML = card.outerHTML;
    cards.set(`${base}/${kind}/${card.dataset.catalogId}`, template.content.firstElementChild);
  }
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
      const needsSearch = query || (source && !sourceOnly);
      const [loadedRecords, loadedSearch] = await Promise.all([
        records ?? json(kind),
        needsSearch ? search ?? json(`search-${kind}`).then(items => new Map(items.map(item => [item.id, item.text]))) : null,
      ]);
      records = loadedRecords;
      if (needsSearch) search = loadedSearch;
      return records.filter(item => (!tag || item.tags.includes(tag))
        && (!query || search.get(item.id).includes(query))
        && (!source || (sourceOnly ? item.source === source : search.get(item.id).includes(source)))
        && (!media || (item.mediaTypes || "").split(" ").includes(media)));
    },
    async nodes(items, isCurrent = () => true) {
      const pages = [...new Set(items.filter(item => !cards.has(`${base}/${kind}/${item.id}`)).map(item => item.page))];
      const loadPage = page => load(`${base}/cards/${kind}/${page}`, async response => {
        const document = new DOMParser().parseFromString(await response.text(), "text/html");
        const fragment = document.querySelector("[data-catalog-fragment]");
        if (fragment?.dataset.revision !== revision || fragment.dataset.kind !== kind) throw new Error("catalog-fragment");
        for (const card of fragment.children) {
          if (!ID.test(card.dataset.catalogId)) throw new Error("catalog-card");
          const key = `${base}/${kind}/${card.dataset.catalogId}`;
          if (!cards.has(key)) cards.set(key, card);
        }
      });
      // Refill each request slot as it becomes free, without waiting for slower siblings.
      let next = 0, failed = false;
      const fillSlot = async () => {
        try {
          while (!failed && isCurrent() && next < pages.length) await loadPage(pages[next++]);
        } catch (error) {
          failed = true;
          throw error;
        }
      };
      await Promise.all(Array.from({ length: Math.min(pages.length, 4) }, fillSlot));
      if (!isCurrent()) return null;
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
