import { Browser, Cookie } from "playwright";
import { ApplicantProfile, ApplyResult } from "../types";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Generic form-fill adapter — works for most regional job boards
 * (kigalijob.com, job-in-rwanda.com, kora.rw, UN Careers, etc.)
 *
 * Strategy:
 *   1. Navigate to the job URL
 *   2. Look for "Apply" / "Apply Now" buttons, follow them
 *   3. Fill every input/textarea by matching label text heuristics
 *   4. Upload resume PDF if a file input is present
 *   5. Submit the form
 */
export async function applyGeneric(
  browser: Browser,
  jobUrl: string,
  applicant: ApplicantProfile,
  cookiesJson: string | undefined,
  coverLetter?: string,
  answers?: Record<string, string>
): Promise<ApplyResult> {
  const context = await browser.newContext({
    userAgent: UA,
    locale: "en-US",
    acceptDownloads: false,
  });

  if (cookiesJson) {
    try {
      const cookies: Cookie[] = JSON.parse(cookiesJson);
      await context.addCookies(cookies);
    } catch {}
  }

  const page = await context.newPage();

  try {
    await page.goto(jobUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // ── Find and follow an "Apply" link/button ───────────────────────────────
    const applyLink = page
      .locator(
        "a:has-text('Apply Now'), a:has-text('Apply now'), a:has-text('Apply for this job'), " +
        "button:has-text('Apply Now'), button:has-text('Apply now'), " +
        "a:has-text('Submit Application'), input[value*='Apply']"
      )
      .first();

    if (await applyLink.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await applyLink.click();
      await page.waitForTimeout(2_500);
    }
    // If no button, assume the current page IS the form

    // Detect the best form on the page
    const form = page.locator("form").first();
    const formExists = await form.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!formExists) {
      const ss = await page.screenshot();
      return {
        ok: false,
        applied: false,
        message: "No application form found on this page",
        screenshotBase64: ss.toString("base64"),
      };
    }

    // ── Resume temp file ─────────────────────────────────────────────────────
    let resumePath: string | undefined;
    if (applicant.resumePdfBase64) {
      const os = await import("os");
      const path = await import("path");
      const fs = await import("fs/promises");
      resumePath = path.join(os.tmpdir(), `resume-generic-${Date.now()}.pdf`);
      await fs.writeFile(resumePath, Buffer.from(applicant.resumePdfBase64, "base64"));
    }

    // ── Fill all visible inputs ──────────────────────────────────────────────
    await fillAllInputs(page, applicant, coverLetter, answers, resumePath);

    // Some sites use a two-step form — click Next if present
    const nextBtn = page
      .locator("button:has-text('Next'), input[value='Next'], a:has-text('Next')")
      .first();
    if (await nextBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(2_000);
      await fillAllInputs(page, applicant, coverLetter, answers, resumePath);
    }

    // ── Submit ───────────────────────────────────────────────────────────────
    const submitBtn = page
      .locator(
        "button[type='submit'], input[type='submit'], " +
        "button:has-text('Submit'), button:has-text('Send Application'), " +
        "button:has-text('Apply'), input[value='Submit']"
      )
      .first();

    if (!(await submitBtn.isVisible({ timeout: 4_000 }).catch(() => false))) {
      const ss = await page.screenshot();
      if (resumePath) await import("fs/promises").then(f => f.unlink(resumePath!).catch(() => {}));
      return {
        ok: false,
        applied: false,
        message: "Could not find submit button",
        screenshotBase64: ss.toString("base64"),
      };
    }

    await submitBtn.click();
    await page.waitForTimeout(3_000);

    if (resumePath) await import("fs/promises").then(f => f.unlink(resumePath!).catch(() => {}));
    const ss = await page.screenshot();

    // Heuristic success detection: look for "thank you" / "received" in page
    const bodyText = (await page.textContent("body") ?? "").toLowerCase();
    const applied =
      bodyText.includes("thank you") ||
      bodyText.includes("received") ||
      bodyText.includes("submitted") ||
      bodyText.includes("success") ||
      bodyText.includes("application sent");

    return {
      ok: true,
      applied,
      message: applied
        ? "Application submitted (success message detected)"
        : "Form submitted — please verify via screenshot",
      screenshotBase64: ss.toString("base64"),
    };
  } finally {
    await context.close();
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function fillAllInputs(
  page: import("playwright").Page,
  applicant: ApplicantProfile,
  coverLetter: string | undefined,
  answers: Record<string, string> | undefined,
  resumePath: string | undefined
) {
  // File upload
  if (resumePath) {
    const fileInput = page.locator("input[type='file']").first();
    if (await fileInput.isVisible({ timeout: 800 }).catch(() => false)) {
      await fileInput.setInputFiles(resumePath);
      await page.waitForTimeout(1_500);
    }
  }

  // Discover label text for each input via associated <label> or aria-labelledby
  const inputs = await page
    .locator("input:not([type='file']):not([type='hidden']):not([type='submit']):not([type='checkbox']):not([type='radio']):visible")
    .all();

  for (const input of inputs) {
    if ((await input.inputValue()).trim() !== "") continue;

    const label = await resolveLabel(input);
    const val = resolveValue(label, applicant, answers);
    if (val !== null) await input.fill(val);
  }

  // Textareas
  const textareas = await page.locator("textarea:visible").all();
  for (const ta of textareas) {
    if ((await ta.inputValue()).trim() !== "") continue;
    await ta.fill((coverLetter ?? applicant.resumeText).slice(0, 2_000));
  }

  // Select dropdowns — choose first non-empty option
  const selects = await page.locator("select:visible").all();
  for (const sel of selects) {
    if ((await sel.inputValue()).trim()) continue;
    const opts = await sel.locator("option").all();
    for (const opt of opts) {
      const v = await opt.getAttribute("value");
      if (v && v.trim() && v.toLowerCase() !== "select" && v !== "0" && v !== "null") {
        await sel.selectOption(v);
        break;
      }
    }
  }

  // Checkboxes labelled "terms" / "agree" — check them
  const checkboxes = await page
    .locator("input[type='checkbox']:visible")
    .all();
  for (const cb of checkboxes) {
    const label = await resolveLabel(cb);
    if (label.includes("agree") || label.includes("terms") || label.includes("privacy") || label.includes("consent")) {
      await cb.check().catch(() => {});
    }
  }
}

async function resolveLabel(
  el: import("playwright").Locator
): Promise<string> {
  const page = el.page();

  // aria-label
  const ariaLabel = await el.getAttribute("aria-label").catch(() => "");
  if (ariaLabel) return ariaLabel.toLowerCase();

  // placeholder
  const placeholder = await el.getAttribute("placeholder").catch(() => "");
  if (placeholder) return placeholder.toLowerCase();

  // name attribute
  const name = await el.getAttribute("name").catch(() => "");

  // Find associated <label for="id">
  const id = await el.getAttribute("id").catch(() => "");
  if (id) {
    const labelText = await page
      .locator(`label[for="${id}"]`)
      .textContent()
      .catch(() => "");
    if (labelText?.trim()) return labelText.toLowerCase();
  }

  // aria-labelledby
  const labelledBy = await el.getAttribute("aria-labelledby").catch(() => "");
  if (labelledBy) {
    const labelText = await page
      .locator(`#${labelledBy}`)
      .textContent()
      .catch(() => "");
    if (labelText?.trim()) return labelText.toLowerCase();
  }

  return (name ?? "").toLowerCase();
}

function resolveValue(
  label: string,
  applicant: ApplicantProfile,
  answers: Record<string, string> | undefined
): string | null {
  if (!label) return null;

  if (label.includes("first name") || label === "first") return applicant.firstName;
  if (label.includes("last name") || label === "last" || label === "surname") return applicant.lastName;
  if (label.includes("full name") || label === "name") return applicant.name;
  if (label.includes("email")) return applicant.email;
  if (label.includes("phone") || label.includes("mobile") || label.includes("tel")) return applicant.phone ?? "";
  if (label.includes("linkedin")) return applicant.linkedinUrl ?? "";
  if (label.includes("portfolio") || label.includes("website") || label.includes("url")) return applicant.portfolioUrl ?? "";
  if (label.includes("city") || label.includes("location") || label.includes("address")) return applicant.location ?? "";
  if (label.includes("year") && label.includes("experience")) return String(applicant.yearsExperience ?? 3);

  // Check caller-supplied custom answers
  const match = Object.entries(answers ?? {}).find(([k]) => label.includes(k));
  if (match) return match[1];

  return null;
}
