import { Browser, BrowserContext, Cookie, Page } from "playwright";
import { ApplicantProfile, ApplyResult } from "../types";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Attempt to log in to LinkedIn using email + password or Google account.
 * Returns true if login succeeded, false otherwise.
 */
async function loginLinkedIn(page: Page, email: string, password: string, loginMethod: 'email' | 'google' = 'email'): Promise<{ success: boolean; error?: string }> {
  try {
    await page.goto("https://www.linkedin.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });

    // Google login via headless browser is not supported — OAuth flows
    // require a real browser session with cookies from an interactive login.
    if (loginMethod === 'google') {
      // Try clicking "Sign in with Google" and fill the Google login form
      const googleBtn = page.locator("a[data-tracking-control-name='homepage-guest_google-sign-in-provider'], a:has-text('Sign in with Google')").first();
      const googleBtnVisible = await googleBtn.isVisible({ timeout: 5_000 }).catch(() => false);
      if (!googleBtnVisible) {
        return { success: false, error: "Google Sign-In button not found on LinkedIn — try Email & Password instead" };
      }
      await googleBtn.click();
      await page.waitForTimeout(4_000);

      // Fill Google email
      const googleEmail = page.locator("input[type='email']").first();
      if (!(await googleEmail.isVisible({ timeout: 8_000 }).catch(() => false))) {
        return { success: false, error: "Google login page did not load — try Email & Password instead" };
      }
      await googleEmail.fill(email);
      await page.locator("button:has-text('Next'), #identifierNext").first().click();
      await page.waitForTimeout(3_000);

      // Fill Google password
      const googlePassword = page.locator("input[type='password']").first();
      if (!(await googlePassword.isVisible({ timeout: 8_000 }).catch(() => false))) {
        return { success: false, error: "Google password page did not load — try Email & Password instead" };
      }
      await googlePassword.fill(password);
      await page.locator("button:has-text('Next'), #passwordNext").first().click();
      await page.waitForTimeout(6_000);

      const url = page.url();
      if (url.includes("linkedin.com/feed") || url.includes("linkedin.com/jobs") || url.includes("linkedin.com/in/")) {
        return { success: true };
      }
      const pageContent = await page.textContent("body") || "";
      if (pageContent.includes("2-Step") || pageContent.includes("verify") || pageContent.includes("Verify")) {
        return { success: false, error: "Google account requires 2-step verification — try Email & Password instead" };
      }
      return { success: false, error: "Google login did not complete — try Email & Password instead" };
    }

    // ── Email / password login ──────────────────────────────────────────────
    const emailField = page.locator("[name='session_key']");
    const passwordField = page.locator("[name='session_password']");
    const submitBtn = page.locator("button[type='submit']");

    if (!(await emailField.isVisible({ timeout: 5000 }))) {
      return { success: false, error: "LinkedIn login page did not load properly — email field not found" };
    }

    // Fill email and password
    await emailField.fill(email);
    await passwordField.fill(password);

    // Click submit
    await submitBtn.click();

    // Wait for navigation after login
    await page.waitForTimeout(5_000);

    const url = page.url();
    // Successful login redirects to /feed, /jobs, or profile pages
    if (
      url.includes("linkedin.com/feed") ||
      url.includes("linkedin.com/jobs") ||
      url.includes("linkedin.com/in/")
    ) {
      return { success: true };
    }

    if (url.includes("/login") || url.includes("/checkpoint") || url.includes("/authwall") || url.includes("/challenge")) {
      const pageContent = await page.textContent("body") || "";
      if (pageContent.includes("incorrect") || pageContent.includes("Invalid") || pageContent.includes("wrong")) {
        return { success: false, error: "Invalid LinkedIn credentials — please check your email and password" };
      }
      if (
        pageContent.includes("challenge") ||
        pageContent.includes("verification") ||
        pageContent.includes("security check") ||
        pageContent.includes("unusual activity") ||
        pageContent.includes("verify your identity") ||
        pageContent.includes("verify")
      ) {
        return { success: false, error: "LinkedIn requires additional verification (CAPTCHA or security check) — try again later" };
      }
      return { success: false, error: "LinkedIn login failed — possibly blocked by security checks" };
    }

    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: `LinkedIn login error: ${errorMsg}` };
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
    const loginResult = await loginLinkedIn(page, credentials.siteEmail, credentials.sitePassword, credentials.loginMethod || 'email');
    if (!loginResult.success) {
      const ss = await page.screenshot();
      await context.close();
      return {
        ok: false,
        applied: false,
        message: loginResult.error || "LinkedIn login failed — please check your credentials",
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
    if (page.url().includes("/login") || page.url().includes("/checkpoint") || page.url().includes("/authwall") || page.url().includes("/challenge")) {
      const pageContent = await page.textContent("body") || "";
      let message = "LinkedIn requires login — please provide your credentials";
      if (pageContent.includes("challenge") || pageContent.includes("verification") || pageContent.includes("security check") || pageContent.includes("unusual activity")) {
        message = "LinkedIn blocked the login with a security check — try again later or use a different network";
      }
      const ss = await page.screenshot();
      return {
        ok: false,
        applied: false,
        message,
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
          page.url().includes("/checkpoint") ||
          page.url().includes("/challenge")
        ) {
          const pageContent = await page.textContent("body") || "";
          let message = "LinkedIn requires login to view and apply to jobs — please provide your credentials";
          if (pageContent.includes("challenge") || pageContent.includes("verification") || pageContent.includes("security check") || pageContent.includes("unusual activity")) {
            message = "LinkedIn blocked the login with a security check — try again later or use a different network";
          }
          const ss = await page.screenshot();
          return {
            ok: false,
            applied: false,
            message,
            screenshotBase64: ss.toString("base64"),
            requiresLogin: true,
          };
        }
      } else {
        // No job cards visible without login
        const pageContent = await page.textContent("body") || "";
        let message = "LinkedIn requires login to view and apply to jobs — please provide your credentials";
        if (pageContent.includes("challenge") || pageContent.includes("verification") || pageContent.includes("security check") || pageContent.includes("unusual activity")) {
          message = "LinkedIn blocked the login with a security check — try again later or use a different network";
        }
        const ss = await page.screenshot();
        return {
          ok: false,
          applied: false,
          message,
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
        currentUrl.includes("/checkpoint") ||
        currentUrl.includes("/challenge");
      let message = isLoginWall
        ? "LinkedIn requires login — please provide your credentials"
        : "No Easy Apply button — may require external application";
      if (isLoginWall) {
        const pageContent = await page.textContent("body") || "";
        if (pageContent.includes("challenge") || pageContent.includes("verification") || pageContent.includes("security check") || pageContent.includes("unusual activity")) {
          message = "LinkedIn blocked the login with a security check — try again later or use a different network";
        }
      }
      return {
        ok: false,
        applied: false,
        message,
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
