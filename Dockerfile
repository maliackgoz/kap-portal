FROM node:22-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential curl python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

# Workspace dependencies
COPY package*.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci

# Rating service dependencies
COPY rating-service/pyproject.toml rating-service/README.md rating-service/
COPY rating-service/app rating-service/app
COPY rating-service/data/config rating-service/data/config
COPY rating-service/data/exports rating-service/data/exports
COPY rating-service/data/ratings.jsonl rating-service/data/ratings.jsonl
COPY rating-service/data/news.jsonl rating-service/data/news.jsonl
COPY rating-service/data/run_log.jsonl rating-service/data/run_log.jsonl
RUN python3 -m venv /opt/rating-venv \
  && /opt/rating-venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/rating-venv/bin/pip install --no-cache-dir -e ./rating-service

# Portal source
COPY backend/ backend/
COPY frontend/ frontend/

# Build backend and frontend
RUN npm run build -w backend && npm run build -w frontend

# Serve frontend from backend
RUN rm -rf backend/public && cp -r frontend/dist backend/public

# Keep runtime image leaner after TypeScript/Vite build
RUN npm prune --omit=dev

# Create data directories and keep seed data outside mounted volumes
RUN mkdir -p backend/data backend/seed-data rating-service/data/raw rating-service/data/pdfs rating-service/data/imports rating-service/data/exports \
  && cp backend/data/companies.json backend/seed-data/companies.json \
  && chown -R node:node backend/data backend/seed-data rating-service/data

ENV PORT=8063
ENV MCP_PORT=8060
ENV MCP_PATH=/mcp
ENV MCP_ALLOWED_HOSTS=localhost,127.0.0.1,::1,0.0.0.0,172.30.146.31
ENV KAP_PORTAL_URL=http://127.0.0.1:8063
ENV KAP_PORTAL_USERNAME=admin
ENV KAP_PORTAL_PASSWORD=kap2024
ENV RATING_SERVICE_PORT=8064
ENV RATING_SERVICE_URL=http://127.0.0.1:8064
ENV RATING_MCP_DATA_DIR=/app/rating-service/data
ENV PATH="/opt/rating-venv/bin:${PATH}"
ENV NODE_ENV=production
EXPOSE 8060 8063 8064

USER node

# Full runtime: starts the portal, MCP HTTP server, and rating service in one container.
CMD ["node", "backend/dist/start-all.js"]
