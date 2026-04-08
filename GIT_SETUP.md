# MeshEngine — Git Setup Guide

---

## Table of Contents

1. [Initialize Repository](#initialize-repository)
2. [.gitignore](#gitignore)
3. [Branching Strategy](#branching-strategy)
4. [First Commit Flow](#first-commit-flow)
5. [Commit Message Standards](#commit-message-standards)
6. [Repo Hygiene Rules](#repo-hygiene-rules)

---

## Initialize Repository

```bash
cd /path/to/MeshEngine

git init
git remote add origin https://github.com/<your-username>/meshengine.git
```

Confirm the remote:
```bash
git remote -v
# origin  https://github.com/<your-username>/meshengine.git (fetch)
# origin  https://github.com/<your-username>/meshengine.git (push)
```

---

## .gitignore

Create this file at the project root before your first commit:

```bash
cat > .gitignore << 'EOF'
# ─── Python ────────────────────────────────────────────────────────────────
__pycache__/
*.py[cod]
*$py.class
*.pyo
*.pyd
.Python

# Virtual environments
.venv/
venv/
env/
ENV/

# Distribution / packaging
*.egg-info/
dist/
build/
*.egg
.eggs/
wheels/

# ─── Secrets & Config ──────────────────────────────────────────────────────
.env
.env.local
.env.*.local
*.secret
secrets/
credentials.json
service-account*.json

# ─── Logs ──────────────────────────────────────────────────────────────────
*.log
logs/
*.log.*

# ─── Testing & Coverage ────────────────────────────────────────────────────
.pytest_cache/
.coverage
htmlcov/
coverage.xml
.tox/

# ─── Databases ─────────────────────────────────────────────────────────────
*.sqlite3
*.db

# ─── Docker ────────────────────────────────────────────────────────────────
# Keep docker-compose.yml committed; ignore local overrides
docker-compose.override.yml

# ─── OS Junk ───────────────────────────────────────────────────────────────
.DS_Store
.DS_Store?
Thumbs.db
desktop.ini
.AppleDouble
.LSOverride

# ─── IDE / Editor ──────────────────────────────────────────────────────────
.idea/
.vscode/
*.swp
*.swo
*~
.project
.classpath

# ─── Build artifacts ───────────────────────────────────────────────────────
*.pyc
*.pyo
*.so
*.dylib
*.dll

# ─── Type checking ─────────────────────────────────────────────────────────
.mypy_cache/
.dmypy.json
.pyright/

EOF
```

Verify nothing sensitive is accidentally staged:
```bash
git status
# .env should NOT appear — it is covered by .gitignore
```

If `.env` was already tracked by git, remove it from tracking:
```bash
git rm --cached .env
```

---

## Branching Strategy

```
main           → production-ready, protected
└── dev        → integration branch; all features merge here first
    ├── feature/network-topology
    ├── feature/metrics-api
    ├── fix/dijkstra-edge-case
    └── chore/update-dependencies
```

### Branch naming conventions

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feature/<short-description>` | `feature/websocket-dashboard` |
| Bug fix | `fix/<short-description>` | `fix/redis-reconnect-on-timeout` |
| Chore/housekeeping | `chore/<short-description>` | `chore/bump-fastapi-version` |
| Hotfix to main | `hotfix/<short-description>` | `hotfix/null-path-crash` |
| Release prep | `release/<version>` | `release/1.1.0` |

### Create and switch to a new branch

```bash
git checkout dev                             # always branch from dev, not main
git pull origin dev                          # sync before branching
git checkout -b feature/my-new-feature
```

### Merge back via pull request (never push directly to main)

```bash
git push origin feature/my-new-feature
# Then open a PR on GitHub: feature/my-new-feature → dev
```

---

## First Commit Flow

### Step 1 — Verify .gitignore is in place

```bash
git status
# .venv/, __pycache__/, .env must NOT appear in the list
```

### Step 2 — Stage files explicitly (never `git add .` blindly)

Stage by directory/file group so you can review what you're committing:

```bash
git add .gitignore
git add .env.example                     # safe — no real secrets
git add docker-compose.yml
git add control-plane/
git add node-worker/
git add scripts/
git add infra/
git add Readme.md
git add LOCAL_SETUP.md GIT_SETUP.md RUN_AND_TEST.md
```

### Step 3 — Review staged diff

```bash
git diff --cached --stat
# Confirms which files are staged and their size
```

### Step 4 — Commit

```bash
git commit -m "feat: initial MeshEngine implementation

- FastAPI control plane with Dijkstra routing
- PostgreSQL + asyncpg persistence
- Redis Pub/Sub event bus
- Node worker with Redis subscriber
- WebSocket real-time event stream + SVG dashboard
- Metrics service with Redis atomic counters
- Message tracing with trace_id
- Docker Compose for full local stack
- 26 pure-Python unit tests"
```

### Step 5 — Create main branch and push

```bash
git branch -M main                        # rename default branch to main
git push -u origin main
```

### Step 6 — Create and push dev branch

```bash
git checkout -b dev
git push -u origin dev
```

---

## Commit Message Standards

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <short summary — imperative mood, ≤72 chars>

<optional body — explain WHY, not WHAT>
```

### Types

| Type | When to use |
|------|-------------|
| `feat` | New feature or endpoint |
| `fix` | Bug fix |
| `refactor` | Code restructure, no behaviour change |
| `test` | Adding or fixing tests |
| `docs` | Documentation only |
| `chore` | Build, deps, config — no production code |
| `perf` | Performance improvement |

### Good examples

```
feat(routing): add failure-aware Dijkstra with reroute fallback
fix(worker): handle NODE_FAILED and NODE_DOWN event types
test(dijkstra): add isolated node and multi-hop path cases
chore(deps): bump fastapi to 0.111.0
docs: add LOCAL_SETUP and RUN_AND_TEST guides
```

### Bad examples (avoid)

```
fixed stuff
WIP
update
changes
```

---

## Repo Hygiene Rules

### What to ALWAYS commit

- `requirements.txt` (both control-plane and node-worker)
- `docker-compose.yml`
- `Dockerfile` (both services)
- `.env.example` (template with no real secrets)
- All application source code under `control-plane/app/` and `node-worker/worker/`
- Tests under `control-plane/tests/`
- `scripts/demo.sh`
- Documentation `.md` files

### What to NEVER commit

- `.env` — contains real credentials
- `.venv/` / `venv/` — reproducible from `requirements.txt`
- `__pycache__/` — auto-generated bytecode
- `*.pyc` — compiled Python
- `docker-compose.override.yml` — local developer overrides
- Any `*.log` files
- Any `service-account*.json` or GCP credential files

### When to commit

- After completing a logical, self-contained unit of work
- After all tests pass (`pytest tests/ -v`)
- Before switching to a different task or branch
- Do NOT commit broken/half-implemented code to `main` or `dev`

### Pre-push checklist

```bash
# 1. Run tests
cd control-plane && python -m pytest tests/ -v

# 2. Check no secrets are staged
git diff --cached | grep -E "(PASSWORD|SECRET|KEY|TOKEN)" && echo "WARNING: possible secret in diff"

# 3. Verify .env is not staged
git status | grep ".env$" && echo "WARNING: .env is staged"

# 4. Push
git push origin <branch>
```
