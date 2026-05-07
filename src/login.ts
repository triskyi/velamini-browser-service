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
  // Set HEADLESS=false locally to watch the browser window for debugging
  const headless = process.env.HEADLESS !== "false";

  const browser = await chromium.launch({
    headless,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  try {
    const context = await browser.newContext({ userAgent: UA });
    const page = await context.newPage();

    if (req.site === "linkedin") {
      // domcontentloaded is reliable; we wait for the email field explicitly below
      await page.goto("https://www.linkedin.com/login", {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });

      if (req.loginMethod === "google") {
        // LinkedIn hides the "Continue with Google" button in headless/automated browsers.
        // Google OAuth popups also block automated logins server-side.
        // The only reliable path is email + LinkedIn password.
        return {
          ok: false,
          error:
            "Google sign-in cannot be automated. Please set a LinkedIn password at linkedin.com → Settings → Sign In & Security → Change Password, then use Email & Password login.",
        };
      } else {
        // LinkedIn redesigned their login — inputs use type attributes, not name="session_key"
        const emailField    = page.locator("input[type='email']").first();
        const passwordField = page.locator("input[type='password']").first();
        const submitBtn     = page.locator("button:has-text('Sign in')").first();

        if (!(await emailField.isVisible({ timeout: 8_000 }).catch(() => false))) {
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
        if (body.includes("one-time link") || body.includes("emailed") || body.includes("check your email")) {
          return {
            ok: false,
            error:
              "Your LinkedIn account has no password (created with Google). Please go to linkedin.com → Settings → Sign In & Security → Change Password to set one, then retry.",
          };
        }
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
          return {
            ok: false,
            error: "LinkedIn requires additional verification — try again later or from a different network",
          };
        }
        return { ok: false, error: "LinkedIn login failed — please check your credentials" };
      }

      const cookies = await context.cookies("https://www.linkedin.com");
      if (cookies.length === 0) {
        return { ok: false, error: "LinkedIn login appeared to succeed but no session cookies were found" };
      }

      await context.close();
      return { ok: true, cookiesJson: JSON.stringify(cookies) };
    }

    if (req.site === "indeed") {
      return { ok: false, error: "Indeed login via automation is not supported yet" };
    }

    return { ok: false, error: "Unsupported site" };
  } finally {
    await browser.close();
  }
}
