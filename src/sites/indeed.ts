import { Browser, Cookie, Page } from "playwright";
import { ApplicantProfile, ApplyResult } from "../types";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function loginIndeed(page: Page, email: string, password: string): Promise<boolean> {
  try {
    await page.goto("https://secure.indeed.com/auth", {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    // Indeed uses an email-first flow
    const emailInput = page.locator("input[type='email'], input[name='__email']").first();
    if (await emailInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await emailInput.fill(email);
      await page.locator("button[type='submit']").first().click();
      await page.waitForTimeout(2_000);
    }
    const passwordInput = page.locator("input[type='password']").first();
    if (await passwordInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await passwordInput.fill(password);
      await page.locator("button[type='submit']").first().click();
      await page.waitForTimeout(4_000);
    }
    return !page.url().includes("/auth") && !page.url().includes("/login");
  } catch {
    return false;
  }
}

/**
 * Indeed "Easily Apply" automation.
 *
 * Indeed's quick-apply widget is an iframe served from smartapply.indeed.com.
 * The flow:
 *   1. Land on job page, click "Apply now" / "Easily Apply" button
 *   2. Playwright follows into the smartapply flow (same context)
 *   3. Fill contact info, upload resume, answer screening questions
 *   4. Submit
 */
export async function applyIndeed(
  browser: Browser,
  jobUrl: string,
  applicant: ApplicantProfile,
  cookiesJson: string | undefined,
  coverLetter?: string,
  answers?: Record<string, string>,
  credentials?: { siteEmail: string; sitePassword: string }
): Promise<ApplyResult> {
  const context = await browser.newContext({
    userAgent: UA,
    locale: "en-US",
  });

  if (cookiesJson) {
    try {
      const cookies: Cookie[] = JSON.parse(cookiesJson);
      await context.addCookies(cookies);
    } catch {}
  }

  const page = await context.newPage();

  // Log in first if credentials provided
  if (credentials) {
    const loggedIn = await loginIndeed(page, credentials.siteEmail, credentials.sitePassword);
    if (!loggedIn) {
      const ss = await page.screenshot();
      await context.close();
      return {
        ok: false,
        applied: false,
        message: "Indeed login failed — please check your email and password",
        screenshotBase64: ss.toString("base64"),
        requiresLogin: true,
      };
    }
  }

  try {
    await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    if (!page.url().includes("indeed.com")) {
      return { ok: false, applied: false, message: "Redirected away from Indeed" };
    }

    // ── Apply button ─────────────────────────────────────────────────────────
    const applyBtn = page
      .locator(
        "button#indeedApplyButton, " +
        "a#indeedApplyButton, " +
        "button[class*='indeed-apply'], " +
        "span.indeed-apply-button, " +
        "button:has-text('Apply now'), " +
        "button:has-text('Easily apply')"
      )
      .first();

    if (!(await applyBtn.isVisible({ timeout: 12_000 }).catch(() => false))) {
      const ss = await page.screenshot();
      const currentUrl = page.url();
      const isLoginWall = currentUrl.includes("/auth") || currentUrl.includes("/login");
      return {
        ok: false,
        applied: false,
        message: isLoginWall
          ? "Indeed requires login — please provide your credentials"
          : "No apply button found on Indeed page",
        screenshotBase64: ss.toString("base64"),
        requiresLogin: isLoginWall,
      };
    }

    await applyBtn.click();
    await page.waitForTimeout(2_500);

    // Indeed may open a new tab or navigate in-page
    const pages = context.pages();
    const applyPage = pages[pages.length - 1]; // last tab is most recent

    // Temp file for resume PDF
    let resumePath: string | undefined;
    if (applicant.resumePdfBase64) {
      const os = await import("os");
      const path = await import("path");
      const fs = await import("fs/promises");
      resumePath = path.join(os.tmpdir(), `resume-indeed-${Date.now()}.pdf`);
      await fs.writeFile(resumePath, Buffer.from(applicant.resumePdfBase64, "base64"));
    }

    // ── Step loop ─────────────────────────────────────────────────────────────
    for (let step = 0; step < 10; step++) {
      await applyPage.waitForTimeout(1_000);

      // Submit
      const submitBtn = applyPage
        .locator("button[type='submit']:has-text('Submit'), button:has-text('Submit your application')")
        .first();
      if (await submitBtn.isVisible({ timeout: 1_500 }).catch(() => false)) {
        await submitBtn.click();
        await applyPage.waitForTimeout(2_500);
        const ss = await applyPage.screenshot();
        if (resumePath) await import("fs/promises").then(f => f.unlink(resumePath!).catch(() => {}));
        return {
          ok: true,
          applied: true,
          message: "Indeed application submitted",
          screenshotBase64: ss.toString("base64"),
        };
      }

      // Resume upload
      if (resumePath) {
        const fileInput = applyPage.locator("input[type='file']").first();
        if (await fileInput.isVisible({ timeout: 800 }).catch(() => false)) {
          await fileInput.setInputFiles(resumePath);
          await applyPage.waitForTimeout(2_000);
        }
      }

      // Text inputs
      const inputs = await applyPage
        .locator("input[type='text']:visible, input[type='email']:visible, input[type='tel']:visible")
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
        else if (label.includes("phone")) val = applicant.phone ?? "";
        else if (label.includes("city") || label.includes("location")) val = applicant.location ?? "";
        else {
          const match = Object.entries(answers ?? {}).find(([k]) => label.includes(k));
          if (match) val = match[1];
        }
        if (val) await input.fill(val);
      }

      // Textarea (cover letter / qualifications)
      const textareas = await applyPage.locator("textarea:visible").all();
      for (const ta of textareas) {
        if ((await ta.inputValue()) !== "") continue;
        await ta.fill((coverLetter ?? applicant.resumeText).slice(0, 1_500));
      }

      // Yes/No radio questions
      const questions = await applyPage.locator(".ia-Questions-item:visible, .css-question:visible, [data-testid*='question']:visible").all();
      for (const q of questions) {
        const qText = ((await q.textContent()) ?? "").toLowerCase();
        const preferYes = !qText.includes("sponsor") && !qText.includes("require visa");
        const yesLabel = q.locator(`label:has-text('${preferYes ? "Yes" : "No"}')`).first();
        if (await yesLabel.isVisible({ timeout: 400 }).catch(() => false)) {
          await yesLabel.click().catch(() => {});
        }
      }

      // Select dropdowns
      const selects = await applyPage.locator("select:visible").all();
      for (const sel of selects) {
        if (await sel.inputValue()) continue;
        const opts = await sel.locator("option").all();
        for (const opt of opts) {
          const v = await opt.getAttribute("value");
          if (v && v.trim() && v !== "null") { await sel.selectOption(v); break; }
        }
      }

      // Next / Continue
      const nextBtn = applyPage
        .locator("button[type='button']:has-text('Continue'), button:has-text('Next'), button:has-text('Review')")
        .first();
      if (await nextBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await nextBtn.click();
      } else {
        break;
      }
    }

    if (resumePath) await import("fs/promises").then(f => f.unlink(resumePath!).catch(() => {}));
    const ss = await applyPage.screenshot();
    return {
      ok: false,
      applied: false,
      message: "Completed steps but did not submit",
      screenshotBase64: ss.toString("base64"),
    };
  } finally {
    await context.close();
  }
}
