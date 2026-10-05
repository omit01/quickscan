FROM mcr.microsoft.com/playwright:v1.63.0-noble AS build
WORKDIR /app
RUN corepack enable
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/site-policy/package.json packages/site-policy/package.json
COPY packages/scoring/package.json packages/scoring/package.json
RUN npm ci
COPY apps/worker apps/worker
COPY packages/contracts packages/contracts
COPY packages/site-policy packages/site-policy
RUN npm run build -w @quickscan/contracts && npm run build -w @quickscan/worker

FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json package-lock.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/site-policy/package.json packages/site-policy/package.json
RUN npm ci --omit=dev
RUN npx playwright install chromium
COPY --from=build /app/apps/worker/dist apps/worker/dist
COPY --from=build /app/apps/worker/assets apps/worker/assets
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/site-policy/dist packages/site-policy/dist
CMD ["node", "apps/worker/dist/worker.js"]