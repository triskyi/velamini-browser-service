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
}

export interface ApplyResult {
  ok: boolean;
  applied: boolean;
  message: string;
  /** Base64 PNG screenshot taken at the end of the flow */
  screenshotBase64?: string;
}
