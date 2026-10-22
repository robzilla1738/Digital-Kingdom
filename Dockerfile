# Digital Kingdom single-node image: API + worker + static web app.
FROM node:22.13-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @dk/web build

FROM node:22.13-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DK_DATA_DIR=/data HOST=0.0.0.0 PORT=8787
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate && useradd --system --uid 10001 dk && mkdir /data && chown dk /data
COPY --from=build --chown=dk /app /app
USER dk
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@dk/server", "start"]
