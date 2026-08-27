# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# One image, two entry points: the web server and the worker. They share code
# and secrets, so a single image with the command chosen at run time is simpler
# than maintaining two.
#
# Layout in the final image:
#   /app             Next's standalone server and its traced modules
#   /app/worker      sources, migrations and a production install, for the
#                    TypeScript entry points (worker, migrations)
#   /app/storage     attachments, when S3 is not configured
# ---------------------------------------------------------------------------

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The build inlines NEXT_PUBLIC_* only; every secret is read at run time.
RUN npm run build

# A production-only install for the worker: no build tooling, no test runner.
FROM node:22-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Absolute, so the web and worker processes agree on one directory. Relative
# defaults would resolve against each process's own working directory.
ENV LOCAL_STORAGE_DIR=/app/storage

RUN groupadd --system --gid 1001 app \
 && useradd --system --uid 1001 --gid app app

# --- web: Next's standalone output carries only the modules it traced --------
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public

# --- worker: TypeScript entry points, run with tsx --------------------------
COPY --from=prod-deps --chown=app:app /app/node_modules ./worker/node_modules
COPY --from=build --chown=app:app /app/src ./worker/src
COPY --from=build --chown=app:app /app/drizzle ./worker/drizzle
COPY --from=build --chown=app:app /app/tsconfig.json /app/package.json ./worker/

RUN mkdir -p /app/storage && chown -R app:app /app/storage
VOLUME ["/app/storage"]

USER app
EXPOSE 3000

# A signed-out request that exercises the server and its database connection.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Overridden for the worker and migration containers:
#   worker:  ["npm","--prefix","/app/worker","run","worker"]
#   migrate: ["npm","--prefix","/app/worker","run","db:migrate"]
CMD ["node", "server.js"]
