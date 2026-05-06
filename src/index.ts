import express, { Request, Response, NextFunction } from "express";
import { applyToJob } from "./apply";
import { ApplyRequest } from "./types";

const app = express();
app.use(express.json({ limit: "15mb" })); // room for base64 PDF

// ── Auth middleware ───────────────────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === "/health") return next();

  const secret = process.env.BROWSER_SERVICE_SECRET;
  if (!secret) {
    // No secret configured — block all non-health requests for safety
    res.status(503).json({ error: "BROWSER_SERVICE_SECRET not configured" });
    return;
  }

  const auth = req.headers["authorization"];
  if (auth !== `Bearer ${secret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "velamini-browser-service" });
});

// ── Apply ─────────────────────────────────────────────────────────────────────
app.post("/apply", async (req: Request, res: Response) => {
  const body = req.body as Partial<ApplyRequest>;

  if (!body.jobUrl || !body.applicant?.email) {
    res.status(400).json({ error: "jobUrl and applicant.email are required" });
    return;
  }

  // Basic input validation to prevent misuse
  try {
    new URL(body.jobUrl); // throws if invalid URL
  } catch {
    res.status(400).json({ error: "jobUrl must be a valid URL" });
    return;
  }

  const request: ApplyRequest = {
    site: body.site ?? "generic",
    jobUrl: body.jobUrl,
    jobTitle: body.jobTitle,
    applicant: body.applicant,
    cookiesJson: body.cookiesJson,
    coverLetter: body.coverLetter,
    answers: body.answers,
  };

  try {
    const result = await applyToJob(request);
    res.json(result);
  } catch (err) {
    console.error("[/apply] Unhandled error:", err);
    res.status(500).json({
      ok: false,
      applied: false,
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// ── Batch apply (for cron use) ────────────────────────────────────────────────
app.post("/apply/batch", async (req: Request, res: Response) => {
  const jobs: ApplyRequest[] = req.body?.jobs;

  if (!Array.isArray(jobs) || jobs.length === 0) {
    res.status(400).json({ error: "jobs array required" });
    return;
  }

  if (jobs.length > 10) {
    res.status(400).json({ error: "Maximum 10 jobs per batch" });
    return;
  }

  const results: { jobUrl: string; result: object }[] = [];

  for (const job of jobs) {
    try {
      const result = await applyToJob(job);
      results.push({ jobUrl: job.jobUrl, result });
    } catch (err) {
      results.push({
        jobUrl: job.jobUrl,
        result: { ok: false, applied: false, message: String(err) },
      });
    }
  }

  res.json({ results });
});

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`velamini-browser-service listening on :${PORT}`);
});
