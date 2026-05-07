// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require("playwright-extra");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromium.use(StealthPlugin());

import { ApplyRequest, ApplyResult, SupportedSite } from "./types";
import { applyLinkedIn } from "./sites/linkedin";
import { applyIndeed } from "./sites/indeed";
import { applyGeneric } from "./sites/generic";

/** Infer site from URL when the caller passes site="generic" with a known domain */
function detectSite(url: string, declared: SupportedSite): SupportedSite {
  if (url.includes("linkedin.com")) return "linkedin";
  if (url.includes("indeed.com")) return "indeed";
  return declared;
}

export async function applyToJob(req: ApplyRequest): Promise<ApplyResult> {
  const site = detectSite(req.jobUrl, req.site);

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  try {
    switch (site) {
      case "linkedin":
        return await applyLinkedIn(
          browser,
          req.jobUrl,
          req.applicant,
          req.cookiesJson,
          req.coverLetter,
          req.answers,
          req.credentials
        );

      case "indeed":
        return await applyIndeed(
          browser,
          req.jobUrl,
          req.applicant,
          req.cookiesJson,
          req.coverLetter,
          req.answers,
          req.credentials
        );

      case "generic":
      default:
        return await applyGeneric(
          browser,
          req.jobUrl,
          req.applicant,
          req.cookiesJson,
          req.coverLetter,
          req.answers,
          req.jobTitle
        );
    }
  } finally {
    await browser.close();
  }
}
