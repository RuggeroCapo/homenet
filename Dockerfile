# ---- build ----
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci
COPY server server
COPY web web
RUN cd web && npm run build \
 && cd ../server && npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
WORKDIR /app
COPY --from=build /app/server/package.json ./
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/web/dist ./public
EXPOSE 3000
VOLUME /data
# keep the V8 heap small: the box only has 6 GB shared with everything else
CMD ["node", "--max-old-space-size=160", "dist/index.js"]
