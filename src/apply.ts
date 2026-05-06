import { chromium } from "playwright";
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
          req.answers
        );

      case "indeed":
        return await applyIndeed(
          browser,
          req.jobUrl,
          req.applicant,
          req.cookiesJson,
          req.coverLetter,
          req.answers
        );

      case "generic":
      default:
        return await applyGeneric(
          browser,
          req.jobUrl,
          req.applicant,
          req.cookiesJson,
          req.coverLetter,
          req.answers
        );
    }
  } finally {
    await browser.close();
  }
}
