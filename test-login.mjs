/**
 * Quick local test for the /login endpoint.
 *
 * 1. Start the service first (in another terminal):
 *      cd browser-service
 *      HEADLESS=false BROWSER_SERVICE_SECRET=test npx ts-node --esm src/index.ts
 *
 * 2. Then run this script (fill in your real password below):
 *      node test-login.mjs
 */

const SECRET = "test";
const BASE   = "http://localhost:3001";

const EMAIL    = "tresorbi29@gmail.com";
const PASSWORD = "YOUR_LINKEDIN_OR_GOOGLE_PASSWORD";  // ← put real password here
const METHOD   = "google"; // "email" or "google"

async function main() {
  console.log(`\nTesting /login  (method=${METHOD})  ...`);

  const res = await fetch(`${BASE}/login`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${SECRET}`,
    },
    body: JSON.stringify({ site: "linkedin", email: EMAIL, password: PASSWORD, loginMethod: METHOD }),
  });

  const data = await res.json();
  console.log("\nHTTP status:", res.status);

  if (data.ok) {
    const cookies = JSON.parse(data.cookiesJson);
    console.log(`✅  Login succeeded — got ${cookies.length} LinkedIn cookies`);
    // print the li_at session cookie if present
    const liAt = cookies.find((c) => c.name === "li_at");
    if (liAt) console.log("   li_at:", liAt.value.slice(0, 30) + "…");
  } else {
    console.log("❌  Login failed:", data.error);
  }
}

main().catch((err) => {
  console.error("Request failed:", err.message);
  process.exit(1);
});
