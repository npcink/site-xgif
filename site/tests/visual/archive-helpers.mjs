import { expect } from "@playwright/test";

// Find older fixtures through the same search controls available to visitors.
// Their publication order must not determine whether a regression test can open them.
export async function imageArchiveFor(page, id, url = "/images") {
  await page.goto(url);
  const card = page.locator(`main a.image-card[href="/${id}"]`);
  await page.getByRole("textbox", { name: "筛选图片" }).fill(await card.getAttribute("aria-label"));
  await expect(card).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(await card.getAttribute("aria-label"));
  return page.url();
}
