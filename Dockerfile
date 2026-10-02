FROM node:22-bookworm-slim AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
ARG VITE_SERVER_URL
ARG VITE_TURNSTILE_SITE_KEY
ENV VITE_SERVER_URL=$VITE_SERVER_URL VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY
RUN npm run build

FROM caddy:2-alpine AS web
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=client-build /app/client/dist /srv

FROM node:22-bookworm-slim AS server
ENV NODE_ENV=production
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node server/ ./
COPY --chown=node:node db/ /app/db/
COPY --chown=node:node stats-service/data/statsCache.json /app/stats-service/data/statsCache.json
USER node
RUN test -r /app/db/schema.sql && test -r /app/stats-service/data/statsCache.json
EXPOSE 4000
CMD ["node", "src/index.js"]

FROM python:3.12-slim-bookworm AS stats
ENV PYTHONUNBUFFERED=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1
WORKDIR /app/stats-service
COPY stats-service/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home app
COPY --chown=app:app stats-service/ ./
COPY --chown=app:app server/data/players.json server/data/notablePlayers.json server/data/topTeamPlayers.json /app/server/data/
COPY --chown=app:app db/ /app/db/
USER app
RUN test -r /app/db/schema.sql && test -r /app/server/data/players.json && test -r /app/server/data/notablePlayers.json && test -r /app/server/data/topTeamPlayers.json
EXPOSE 5001
CMD ["gunicorn", "--workers", "1", "--threads", "4", "--timeout", "120", "--bind", "0.0.0.0:5001", "app:app"]
