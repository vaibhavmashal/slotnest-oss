# Production image: the Next.js server plus the tsx scripts (migrations, seed, Stripe setup, worker).
# Build for the droplet from a Mac with: docker buildx build --platform linux/amd64 -t slotnest .
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The DB client checks DATABASE_URL on import; postgres-js only connects on the first query, so a placeholder is enough to build.
ENV NEXT_TELEMETRY_DISABLED=1 DATABASE_URL=postgres://build@127.0.0.1:1/build
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3100 HOSTNAME=0.0.0.0 ASSET_DIR=/data/assets
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY package.json tsconfig.json next.config.ts instrumentation.ts ./
COPY app ./app
COPY src ./src
COPY db ./db
COPY scripts ./scripts
RUN mkdir -p /data/assets && chown -R node:node /data
USER node
EXPOSE 3100
# Migrations are forward-only and each runs in a transaction, so applying them on every start is safe.
CMD ["sh", "-c", "node_modules/.bin/tsx scripts/migrate.ts && exec node_modules/.bin/next start -p 3100"]
