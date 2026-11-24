import { expect, test } from "@playwright/test";

const path = "/images/collections/costume-dialogue";
const memberPaths = ["/20261124-1mr5", "/20261124-ba5f", "/20261124-bcea"];

test("the editorial collection links to the unchanged single images in order", async ({ page }) => {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "古装剧接话三连" })).toBeVisible();
  const members = page.locator(".collection-members li");
  await expect(members).toHaveCount(3);
  for (const [i, memberPath] of memberPaths.entries()) {
    const member = members.nth(i);
    await expect(member.getByRole("link")).toHaveAttribute("href", memberPath);
    await expect(member.getByText("Lanczos 放大版")).toBeVisible();
    const image = member.getByRole("img");
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element) => element.naturalWidth)).toBeGreaterThan(0);
  }
  await expect(members.first()).toContainText("封面");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);

  await members.first().getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`${memberPaths[0]}$`));
  await expect(page.getByRole("link", { name: "查看 / 保存放大版" })).toBeVisible();
  await page.getByRole("link", { name: "古装剧接话三连" }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
});

for (const { slug, title, ids, excludedIds = [], sourceHint = /原作者与授权信息待核实/ } of [
  { slug: "white-horned-mask", title: "白色长角面具", ids: ["20261123-aqco", "20261123-9t6t"], excludedIds: ["20261123-4f7m"] },
  { slug: "lopital", title: "洛必达两连", ids: ["20261123-coe2", "20261123-muyj"] },
  {
    slug: "pink-haired-food-stall",
    title: "粉发小人的小吃摊日常",
    ids: ["20261123-4qiu", "20261123-1iy9", "20261123-qycb"],
    excludedIds: ["20261123-knt5", "20261123-9gow", "20261123-03ld"],
    sourceHint: /来源待核实/,
  },
]) {
  test(`${title} only includes the approved members in order`, async ({ page }) => {
    const collectionPath = `/images/collections/${slug}`;
    await page.goto(collectionPath);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    const list = page.getByRole("list").filter({ has: page.locator(".member-caption") });
    const links = list.getByRole("link");
    await expect(links).toHaveCount(ids.length);
    await expect(links.first()).toContainText("封面");
    for (const [index, id] of ids.entries()) {
      const link = links.nth(index);
      await expect(link).toHaveAttribute("href", `/${id}`);
      const image = link.getByRole("img");
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate((element) => element.naturalWidth)).toBeGreaterThan(0);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/${id}$`));
      await expect(page.getByText(sourceHint)).toBeVisible();
      await page.getByRole("link", { name: title, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${collectionPath}$`));
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
    for (const excludedId of excludedIds) {
      await page.goto(`/${excludedId}`);
      await expect(page.getByRole("link", { name: title, exact: true })).toHaveCount(0);
    }
  });
}
