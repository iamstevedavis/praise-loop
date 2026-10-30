import assert from "node:assert/strict";
import { chromium, type Browser, type BrowserContext } from "playwright-core";
import { databaseFixture } from "./db-fixture";
import { webFixture } from "./web-fixture";
import { sessionHash } from "../lib/auth-adapter";

// Walks the web profile menu (#150) against a production build: open it, edit the
// name, reach the plan page, sign out, and see the "Add your name" prompt for an
// owner Google gave no name. Synthetic owners and sessions only.
async function main() {
  if (process.env.TEST_BROWSER !== "1") { console.log("Profile browser skipped: build and set TEST_BROWSER/TEST_DATABASE_URL"); return; }
  await databaseFixture(async c => {
    await c.query("INSERT INTO auth_users(id,name,email) VALUES('profile-browser','Synthetic Named Owner','profile-browser@example.invalid')");
    await c.query("INSERT INTO auth_users(id,name,email) VALUES('profile-browser-unnamed',NULL,'unnamed-profile@example.invalid')");
    await c.query("INSERT INTO auth_sessions VALUES($1,'profile-browser',now()+interval '1 hour')", [sessionHash("profile-browser-session")]);
    await c.query("INSERT INTO auth_sessions VALUES($1,'profile-browser-unnamed',now()+interval '1 hour')", [sessionHash("profile-browser-unnamed-session")]);

    await webFixture(async base => {
      const browser: Browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH === "playwright" ? undefined : process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
      const open = async (session: string): Promise<BrowserContext> => {
        const context = await browser.newContext();
        await context.addCookies([{ name: "next-auth.session-token", value: session, url: base }]);
        return context;
      };
      try {
        // A named owner: the menu shows who they are, Escape dismisses it and the
        // plan is no longer a top-level nav item.
        const named = await open("profile-browser-session");
        const page = await named.newPage();
        const pageErrors: string[] = [];
        page.on("pageerror", error => pageErrors.push(error.message));
        await page.goto(`${base}/approval`);
        const profileButton = page.getByRole("button", { name: /^Profile:/ });
        await profileButton.click();
        await page.getByText("profile-browser@example.invalid").waitFor();
        await page.getByText("Synthetic Named Owner", { exact: true }).first().waitFor();
        assert.equal(await page.getByRole("link", { name: "Plan", exact: true }).count(), 0, "Plan is not a top-level nav item");
        assert.equal(await page.getByRole("link", { name: "This week" }).count(), 1);

        await page.keyboard.press("Escape");
        assert.equal(await page.getByText("Plan and usage").count(), 0, "Escape closes the menu");
        assert.equal(await profileButton.evaluate(element => element === document.activeElement), true, "focus returns to the profile button");

        // Editing the name updates the menu without a reload and records the owner.
        await profileButton.click();
        await page.getByRole("button", { name: "Edit name" }).click();
        await page.getByLabel("Your name").fill("Synthetic Edited Owner");
        const patched = page.waitForResponse(response => response.url().endsWith("/api/profile") && response.request().method() === "PATCH");
        await page.getByRole("button", { name: "Save", exact: true }).click();
        assert.equal((await patched).status(), 200);
        await page.getByText("Synthetic Edited Owner", { exact: true }).first().waitFor();
        const stored = (await c.query("SELECT name,name_source FROM auth_users WHERE id='profile-browser'")).rows[0];
        assert.deepEqual(stored, { name: "Synthetic Edited Owner", name_source: "owner" });

        // Plan and usage live under the profile and still land on /account.
        await page.getByRole("link", { name: "Plan and usage" }).click();
        await page.waitForURL(`${base}/account`);
        await page.getByRole("heading", { name: "Synthetic Edited Owner" }).waitFor();
        await page.getByRole("heading", { name: "Free plan" }).waitFor();

        // Sign out is only in the profile menu and ends the server session.
        await page.getByRole("button", { name: /^Profile:/ }).click();
        const signout = page.waitForResponse(response => response.url().includes("/api/auth/signout") && response.request().method() === "POST");
        await page.getByRole("button", { name: "Sign out", exact: true }).click();
        assert.equal((await signout).status(), 200);
        await page.waitForURL(`${base}/`);
        assert.equal((await c.query("SELECT count(*) n FROM auth_sessions WHERE owner_id='profile-browser'")).rows[0].n, "0", "the server session is deleted");
        assert.deepEqual(pageErrors, []);
        await named.close();

        // An owner with no name sees the prompt, not a blank or the raw email; at
        // phone width the menu stays on screen and above the tab bar.
        const unnamed = await open("profile-browser-unnamed-session");
        const phone = await unnamed.newPage();
        await phone.setViewportSize({ width: 390, height: 844 });
        await phone.goto(`${base}/approval`);
        const phoneButton = phone.getByRole("button", { name: /^Profile:/ });
        await phoneButton.click();
        const phoneMenu = phone.locator(".pl-profile-menu");
        await phoneMenu.getByText("Add your name", { exact: true }).waitFor();
        await phoneMenu.getByText("unnamed-profile@example.invalid").waitFor();
        const menu = await phoneMenu.boundingBox();
        const tabbar = await phone.locator(".pl-tabbar").boundingBox();
        assert.ok(menu && tabbar, "the menu and tab bar are laid out");
        assert.ok(menu.x >= 0 && menu.x + menu.width <= 390, "the menu stays on screen");
        assert.ok(menu.y + menu.height <= tabbar.y, "the menu does not cover the tab bar");
        await phone.keyboard.press("Escape");
        assert.equal(await phoneButton.evaluate(element => element === document.activeElement), true, "focus returns to the phone profile button");
        await unnamed.close();

        console.log(JSON.stringify({ event: "synthetic_profile_menu_walkthrough", sessionMode: "synthetic", owners: ["named", "unnamed"], viewports: ["desktop", "phone"] }));
      } finally { await browser.close(); }
    });
  });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
