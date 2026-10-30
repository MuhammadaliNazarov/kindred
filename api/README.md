# Warmpath API (FastAPI + Kùzu)

```bash
cd api
cp .env.example .env        # fill whatever keys you have; everything else falls back
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

`GET /health` shows which integrations are live and which are fallbacks. On boot the server rebuilds `data/graph.kuzu` and loads
the Tenki demo seed (fictional companies, `example.com` sources, `verified:false`), so every GET returns data right away.

| Integration | Live when set | Fallback |
|---|---|---|
| Claude (ICP, extraction, copy) | `ANTHROPIC_API_KEY` (+`ANTHROPIC_MODEL`) | canned Tenki ICP + template copy |
| Search | `TAVILY_API_KEY` → `SERPER_API_KEY` | seed dataset |
| Quote validator | always (httpx fetches the URL; claims whose quote isn't found are dropped → `GET /dropped`) | — |
| Enrichment | `HUNTER_API_KEY` (finder/domain-search + verifier/MX) → `APOLLO_API_KEY` | deterministic seed |
| Email | `SENDGRID_API_KEY` + `SENDGRID_FROM` + `DEMO_INBOX` (every send goes to DEMO_INBOX only) | simulated |
| Billing | `FLEXPRICE_API_KEY` + `FLEXPRICE_CUSTOMER_ID` (POST /v1/events, GET /v1/customers/wallets) | `data/ledger.json`, starts at `DEMO_CREDITS` (400) |

Costs: `lead_enriched` 5, `outreach_sent` 1, `graph_query` 0.1. Out of credits → enrich returns **402** and the thinking feed shows
"Enrichment paused — out of credits". Demo: `DEMO_CREDITS=3` blocks on the first enrich; `POST /credits/reset` refills.

## Routes
POST /intake · GET /icp · GET /expansions · POST /expansions/{id} `{status,name?,rationale?}` · POST /discover · GET /companies ·
GET /dropped · GET /people · GET /graph?lead= · GET /warm-path/{lead} · GET /leads · POST /leads/{id}/move `{stage,actor}` ·
POST /leads/{id}/enrich · POST /leads/{id}/draft · GET /touches?lead_id= · POST /touches/{id}/review `{action: approve|edit|reject, body?, subject?, actor?}` ·
POST /touches/{id}/send · GET /audit · GET /credits · POST /credits/reset · GET /analytics · GET /thinking · GET /thinking/stream (SSE) · GET /health

HITL: touches start `draft`; only `approved`/`edited` touches with a passing Security check can be sent (409/422 otherwise).
LinkedIn touches are marked sent as a copy-to-clipboard task (no API).
