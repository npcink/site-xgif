import { expect } from "@playwright/test";

export async function waitForCatalog(page) {
  await expect(page.locator("html")).toHaveAttribute("data-catalog-ready", "");
}

export async function catalogItems(page, kind, search = false) {
  return page.evaluate(async ({ kind, search }) => {
    const base = document.querySelector("[data-catalog-base]").dataset.catalogBase;
    const response = await fetch(`${base}/${search ? "search-" : ""}${kind}.json`);
    if (!response.ok) throw new Error("Fixture catalog unavailable");
    return (await response.json()).items;
  }, { kind, search });
}

// Open fixed older fixtures through the visitor's search control.
export async function imageArchiveFor(page, id, url = "/images") {
  await page.goto(url);
  await waitForCatalog(page);
  const item = (await catalogItems(page, "images")).find(item => item.id === id);
  if (!item) throw new Error(`Missing public fixture ${id}`);
  await page.getByRole("textbox", { name: "筛选图片" }).fill(item.title);
  const card = page.locator(`main a.image-card[href="/${id}"]`);
  await expect(card).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(item.title);
  return page.url();
}
