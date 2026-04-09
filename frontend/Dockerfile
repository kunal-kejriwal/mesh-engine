# Build context: repo root (set in docker-compose.yml)
# This gives us access to the .md files at the root level.
FROM node:20-alpine AS builder
WORKDIR /app

# Install deps
COPY frontend/package*.json ./
RUN npm ci

# Copy frontend source
COPY frontend/ .

# Copy root-level .md docs into public/docs/ so vite bundles them
RUN mkdir -p public/docs
COPY API_Documentation.md   public/docs/
COPY About_MeshEngine.md    public/docs/
COPY GIT_SETUP.md           public/docs/
COPY LOCAL_SETUP.md         public/docs/
COPY RUN_AND_TEST.md        public/docs/

RUN npm run build

# ── Serve ────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
