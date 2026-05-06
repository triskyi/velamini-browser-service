# velamini-browser-service

Playwright-powered browser automation microservice that applies to external job listings on behalf of Velamini users.

Deployed as a standalone service on [Railway](https://railway.app). Called by the Velamini Vercel cron (`/api/cron/auto-apply`) when `BROWSER_SERVICE_URL` is configured.

## Supported job sites

| Site | Adapter | Notes |
|---|---|---|
| LinkedIn | `src/sites/linkedin.ts` | Easy Apply multi-step modal, resume upload, work auth questions |
| Indeed | `src/sites/indeed.ts` | Easily Apply smartapply widget, multi-step, screening questions |
| Generic | `src/sites/generic.ts` | Label-heuristic form fill — works for kigalijob.com, kora.rw, job-in-rwanda.com, UN Careers, etc. |

## API

All routes require `Authorization: Bearer <BROWSER_SERVICE_SECRET>` except `/health`.

### `GET /health`
Returns `{ ok: true }`. Used by Railway healthcheck.

### `POST /apply`
Apply to a single job.

```json
{
  "site": "linkedin" | "indeed" | "generic",
  "jobUrl": "https://...",
  "applicant": {
    "name": "Jane Doe",
    "firstName": "Jane",
    "lastName": "Doe",
    "email": "jane@example.com",
    "phone": "+1234567890",
    "location": "Kigali, Rwanda",
    "resumeText": "Plain text resume...",
    "resumePdfBase64": "<base64 PDF>",
    "linkedinUrl": "https://linkedin.com/in/janedoe",
    "yearsExperience": 5
  },
  "cookiesJson": "[{...playwright cookie objects...}]",
  "coverLetter": "Optional cover letter text...",
  "answers": {
    "salary": "60000",
    "start": "immediately",
    "sponsor": "no"
  }
}
```

Response:
```json
{
  "ok": true,
  "applied": true,
  "message": "Application submitted",
  "screenshotBase64": "<base64 PNG>"
}
```

### `POST /apply/batch`
Apply to up to 10 jobs in one request. Body: `{ "jobs": [<ApplyRequest>, ...] }`.

## Local development

```sh
cp .env.example .env
# Edit .env — set BROWSER_SERVICE_SECRET

npm install
npx playwright install chromium
npm run dev          # ts-node (requires ts-node installed)
# or
npm run build && npm start
```

Test:
```sh
curl http://localhost:3001/health

curl -X POST http://localhost:3001/apply \
  -H "Authorization: Bearer your-secret" \
  -H "Content-Type: application/json" \
  -d '{"site":"generic","jobUrl":"https://example.com/jobs/1","applicant":{"name":"Test","firstName":"Test","lastName":"User","email":"test@example.com","resumeText":"5 years React"}}'
```

## Deploy to Railway

1. Move this folder to its own git repository
2. Push to GitHub
3. In Railway: **New Project → Deploy from GitHub repo**
4. Set environment variables:

| Variable | Value |
|---|---|
| `BROWSER_SERVICE_SECRET` | `openssl rand -hex 32` |
| `PORT` | Set automatically by Railway |

5. Copy the Railway public URL
6. In Vercel (main app), add:

| Variable | Value |
|---|---|
| `BROWSER_SERVICE_URL` | `https://your-service.railway.app` |
| `BROWSER_SERVICE_SECRET` | Same secret as above |

Railway will use the `Dockerfile` automatically. The service exposes `/health` for the Railway healthcheck (configured in `railway.json`).

## Session cookies (LinkedIn / Indeed)

LinkedIn and Indeed require valid session cookies to bypass login. These are stored encrypted in the `ConnectedApp` table (`accessToken` field) on the main platform when users connect their accounts.

The cron passes `cookiesJson` as a JSON-serialised array of [Playwright Cookie objects](https://playwright.dev/docs/api/class-browsercontext#browser-context-add-cookies).

If cookies are expired the adapter returns `{ ok: false, applied: false, message: "session expired" }` and the cron skips that job without crashing.
