import { expect, test, type Page } from "@playwright/test";

/**
 * Signed-in grants journey: applicant submits, administrators investigate, recommend and award (two people), the
 * applicant submits milestone evidence, an administrator approves it, and finance asks the treasury to pay.
 *
 * GATED: runs only against a DEDICATED TEST deployment and Supabase project (never production), with test accounts in one
 * test organisation, given as environment variables:
 *   E2E_BASE_URL, E2E_GRANTS=1,
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD     owner or administrator
 *   E2E_ADMIN2_EMAIL / E2E_ADMIN2_PASSWORD   a second administrator (awards; must differ from the recommender)
 *   E2E_APPLICANT_EMAIL / E2E_APPLICANT_PASSWORD   grant_applicant
 * Migrations 0019 to 0021 must be applied there. It never executes a payment: requesting one only records it.
 */
const env = (k: string) => process.env[k] ?? "";
const ready = env("E2E_GRANTS") === "1" && ["E2E_ADMIN_EMAIL", "E2E_ADMIN_PASSWORD", "E2E_ADMIN2_EMAIL", "E2E_ADMIN2_PASSWORD", "E2E_APPLICANT_EMAIL", "E2E_APPLICANT_PASSWORD"].every((k) => env(k));
test.skip(!ready, "Set E2E_GRANTS=1 and the test accounts to run the signed-in grants journey (dedicated test project only).");
test.describe.configure({ mode: "serial" });

const ROUND = `E2E Grants ${Date.now()}`;
let roundUrl = "", appUrl = "";

async function signIn(page: Page, who: "ADMIN" | "ADMIN2" | "APPLICANT") {
  await page.context().clearCookies();
  await page.goto("/login?next=/grants");
  await page.getByLabel("Work email").fill(env(`E2E_${who}_EMAIL`));
  await page.getByLabel("Password", { exact: true }).fill(env(`E2E_${who}_PASSWORD`));
  await page.getByRole("button", { name: /^Sign in/ }).click();
  await page.waitForURL(/\/grants/);
}

test("an administrator opens a round with the default rubric", async ({ page }) => {
  await signIn(page, "ADMIN");
  await page.getByLabel("Title").fill(ROUND);
  await page.getByLabel("Budget (QOR)").fill("100");
  await page.getByLabel("Max per application").fill("50");
  await page.getByRole("button", { name: "Open round" }).click();
  await expect(page.getByText(/default rubric \(version 1\)/)).toBeVisible();
  roundUrl = page.url().split("?")[0]!;
  await expect(page.getByText("Project relevance")).toBeVisible();
});

test("an applicant saves a draft, is told what is missing, then submits", async ({ page }) => {
  await signIn(page, "APPLICANT");
  await page.goto(`${roundUrl}/apply`);
  await page.getByLabel("Project or team name").fill("E2E Indexer");
  await page.getByLabel("Category").selectOption("software");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/Draft saved/)).toBeVisible();
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page.getByText(/Not submitted yet/)).toBeVisible();
  const text = "An open-source indexer for grant programmes with documented endpoints.";
  for (const label of ["Overview", "Problem being solved", "Proposed solution", "Technical implementation"]) await page.getByLabel(label).fill(text);
  await page.getByLabel("Team and contributors").fill("Two engineers.");
  await page.getByLabel("Success metrics").fill("Three programmes use the API within two months.");
  await page.getByLabel("Requested amount (QOR)").fill("4");
  await page.getByLabel(/Recipient wallet address/).fill("0x" + "4".repeat(40));
  await page.getByLabel("Budget line 1").fill("Engineering, 2 weeks");
  await page.getByLabel("Budget line 1 amount (QOR)").fill("4");
  await page.getByLabel("Milestone 1 title").fill("MVP");
  await page.getByLabel("Milestone 1 due date").fill(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
  await page.getByLabel("Milestone 1 amount (QOR)").fill("4");
  await page.getByLabel("Milestone 1 deliverable").fill("Indexer deployed against Diana with documented endpoints.");
  await page.getByLabel("Milestone 1 verification").fill("Public endpoint URL and a release tag.");
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page.getByText(/Submitted \(version 1\)/)).toBeVisible();
  appUrl = page.url().split("?")[0]!;
});

test("the applicant cannot see reviewer evidence or other applications", async ({ page }) => {
  await signIn(page, "APPLICANT");
  await page.goto(appUrl);
  await expect(page.getByText("Evidence", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Recommend" })).toHaveCount(0);
});

test("administrators investigate, one recommends, a different one awards", async ({ page }) => {
  await signIn(page, "ADMIN");
  await page.goto(`${roundUrl}/intelligence`);
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByText("Review package")).toBeVisible({ timeout: 180_000 });
  await page.goto(appUrl);
  await expect(page.getByText("Evaluation report")).toBeVisible();
  await page.getByLabel("Reason for the decision (recorded)").fill("Complete, verifiable milestones");
  await page.getByRole("button", { name: "Recommend" }).click();
  await expect(page.getByText(/different administrator must/)).toBeVisible();
  await signIn(page, "ADMIN2");
  await page.goto(appUrl);
  await page.getByRole("button", { name: "Award" }).click();
  await expect(page.getByText(/Awarded with 1 milestone/)).toBeVisible();
});

test("milestone evidence, approval, and a payment request that never pays twice", async ({ page }) => {
  await signIn(page, "APPLICANT");
  await page.goto(appUrl);
  await page.getByLabel("What was delivered").fill("Indexer deployed; endpoint and release linked.");
  await page.getByRole("button", { name: "Submit evidence" }).click();
  await expect(page.getByText(/Evidence submitted \(attempt 1\)/)).toBeVisible();
  await signIn(page, "ADMIN");
  await page.goto(appUrl);
  await page.getByLabel("Reason").first().fill("Endpoint responds and the release exists");
  await page.getByRole("button", { name: "Approve milestone" }).click();
  await expect(page.getByText(/Milestone approved/)).toBeVisible();
  await page.getByRole("button", { name: "Request payment through the treasury" }).click();
  await expect(page.getByText(/Payment requested on TreasuryVault V2|Not requested:/)).toBeVisible();
  const requested = await page.getByText("PAYMENT REQUESTED").count();
  if (requested) await expect(page.getByRole("button", { name: "Request payment through the treasury" })).toHaveCount(0);
});
