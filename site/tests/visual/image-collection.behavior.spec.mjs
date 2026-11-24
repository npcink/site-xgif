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
