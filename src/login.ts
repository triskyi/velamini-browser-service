import { chromium } from "playwright";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface LoginRequest {
  site: "linkedin" | "indeed";
  email: string;
  password: string;
  loginMethod?: "email" | "google";
}

export interface LoginResult {
  ok: boolean;
  cookiesJson?: string;
  error?: string;
}

export async function loginSite(req: LoginRequest): Promise<LoginResult> {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  try {
    const context = await browser.newContext({ userAgent: UA });
    const page = await context.newPage();

    if (req.site === "linkedin") {
      await page.goto("https://www.linkedin.com/login", {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });

      if (req.loginMethod === "google") {
        const googleBtn = page
          .locator("a[data-tracking-control-name='homepage-guest_google-sign-in-provider'], a:has-text('Sign in with Google')")
          .first();
        const visible = await googleBtn.isVisible({ timeout: 5_000 }).catch(() => false);
        if (!visible) {
          return { ok: false, error: "Google Sign-In button not found — try Email & Password instead" };
        }
        await googleBtn.click();
        await page.waitForTimeout(4_000);

        const googleEmail = page.locator("input[type='email']").first();
        if (!(await googleEmail.isVisible({ timeout: 8_000 }).catch(() => false))) {
          return { ok: false, error: "Google login page did not load — try Email & Password instead" };
        }
        await googleEmail.fill(req.email);
        await page.locator("button:has-text('Next'), #identifierNext").first().click();
        await page.waitForTimeout(3_000);

        const googlePwd = page.locator("input[type='password']").first();
        if (!(await googlePwd.isVisible({ timeout: 8_000 }).catch(() => false))) {
          return { ok: false, error: "Google password page did not load — try Email & Password instead" };
        }
        await googlePwd.fill(req.password);
        await page.locator("button:has-text('Next'), #passwordNext").first().click();
        await page.waitForTimeout(6_000);
      } else {
        const emailField = page.locator("[name='session_key']");
        const passwordField = page.locator("[name='session_password']");
        const submitBtn = page.locator("button[type='submit']");

        if (!(await emailField.isVisible({ timeout: 5_000 }).catch(() => false))) {
          return { ok: false, error: "LinkedIn login page did not load — email field not found" };
        }

        await emailField.fill(req.email);
        await passwordField.fill(req.password);
        await submitBtn.click();
        await page.waitForTimeout(5_000);
      }

      const url = page.url();
      if (
        url.includes("/login") ||
        url.includes("/checkpoint") ||
        url.includes("/authwall") ||
        url.includes("/challenge")
      ) {
        const body = (await page.textContent("body")) ?? "";
        if (body.includes("incorrect") || body.includes("Invalid") || body.includes("wrong")) {
          return { ok: false, error: "Invalid LinkedIn credentials — check your email and password" };
        }
        if (
          body.includes("2-Step") ||
          body.includes("verification") ||
          body.includes("security check") ||
          body.includes("unusual activity") ||
          body.includes("verify")
        ) {
          return { ok: false, error: "LinkedIn requires additional verification — try again later or from a different network" };
        }
        return { ok: false, error: "LinkedIn login failed — please check your credentials" };
      }

      // Grab all linkedin.com cookies for the session
      const cookies = await context.cookies("https://www.linkedin.com");
      if (cookies.length === 0) {
        return { ok: false, error: "LinkedIn login appeared to succeed but no session cookies were found" };
      }

      await context.close();
      return { ok: true, cookiesJson: JSON.stringify(cookies) };
    }

    if (req.site === "indeed") {
      // Indeed doesn't have a simple form login that works headlessly — return helpful error
      return { ok: false, error: "Indeed login via automation is not supported yet" };
    }

    return { ok: false, error: "Unsupported site" };
  } finally {
    await browser.close();
  }
}
