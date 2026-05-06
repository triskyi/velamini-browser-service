# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

# ── Runtime stage (Playwright-Chromium pre-installed) ────────────────────────
FROM mcr.microsoft.com/playwright:v1.44.1-jammy

WORKDIR /app

# Copy compiled JS
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Install production deps only
RUN npm ci --omit=dev

# Playwright browsers are already in the base image (Chromium + dependencies)
# but we explicitly ensure the chromium channel is present
RUN npx playwright install chromium

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "dist/index.js"]
