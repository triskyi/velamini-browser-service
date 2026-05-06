import { Browser, BrowserContext, Cookie, Page } from "playwright";
import { ApplicantProfile, ApplyResult } from "../types";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Attempt to log in to LinkedIn using email + password or Google account.
 * Returns true if login succeeded, false otherwise.
 */
async function loginLinkedIn(page: Page, email: string, password: string, loginMethod: 'email' | 'google' = 'email'): Promise<boolean> {
  try {
    await page.goto("https://www.linkedin.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    if (loginMethod === 'google') {
      // Click the "Continue with Google" button
      const googleBtn = page.locator("button[data-tracking-control-name='auth_wall_google_login'], button:has-text('Continue with Google')").first();
      await googleBtn.click();
      // Wait for Google OAuth popup or redirect
      await page.waitForTimeout(5_000);
      // If popup, handle it (assuming email and password are Google credentials)
      const popup = page.context().pages().find(p => p.url().includes('accounts.google.com'));
      if (popup) {
        await popup.fill("#identifierId", email);
        await popup.click("#identifierNext");
        await page.waitForTimeout(2_000);
        if (password) {
          await popup.fill("input[type='password']", password);
          await popup.click("#passwordNext");
        }
        await page.waitForTimeout(5_000);
      }
      // Wait for navigation back to LinkedIn
      await page.waitForTimeout(5_000);
    } else {
      await page.fill("#username", email);
      await page.fill("#password", password);
      await page.click("button[type='submit']");
      // Wait for navigation after login
      await page.waitForTimeout(5_000);
    }
    const url = page.url();
    // Successful login redirects away from /login and /checkpoint
    return !url.includes("/login") && !url.includes("/checkpoint") && !url.includes("/authwall");
  } catch {
    return false;
  }
}

/**
 * LinkedIn Easy Apply automation.
 *
 * Requires valid linkedin.com session cookies in cookiesJson (from ConnectedApp).
 * Handles multi-step Easy Apply modals including:
 *   - Contact info
 *   - Resume upload (PDF from applicant.resumePdfBase64)
 *   - Work authorization yes/no questions
 *   - Cover letter textarea
 *   - Final submit
 */
