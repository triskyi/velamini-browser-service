export interface ApplicantProfile {
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  location?: string;
  /** Plain-text resume content (used for text fields / cover letter fallback) */
  resumeText: string;
  /** Original filename for the uploaded PDF */
  resumeFilename?: string;
  /** Base64-encoded PDF resume */
  resumePdfBase64?: string;
  linkedinUrl?: string;
  portfolioUrl?: string;
  yearsExperience?: number;
}

export type SupportedSite = "linkedin" | "indeed" | "generic";

export interface ApplyRequest {
  /** Target site — drives which adapter is used */
  site: SupportedSite;
  /** Full URL to the job listing */
  jobUrl: string;
  /** Optional job title used to find the correct role on company job boards */
  jobTitle?: string;
  applicant: ApplicantProfile;
  /**
   * JSON-serialised Playwright cookie array for the user's session on this site.
   * Stored encrypted in ConnectedApp.accessToken on the main platform.
   */
  cookiesJson?: string;
  coverLetter?: string;
  /**
   * Free-form answers to anticipated screening questions.
   * Key = lowercase keyword that may appear in a question label.
   * e.g. { "salary": "60000", "start": "immediately" }
   */
  answers?: Record<string, string>;
  /**
   * Site credentials supplied by the user when the site requires login.
   * Used for a one-time login session — never persisted.
   */
  credentials?: { siteEmail: string; sitePassword: string; loginMethod?: 'email' | 'google' };
}

export interface ApplyResult {
  ok: boolean;
  applied: boolean;
  message: string;
  /** Base64 PNG screenshot taken at the end of the flow */
  screenshotBase64?: string;
  /** True when the site blocked access due to missing/expired login */
  requiresLogin?: boolean;
  /**
   * True when the job page requires email-based application.
   * The Next.js layer will send the email via Resend using the user's resume.
   */
  applyByEmail?: boolean;
  /** The employer email address to send the application to */
  applicationEmail?: string;
  /** The job title extracted from the page (used in email subject) */
  emailSubjectHint?: string;
}
