import { test, expect } from "@playwright/test";

test.describe("Paseo Dashboard Web", () => {
  test("renders main heading and account form", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("h1")).toHaveText("Paseo Dashboard");
    await expect(page.getByPlaceholder("粘贴 https://app.paseo.sh/#offer=...")).toBeVisible();
    await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
    await expect(page.getByRole("button", { name: "注册" })).toBeVisible();
  });

  test("shows offer input and verify button", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "导入 Host" })).toBeVisible();
    await expect(page.getByRole("button", { name: "校验 offer" })).toBeVisible();
    await expect(page.getByRole("button", { name: "验证并导入" })).toBeDisabled();
  });

  test("shows host sync section", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Host 同步与连接" })).toBeVisible();
    await expect(page.getByRole("button", { name: "同步 Host" })).toBeVisible();
    await expect(page.getByRole("button", { name: "连接选中 Host" })).toBeDisabled();
  });
});
