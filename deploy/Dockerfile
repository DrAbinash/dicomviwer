# DICOM Viewer - production image (Next.js standalone)
# Build: docker build -f deploy/Dockerfile .   (from the repository root)

FROM oven/bun:1.2 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.2 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# The standalone build embeds the /api/pacs proxy that talks to Orthanc.
RUN bun run build
# Seed SQLite schema into a template DB that the runner copies to /app/db
# on first boot (fresh volume) - after that the volume owns the data.
RUN DATABASE_URL="file:../db-seed/custom.db" bunx prisma db push --accept-data-loss --skip-generate

FROM oven/bun:1.2-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# SQLite schema template (copied into /app/db on first boot)
COPY --from=builder /app/db-seed ./db-seed

# /app/db holds the SQLite DB and the DICOM inbox (db/dicom-received);
# mount a volume here so both survive container rebuilds.
RUN mkdir -p /app/db && chown nextjs:nodejs /app/db

USER nextjs
EXPOSE 3000 4104
CMD ["sh", "-c", "if [ ! -f db/custom.db ] && [ -f db-seed/custom.db ]; then mkdir -p db && cp db-seed/custom.db db/custom.db; fi; exec bun server.js"]
