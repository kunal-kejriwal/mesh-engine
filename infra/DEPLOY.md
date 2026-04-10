# MeshEngine — Deployment Guide

Quick comparison of deployment options, then step-by-step guides for the two recommended paths.

---

## Which option should I use?

| | GCP e2-micro VM | Railway |
|---|---|---|
| **Cost** | $0/month (GCP free tier) | ~$5–10/month |
| **Time to live** | 45 min | 15 min |
| **Custom domain + HTTPS** | Yes (Let's Encrypt) | Yes (automatic) |
| **WebSocket support** | Yes | Yes |
| **Complexity** | Medium (SSH + Docker) | Low (push to deploy) |
| **Best for** | Demo with custom domain, zero cost | Fastest possible launch |

---

## Option A — GCP e2-micro VM (free, recommended)

### What you get

- 1 × e2-micro VM (0.25 vCPU, 1 GB RAM) — **always free**
- All services (FastAPI, PostgreSQL, Redis, nginx, frontend) run on it via `docker-compose`
- Static external IP, optional custom domain, Let's Encrypt TLS

### Cost

| Item | Cost |
|---|---|
| e2-micro VM (us-central1) | **$0** (free tier) |
| 30 GB persistent disk | **$0** (free tier includes 30 GB) |
| Static external IP (in use) | **$0** |
| Egress traffic < 1 GB/month | **$0** |
| **Total** | **$0/month** |

> If you add a custom domain you pay only for DNS (e.g. Namecheap ~$10/yr, or free on Cloudflare).

---

### Step 1 — Create the VM

```bash
# In GCP Cloud Shell or your terminal with gcloud installed
gcloud config set project YOUR_PROJECT_ID

gcloud compute instances create meshengine \
  --zone=us-central1-a \
  --machine-type=e2-micro \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=30GB \
  --boot-disk-type=pd-standard \
  --tags=http-server,https-server
```

Allow HTTP + HTTPS traffic:

```bash
gcloud compute firewall-rules create allow-http \
  --allow=tcp:80 \
  --target-tags=http-server \
  --description="Allow HTTP"

gcloud compute firewall-rules create allow-https \
  --allow=tcp:443 \
  --target-tags=https-server \
  --description="Allow HTTPS"
```

Get your external IP:

```bash
gcloud compute instances describe meshengine \
  --zone=us-central1-a \
  --format='value(networkInterfaces[0].accessConfigs[0].natIP)'
```

---

### Step 2 — SSH in and install Docker

```bash
gcloud compute ssh meshengine --zone=us-central1-a
```

Inside the VM:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

# Install docker-compose plugin
sudo apt-get install -y docker-compose-plugin
docker compose version   # should print v2.x
```

---

### Step 3 — Upload your project

**Option A — Git (recommended if code is on GitHub):**

```bash
# On VM
sudo apt-get install -y git
git clone https://github.com/YOUR_USERNAME/MeshEngine.git
cd MeshEngine
```

**Option B — rsync from your local machine:**

```bash
# On your local machine (not the VM)
gcloud compute scp --recurse \
  /c/Users/kunal/OneDrive/Desktop/MeshEngine \
  meshengine:/home/$USER/MeshEngine \
  --zone=us-central1-a
```

---

### Step 4 — Configure environment

On the VM, inside the `MeshEngine/` directory:

```bash
cp .env.example .env
nano .env
```

Set these values:

```bash
DATABASE_URL=postgresql+asyncpg://meshuser:meshpass@postgres/meshengine
REDIS_URL=redis://redis:6379
LOG_LEVEL=INFO

# IMPORTANT: generate a real secret
JWT_SECRET=$(openssl rand -hex 32)
JWT_EXPIRY_SECONDS=3600

RATE_LIMIT_REQUESTS=10
RATE_LIMIT_WINDOW_SECONDS=60
```

> Copy the generated `JWT_SECRET` somewhere safe.

---

### Step 5 — Launch everything

```bash
cd ~/MeshEngine
docker compose up -d --build
```

This builds and starts:
- `postgres` — PostgreSQL 15
- `redis` — Redis 7
- `control_plane` — FastAPI on port 8000
- `node_worker` — async Redis subscriber
- `frontend` — nginx serving the React app on port 80

Check all services are healthy:

```bash
docker compose ps
docker compose logs control_plane --tail=20
```

Test from the VM:

```bash
curl localhost/api/health
# {"status":"healthy","service":"MeshEngine Control Plane",...}
```

Test from your browser using the VM's external IP:

```
http://EXTERNAL_IP/
```

---

### Step 6 — Custom domain + HTTPS (optional but recommended)

**6a. Point your domain to the VM IP**

In your DNS provider (Namecheap, Cloudflare, etc.):

```
Type  Name  Value
A     @     EXTERNAL_IP
A     www   EXTERNAL_IP
```

Wait for DNS to propagate (~5 min on Cloudflare, up to 1 hr elsewhere).

**6b. Install certbot and get a TLS certificate**

```bash
sudo apt-get install -y certbot python3-certbot-nginx
```

Stop nginx temporarily (it's running inside Docker on port 80 — we need port 80 free for the ACME challenge):

```bash
docker compose stop frontend
sudo certbot certonly --standalone -d thedevngn.com -d www.thedevngn.com
docker compose start frontend
```

**6c. Create an nginx reverse proxy on the HOST** (outside Docker)

```bash
sudo apt-get install -y nginx
sudo nano /etc/nginx/sites-available/meshengine
```

Paste:

```nginx
server {
    listen 80;
    server_name thedevngn.com www.thedevngn.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name thedevngn.com www.thedevngn.com;

    ssl_certificate     /etc/letsencrypt/live/thedevngn.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/thedevngn.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    # Frontend (Docker nginx on port 80)
    location / {
        proxy_pass         http://127.0.0.1:80;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
    }

    # Backend API
    location /api/ {
        proxy_pass         http://127.0.0.1:8000/;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_read_timeout 60s;
    }

    # WebSocket
    location /ws/ {
        proxy_pass         http://127.0.0.1:8000/ws/;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_read_timeout 3600s;
    }
}
```

Enable and restart:

```bash
sudo ln -s /etc/nginx/sites-available/meshengine /etc/nginx/sites-enabled/
sudo nginx -t          # verify config
sudo systemctl restart nginx
```

Update the Docker frontend's nginx so it no longer handles the TLS termination (traffic comes in on port 80 from the host nginx):

The `docker-compose.yml` frontend service already exposes port 80 — keep it as-is. The host nginx layer handles TLS.

**6d. Auto-renew certificates**

```bash
sudo crontab -e
# Add:
0 3 * * * certbot renew --quiet --pre-hook "docker compose -f /home/$USER/MeshEngine/docker-compose.yml stop frontend" --post-hook "docker compose -f /home/$USER/MeshEngine/docker-compose.yml start frontend && systemctl reload nginx"
```

---

### Step 7 — Make it survive reboots

```bash
# Create a systemd service
sudo tee /etc/systemd/system/meshengine.service << 'EOF'
[Unit]
Description=MeshEngine Docker Compose
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/kunal/MeshEngine
ExecStart=docker compose up -d
ExecStop=docker compose down
User=kunal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable meshengine
sudo systemctl start meshengine
```

---

### Final URLs

| URL | What it serves |
|---|---|
| `https://thedevngn.com` | React frontend (homepage, docs, dashboard) |
| `https://thedevngn.com/api/health` | FastAPI health check |
| `https://thedevngn.com/api/docs` | FastAPI Swagger UI |
| `wss://thedevngn.com/ws/stream` | Live WebSocket event feed |

---

## Option B — Railway (fastest path to live)

Railway runs your Dockerfiles directly, manages PostgreSQL and Redis as add-ons, and gives you a public HTTPS URL with zero configuration.

### Step 1 — Sign up and install CLI

```bash
# Sign up at https://railway.app (free account)
npm install -g @railway/cli
railway login
```

### Step 2 — Create project and services

```bash
cd /path/to/MeshEngine
railway init   # creates a new Railway project
```

In the Railway dashboard (railway.app/dashboard):

1. **Add service → Empty service** — name it `control-plane`
   - Connect it to your GitHub repo, set root directory to `control-plane`
   - Or: use "Deploy from local directory"

2. **Add service → Database → PostgreSQL** — Railway provisions it, gives you `DATABASE_URL`

3. **Add service → Database → Redis** — gives you `REDIS_URL`

4. **Add service → Empty service** — name it `frontend`
   - Root directory: *(leave as repo root so Dockerfile can access .md files)*
   - Dockerfile path: `frontend/Dockerfile`

### Step 3 — Set environment variables

On each service in the Railway dashboard → **Variables**:

**control-plane service:**
```
DATABASE_URL   = (copy from PostgreSQL addon)
REDIS_URL      = (copy from Redis addon)  
JWT_SECRET     = (generate: openssl rand -hex 32)
LOG_LEVEL      = INFO
```

**frontend service:**
```
VITE_API_URL   = https://your-control-plane.up.railway.app
VITE_WS_URL    = wss://your-control-plane.up.railway.app
```

### Step 4 — Deploy

```bash
# From repo root
railway up
```

Railway builds all services in parallel, assigns public URLs, and handles TLS automatically.

Your frontend will be live at `https://frontend-production-xxxx.up.railway.app`.

---

## Option C — Fly.io (~$3–8/month, Docker-native)

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Deploy control-plane
cd control-plane
fly launch --name meshengine-api --region ord
fly postgres create --name meshengine-db
fly redis create --name meshengine-redis
fly secrets set JWT_SECRET=$(openssl rand -hex 32)
fly deploy

# Deploy frontend
cd ../frontend
fly launch --name meshengine-ui --region ord
fly secrets set VITE_API_URL=https://meshengine-api.fly.dev
fly deploy
```

Fly gives you `*.fly.dev` subdomains with automatic TLS.

---

## Troubleshooting

**`docker compose up` fails — port 80 already in use**
```bash
sudo lsof -i :80    # find what's using it
sudo systemctl stop nginx  # if host nginx is running
```

**Control plane can't reach postgres**
```bash
docker compose logs postgres
docker compose exec control_plane ping postgres  # check internal DNS
```

**JWT_SECRET not set**
The app will start with the default insecure value. Always override it:
```bash
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
docker compose up -d control_plane
```

**Frontend shows blank page**
```bash
docker compose logs frontend
# Usually a build error — check that all .md files exist at repo root
```

**WebSocket not connecting**
Make sure nginx passes the `Upgrade` header. Check the nginx config in [frontend/nginx.conf](../frontend/nginx.conf). On GCP with TLS, use `wss://` not `ws://` — set `VITE_WS_URL` accordingly.
