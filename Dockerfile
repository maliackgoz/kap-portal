FROM node:22-slim AS portal-builder

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci

COPY backend/ backend/
COPY frontend/ frontend/
RUN npm run build -w backend \
  && npm run build -w frontend \
  && rm -rf backend/public \
  && cp -r frontend/dist backend/public \
  && npm prune --omit=dev


FROM node:22-slim AS rating-builder

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*

COPY rating-service/pyproject.toml rating-service/README.md rating-service/
COPY rating-service/app rating-service/app
RUN python3 -m venv /opt/rating-venv \
  && /opt/rating-venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/rating-venv/bin/pip install --no-cache-dir -e ./rating-service


FROM node:22-slim

WORKDIR /app

ARG APP_VERSION=dev

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY --from=portal-builder /app/node_modules node_modules
COPY --from=portal-builder /app/backend/dist backend/dist
COPY --from=portal-builder /app/backend/public backend/public
COPY --from=rating-builder /opt/rating-venv /opt/rating-venv

COPY backend/data/companies.json backend/data/companies.json
COPY backend/data/company-aliases.json backend/data/company-aliases.json
COPY rating-service/pyproject.toml rating-service/README.md rating-service/
COPY rating-service/app rating-service/app
COPY rating-service/sync_companies.py rating-service/sync_companies.py
COPY rating-service/data/config rating-service/data/config

# ratings.jsonl/news.jsonl/run_log.jsonl/exports/* BILEREK kopyalanmiyor -- bunlar
# scrape edilmis DATA, statik config degil. Eski bir gelistirme anindan kalma
# veriyi her yeni kuruluma "az once cekilmis gibi" sunmamak icin bos baslamali;
# app/config.py ensure_data_dirs() zaten bunlari ilk calistirmada bos olusturuyor.
RUN mkdir -p backend/seed-data rating-service/data/raw rating-service/data/pdfs rating-service/data/imports rating-service/data/exports \
  && cp backend/data/companies.json backend/seed-data/companies.json \
  && chown -R node:node backend rating-service

ENV PORT=8063
ENV MCP_PORT=8060
ENV MCP_PATH=/mcp
ENV MCP_ALLOWED_HOSTS=localhost,127.0.0.1,::1,0.0.0.0
ENV KAP_PORTAL_URL=http://127.0.0.1:8063
ENV RATING_SERVICE_PORT=8064
ENV RATING_SERVICE_URL=http://127.0.0.1:8064
ENV RATING_MCP_DATA_DIR=/app/rating-service/data
ENV PATH="/opt/rating-venv/bin:${PATH}"
ENV NODE_ENV=production
ENV APP_VERSION=${APP_VERSION}
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

EXPOSE 8060 8063 8064

USER node

HEALTHCHECK --interval=30s --timeout=8s --start-period=45s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8063/api/ready \
    && curl -fsS http://127.0.0.1:8060/health \
    && curl -fsS http://127.0.0.1:8064/health \
    || exit 1

CMD ["node", "backend/dist/start-all.js"]
