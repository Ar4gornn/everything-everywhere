# Landing screenshots and OG images

Regenerates `frontend/landing/img/<lang>-<shot>.webp` (dashboard, plan, stock, habits; 780x1688)
and `frontend/public/og-<lang>.png` (1200x630) from a throwaway stack.

**Only fixture data may appear in a shot.** There are two accounts: `demo@example.com` (English, USD; numbers from
`backend/seed.py` plus habits and mood made by `seed_demo.py`) and `demo-fr@example.com`
(French, EUR; seeded only through the API with French categories, savings pots, stock and
habits, because seed.py would put English names on a French page). The
password is random per run and never printed or stored; the tokens reach `capture.mjs`
through its environment only. Never point this at a real account or at the dev database
(`everything_everywhere`). Look at every image before committing it.

Needs: Node 22, Google Chrome (set `CHROME` if not at the default Windows path), Postgres
from the dev docker stack on :5432, and the backend venv.

From the repo root (Git Bash), nothing in the dev database is touched:

```sh
# 1. Production build of the client, same origin as the API (empty API base)
cd frontend
VITE_API_BASE_URL= npx vite build --outDir C:/dev/PersoProject/.claude/harness/landing-dist --emptyOutDir
cd ..

# 2. Throwaway API on :8026 with a fresh database `ee_landing_verify`, serving that build
#    (registration open). Leave it running; stop it afterwards.
cmd //c C:/dev/PersoProject/.claude/harness/landing_api.cmd &
curl -s http://localhost:8026/health

# 3. Seed both fixture accounts and capture (runs capture.mjs at the end)
PYTHONIOENCODING=utf-8 C:/dev/PersoProject/MinimalBudget/backend/.venv/Scripts/python.exe ops/landing-shots/seed_demo.py
```

The seed is not idempotent for habits: to redo it, stop the API and start it again (step 2
recreates the database), then run step 3. `ONLY=shots` or `ONLY=og` limits `capture.mjs`
when it is run on its own with `EE_ACCESS`, `EE_REFRESH` and `BASE` in the environment.

Rendering notes: 390x844 at DPR 2, touch, light theme, install offer pre-answered, tour
skipped, floating action buttons hidden, locale `en-US` / `fr-FR`. Each language is captured
from its own account (`LANGS=fr` limits `capture.mjs` to one). The French registration
carries `currency: EUR, language: fr`; its English default savings pots are deleted and
replaced. WebP quality starts at 80 and drops until each file is at most 120 KB. `og.html`
is static and is never served in production.