export async function applyLinkedIn(
  browser: Browser,
  jobUrl: string,
  applicant: ApplicantProfile,
  cookiesJson: string | undefined,
  coverLetter?: string,
  answers?: Record<string, string>,
  credentials?: { siteEmail: string; sitePassword: string; loginMethod?: 'email' | 'google' }
): Promise<ApplyResult> {
  const context = await browser.newContext({ userAgent: UA });

  if (cookiesJson) {
    try {
      const cookies: Cookie[] = JSON.parse(cookiesJson);
      await context.addCookies(cookies);
    } catch {
      // malformed cookies — continue, will likely hit login wall
    }
  }

  const page = await context.newPage();

  // If credentials provided, log in first before navigating to the job
  if (credentials) {
    const loggedIn = await loginLinkedIn(page, credentials.siteEmail, credentials.sitePassword, credentials.loginMethod || 'email');
    if (!loggedIn) {
      const ss = await page.screenshot();
      await context.close();
      return {
        ok: false,
        applied: false,
        message: "LinkedIn login failed — please check your email and password",
        screenshotBase64: ss.toString("base64"),
        requiresLogin: true,
      };
    }
  }

  try {
    await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // Ensure we ended up on a LinkedIn job page
    if (!page.url().includes("linkedin.com")) {
      return { ok: false, applied: false, message: "Redirected away from LinkedIn" };
    }

    // If redirected to login page the session cookies are expired / no credentials given
    if (page.url().includes("/login") || page.url().includes("/checkpoint") || page.url().includes("/authwall")) {
      const ss = await page.screenshot();
      return {
        ok: false,
        applied: false,
        message: "LinkedIn requires login — please provide your credentials",
        screenshotBase64: ss.toString("base64"),
        requiresLogin: true,
      };
    }

    // ── If this is a search results page, try to click the first job listing ──
    const currentUrl = page.url();
    const isSearchPage =
      currentUrl.includes("/jobs/search") ||
      currentUrl.includes("/jobs/collections") ||
      currentUrl.includes("keywords=");

    if (isSearchPage) {
      // If not logged in, search page can't navigate to job detail
      // Try clicking the first job card to navigate to a specific listing
      const firstJobCard = page.locator(
        "a.job-card-container__link, " +
        "a[data-control-name='jobcard_title'], " +
        ".jobs-search-results__list-item a, " +
        "li.jobs-search-results__list-item a[href*='/jobs/view/']"
      ).first();

      const cardVisible = await firstJobCard.isVisible({ timeout: 5_000 }).catch(() => false);
      if (cardVisible) {
        await firstJobCard.click();
        await page.waitForTimeout(3_000);
        // If navigated to login wall after click, require login
        if (
          page.url().includes("/login") ||
          page.url().includes("/authwall") ||
          page.url().includes("/checkpoint")
        ) {
          const ss = await page.screenshot();
          return {
            ok: false,
            applied: false,
            message: "LinkedIn requires login to view and apply to jobs — please provide your credentials",
            screenshotBase64: ss.toString("base64"),
            requiresLogin: true,
          };
        }
      } else {
        // No job cards visible without login
        const ss = await page.screenshot();
        return {
          ok: false,
          applied: false,
          message: "LinkedIn requires login to view and apply to jobs — please provide your credentials",
          screenshotBase64: ss.toString("base64"),
          requiresLogin: true,
        };
      }
    }

    // ── Find and click Easy Apply ────────────────────────────────────────────
    const easyApplyBtn = page
      .locator(
        "button.jobs-apply-button, " +
        "button[aria-label*='Easy Apply'], " +
        ".jobs-s-apply button"
      )
      .first();

    if (!(await easyApplyBtn.isVisible({ timeout: 12_000 }).catch(() => false))) {
      const ss = await page.screenshot();
      // If we're not logged in, redirect may have happened silently
      const currentUrl = page.url();
      const isLoginWall =
        currentUrl.includes("/login") ||
        currentUrl.includes("/authwall") ||
        currentUrl.includes("/checkpoint");
      return {
        ok: false,
        applied: false,
        message: isLoginWall
          ? "LinkedIn requires login — please provide your credentials"
          : "No Easy Apply button — may require external application",
        screenshotBase64: ss.toString("base64"),
        requiresLogin: isLoginWall,
      };
    }

    await easyApplyBtn.click();
    await page.waitForTimeout(2_000);

    // Write resume PDF to a temp file so Playwright can upload it
    let resumePath: string | undefined;
    if (applicant.resumePdfBase64) {
      const os = await import("os");
      const path = await import("path");
      const fs = await import("fs/promises");
      resumePath = path.join(
        os.tmpdir(),
        `resume-${Date.now()}.pdf`
      );
      await fs.writeFile(resumePath, Buffer.from(applicant.resumePdfBase64, "base64"));
    }

    // ── Step loop ────────────────────────────────────────────────────────────
    for (let step = 0; step < 12; step++) {
      await page.waitForTimeout(800);

      // ── Submit (final step) ──────────────────────────────────────────────
      const submitBtn = page.locator(
        "button[aria-label='Submit application'], button:has-text('Submit application')"
      ).first();
      if (await submitBtn.isVisible({ timeout: 1_500 }).catch(() => false)) {
        await submitBtn.click();
        await page.waitForTimeout(2_000);
        const ss = await page.screenshot();
        if (resumePath) await import("fs/promises").then(f => f.unlink(resumePath!).catch(() => {}));
        return {
          ok: true,
          applied: true,
          message: "Application submitted",
          screenshotBase64: ss.toString("base64"),
        };
      }

      // ── File upload (resume) ─────────────────────────────────────────────
      if (resumePath) {
        const fileInput = page.locator("input[type='file']").first();
        if (await fileInput.isVisible({ timeout: 1_000 }).catch(() => false)) {
          await fileInput.setInputFiles(resumePath);
          await page.waitForTimeout(1_500);
        }
      }

      // ── Text / number inputs ─────────────────────────────────────────────
      const inputs = await page
        .locator("input[type='text']:visible, input[type='tel']:visible, input[type='number']:visible, input[type='email']:visible")
        .all();

      for (const input of inputs) {
        if ((await input.inputValue()) !== "") continue;

        const label = (
          (await input.getAttribute("aria-label")) ||
          (await input.getAttribute("placeholder")) ||
          (await input.getAttribute("name")) ||
          ""
        ).toLowerCase();

        let val = "";
        if (label.includes("first")) val = applicant.firstName;
        else if (label.includes("last")) val = applicant.lastName;
        else if (label.includes("email")) val = applicant.email;
        else if (label.includes("phone") || label.includes("mobile")) val = applicant.phone ?? "";
        else if (label.includes("linkedin")) val = applicant.linkedinUrl ?? "";
        else if (label.includes("website") || label.includes("portfolio")) val = applicant.portfolioUrl ?? "";
        else if (label.includes("city") || label.includes("location")) val = applicant.location ?? "";
        else if (label.includes("year") || label.includes("experience")) val = String(applicant.yearsExperience ?? 3);
        else if (label.includes("salary") || label.includes("compensation")) val = answers?.salary ?? "";
        else {
          // Check caller-supplied answers
          const match = Object.entries(answers ?? {}).find(([k]) => label.includes(k));
          if (match) val = match[1];
        }

        if (val) await input.fill(val);
      }

      // ── Textareas (cover letter) ─────────────────────────────────────────
      const textareas = await page.locator("textarea:visible").all();
      for (const ta of textareas) {
        if ((await ta.inputValue()) !== "") continue;
        const text = coverLetter ?? applicant.resumeText.slice(0, 1_500);
        await ta.fill(text);
      }

      // ── Radio fieldsets (work auth, visa, etc.) ──────────────────────────
      const fieldsets = await page.locator("fieldset:visible").all();
      for (const fs of fieldsets) {
        const legend = ((await fs.locator("legend").textContent().catch(() => "")) ?? "").toLowerCase();

        let preferYes = true;
        if (legend.includes("sponsor") || legend.includes("require visa") || legend.includes("need authorization")) {
          preferYes = false;
        }

        const target = fs.locator(`label:has-text('${preferYes ? "Yes" : "No"}')`).first();
        if (await target.isVisible({ timeout: 500 }).catch(() => false)) {
          await target.click().catch(() => {});
        }
      }

      // ── Dropdowns ────────────────────────────────────────────────────────
      const selects = await page.locator("select:visible").all();
      for (const sel of selects) {
        const current = await sel.inputValue();
        if (current) continue;
        // Pick first non-empty option
        const opts = await sel.locator("option").all();
        for (const opt of opts) {
          const v = await opt.getAttribute("value");
          if (v && v.trim()) {
            await sel.selectOption(v);
            break;
          }
        }
      }

      // ── Next / Review ────────────────────────────────────────────────────
      const nextBtn = page
        .locator(
          "button[aria-label='Continue to next step'], " +
          "button[aria-label='Review your application'], " +
          "button:has-text('Next'), " +
          "button:has-text('Review')"
        )
        .first();

      if (await nextBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await nextBtn.click();
      } else {
        break;
      }
    }

    if (resumePath) await import("fs/promises").then(f => f.unlink(resumePath!).catch(() => {}));
    const ss = await page.screenshot();
    return {
      ok: false,
      applied: false,
      message: "Reached maximum steps without submitting",
      screenshotBase64: ss.toString("base64"),
    };
  } finally {
    await context.close();
  }
}
