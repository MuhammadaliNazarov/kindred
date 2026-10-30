#!/bin/bash
# Push the current code to the Tenki sandboxes and restart: ./deploy.sh [web|api|all]
set -e
cd "$(dirname "$0")"
T=~/.local/bin/tenki
API_URL=https://kindred-api--u6faat.us.sb.tenki.sh
what=${1:-all}
pack() { COPYFILE_DISABLE=1 tar --exclude=node_modules --exclude=.next --exclude=.venv --exclude=data --exclude=__pycache__ --exclude=.env -czf /tmp/$1.tgz $1 && base64 -i /tmp/$1.tgz -o /tmp/$1.b64; }
if [[ $what == web || $what == all ]]; then
  pack web
  $T sandbox write --session kindred-web --path /home/tenki/web.b64 --data-file /tmp/web.b64 >/dev/null
  $T sandbox exec --session kindred-web -c "cd ~/gtm-engine && rm -rf web/src && base64 -d ~/web.b64 | tar -xzf - && cd web && npm ci --silent >/dev/null 2>&1; NEXT_PUBLIC_API_URL=$API_URL npm run build 2>&1 | tail -3; pkill -f '[n]ext-server' || pkill -f '[n]ext start' || true; sleep 1; (setsid nohup npx next start -p 3000 -H 0.0.0.0 > ~/web.log 2>&1 < /dev/null &); sleep 5; curl -s -o /dev/null -w 'web %{http_code}\n' localhost:3000/intake"
fi
if [[ $what == api || $what == all ]]; then
  pack api
  $T sandbox write --session kindred-backend --path /home/tenki/api.b64 --data-file /tmp/api.b64 >/dev/null
  $T sandbox exec --session kindred-backend -c "cd ~/gtm && base64 -d ~/api.b64 | tar -xzf - && cd api && uv sync -q; pkill -f '[b]in/uvicorn app' || true; sleep 1; (DEMO_CREDITS=\${DEMO_CREDITS:-40} CORS_ORIGIN=http://localhost:3000 CORS_ORIGIN_REGEX='https://([a-z0-9-]+(--[a-z0-9]+)?\.us\.sb\.tenki\.sh|kindred[a-z0-9-]*\.vercel\.app)' setsid nohup uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 > ~/api.log 2>&1 &); sleep 6; curl -s localhost:8000/health"
fi
