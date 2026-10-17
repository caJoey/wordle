# Build the Svelte client, then run the Socket.IO game server, which serves dist/ in production.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# Hosts like Render/Fly/Railway inject PORT; 3001 is the local default.
ENV PORT=3001
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY scripts/start.mjs ./scripts/start.mjs
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- "http://localhost:${PORT}/healthz" > /dev/null || exit 1
USER node
# GEMMA_API must be provided by the host's secret/env settings (GEMMA_MOCK=1 runs without it).
CMD ["node", "scripts/start.mjs"]
