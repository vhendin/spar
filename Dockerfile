# Game image: builds the client and a bundled server, then runs them on plain Node.
FROM node:24-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11.5.3
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    CLIENT_DIST=/app/client \
    REGIONS_DIR=/data/regions \
    ACCOUNTS_DIR=/data/accounts \
    PERF_DIR=/data/perf
COPY --from=build /app/client/dist /app/client
COPY --from=build /app/server/dist/index.cjs /app/server/index.cjs
# Where logged-in drivers' things are kept; a volume, owned by the user the server runs as.
RUN mkdir -p /data/accounts /data/perf && chown node:node /data/accounts /data/perf
USER node
EXPOSE 8080
CMD ["node", "/app/server/index.cjs"]
