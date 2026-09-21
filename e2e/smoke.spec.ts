import { expect, test } from "@playwright/test";

/**
 * Smoke test for the main flows: sign-in, My patch, a company page and
 * logging a call. Sign-in needs a session, and a code by email cannot be
 * scripted, so pass a refresh token from a signed-in browser (localStorage
 * key sb-<ref>-auth-token) as E2E_SESSION_JSON; without it the test only
 * checks that the app redirects to the sign-in page.
 *
 * E2E_BASE_URL names the site under test (no default: the test never points
 * at production by accident). VITE_SUPABASE_PROJECT_ID names the project
 * whose session key the signed-in test injects.
 */
const BASE = process.env.E2E_BASE_URL;
const SESSION = process.env.E2E_SESSION_JSON;
const PROJECT_REF = process.env.VITE_SUPABASE_PROJECT_ID;

if (!BASE) {
  throw new Error("E2E_BASE_URL is not set. Point it at the site under test, e.g. E2E_BASE_URL=http://127.0.0.1:4173 npm run test:e2e");
}

test("signed out, every page goes to sign-in", async ({ page }) => {
  for (const path of ["/", "/companies", "/alerts"]) {
    await page.goto(`${BASE}${path}`);
    await expect(page).toHaveURL(/\/login$/);
  }
  await expect(page.getByLabel("Work email")).toBeVisible();
  await page.getByLabel("Work email").fill("nobody@example.com");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByRole("alert")).toContainText("bigfishrecruitment.co.uk");
});

test.describe("signed in", () => {
  test.skip(!SESSION, "E2E_SESSION_JSON not set");
  test.skip(!!SESSION && !PROJECT_REF, "VITE_SUPABASE_PROJECT_ID not set (needed to name the session key)");
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.evaluate(([session, ref]) => {
      localStorage.setItem(`sb-${ref}-auth-token`, session);
    }, [SESSION!, PROJECT_REF!]);
  });

  test("My patch, a company, log a call", async ({ page }) => {
    await page.goto(`${BASE}/`);
    await expect(page.getByRole("heading", { name: "My patch" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Pages" })).toBeVisible();
    const firstCompany = page.getByRole("table", { name: "Companies in the patch" }).getByRole("button").first();
    await firstCompany.click();
    await expect(page).toHaveURL(/\/companies\//);
    await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Open roles" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Likely to buy" })).toBeVisible();
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Calls" }).click();
    await page.getByLabel("Note").fill("Smoke test call");
    await page.getByRole("button", { name: "Log a call" }).click();
    await expect(page.getByText("Smoke test call")).toBeVisible();
    // Tidy up: delete the entry we just made.
    await page.getByRole("button", { name: "Delete this call" }).first().click();
  });
});
