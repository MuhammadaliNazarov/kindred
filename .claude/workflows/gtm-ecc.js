export const meta = {
  name: 'gtm-ecc',
  description: 'Warmpath hackathon pipeline driven by ECC skills: ideate, review, QA, delivery gate (pick with args.stage)',
  whenToUse: 'args: {stage: "ideate" | "review" | "qa" | "gate" | "all"}',
  phases: [
    { title: 'Ideate', detail: 'ecc:product-lens, ecc:market-research, ecc:council' },
    { title: 'Review', detail: 'ecc:typescript-reviewer, ecc:python-reviewer, ecc:security-reviewer on the code' },
    { title: 'QA', detail: 'ecc:browser-qa / ecc:e2e-testing against the running app' },
    { title: 'Gate', detail: 'ecc:delivery-gate against the judging matrix' },
  ],
}

const ROOT = '/Users/muhammadali/Desktop/gtm-engine'
const STAGE = (args && args.stage) || 'ideate'
const run = s => STAGE === 'all' || STAGE === s
const ctx = `Project: ${ROOT}. Read ${ROOT}/DESIGN.md first (judging matrix in section 1, 4.5-hour plan in section 8). ` +
  `Hackathon spec PDF: /Users/muhammadali/Downloads/AI GTM Engine - Product & Technical Requirements Specification.pdf. ` +
  `Deadline is hours away: every recommendation must be doable in under 30 minutes or say "post-hackathon". Do not edit code files.`
const useSkill = names => `Before anything else, load these skills with the Skill tool and follow them: ${names.join(', ')}.`

let out = {}

if (run('ideate')) {
  phase('Ideate')
  const [lens, market, story] = await parallel([
    () => agent(`${useSkill(['ecc:product-lens'])}\n${ctx}\nApply product-lens to Warmpath: is the wedge (cited evidence + warm intro paths + per-lead cost) a believable startup? ` +
      `Who pays, what they replace, why now. Give the 3 sharpest changes to the pitch and the 1 feature to cut. Return markdown under 300 words.`,
      { label: 'product-lens', phase: 'Ideate' }),
    () => agent(`${useSkill(['ecc:market-research'])}\n${ctx}\nResearch (web) how Clay, Unify, Origami Agents, Rox, 11x and Apollo AI position and price ` +
      `their GTM agents in 2026, and what users complain about (Reddit, X, G2). Return a markdown table (product, wedge, price, top complaint) ` +
      `and the 2 gaps Warmpath should claim, with source URLs. Under 350 words.`,
      { label: 'market-research', phase: 'Ideate' }),
    () => agent(`${useSkill(['ecc:council'])}\n${ctx}\nRun a council of 3 judges (sponsor judge for Band/Flexprice, a VC, a GTM practitioner). ` +
      `Each scores the planned 2–3 minute demo story (DESIGN section 3) against the judging matrix and names the single moment that would win or lose ` +
      `their points. Then give one merged demo script (timed beats). Under 400 words.`,
      { label: 'council', phase: 'Ideate' }),
  ])
  const synth = await agent(`${ctx}\nMerge these three ideation reports into ${ROOT}/IDEATION.md (you may write that one file): ` +
    `decisions to apply now (max 6, each with the DESIGN.md section it changes), the timed demo script, positioning line, and what is post-hackathon.\n\n` +
    `## product-lens\n${lens}\n\n## market-research\n${market}\n\n## council\n${story}\n\nReturn the decisions list only.`,
    { label: 'synthesize', phase: 'Ideate' })
  out.ideate = synth
}

if (run('build')) {
  phase('Build')
  const own = files => `Only edit these files: ${files}. Other agents edit other backend files in parallel. Don't commit. ` +
    `Test with \`cd ${ROOT}/api && uv run python -c ...\` or a server on your own port (8010-8019). Report (<120 words): what changed, what you verified live.`
  const built = await parallel([
    () => agent(`${useSkill(['ecc:lead-intelligence', 'tavily-best-practices', 'ecc:backend-patterns'])}\n${ctx}\n` +
      `Make discovery return REAL cited leads (judging: ICP & Discovery 20%). Tavily keyless search works without a key (header X-Tavily-Access-Mode: keyless; ` +
      `see api/app/discovery.py search()). For the Tenki ICP, POST /discover must find ~8-12 real companies (AI-agent startups hiring infra/platform engineers, ` +
      `recent funding or launches) from real public pages, each with a source {url, title, quote}, and the validator (api/app/validator.py) must confirm the quote ` +
      `on the page (use Tavily extract keyless if direct fetch fails). Score fit/intent from the evidence, tier A/B/C, write to the graph, keep seed people only as ` +
      `fallback. Never invent people: if no named public buyer is found, create the buyer as a role ("Head of Platform @ X") with no name. ` +
      own('api/app/discovery.py, api/app/validator.py'), { label: 'build:discovery', phase: 'Build' }),
    () => agent(`${useSkill(['ecc:api-connector-builder', 'ecc:backend-patterns'])}\n${ctx}\n` +
      `Make enrichment verifiable WITHOUT paid keys (judging: Enrichment 20%): in api/app/enrich.py add a free tier: resolve the company domain, real MX lookup ` +
      `(dnspython, add with uv), mark mx_ok; when Hunter/Apollo keys are absent, set email to null and email_status "unknown" but show domain + MX verified ` +
      `and a "pattern guess" field only if clearly labelled as a guess (never present a guessed email as verified). Keep the Flexprice/ledger metering and 402 gate. ` +
      own('api/app/enrich.py, api/pyproject.toml, api/uv.lock'), { label: 'build:enrich', phase: 'Build' }),
    () => agent(`${useSkill(['ecc:market-research', 'tavily-best-practices'])}\n${ctx}\n` +
      `QA found ~9 of 11 ICP fields have no source. In api/app/icp.py, after the ICP is inferred, attach 1-2 real sources to each industry, persona, trigger and ` +
      `the size band using Tavily keyless search (evidence that this segment buys sandboxes/agent infra), with a quote; lower confidence where no source is found. ` +
      `Same for the 3 expansion segments' evidence. Keep it under ~20 searches per ICP and cache results to data/cache/. ` + own('api/app/icp.py'),
      { label: 'build:icp-sources', phase: 'Build' }),
  ])
  const verify = await agent(`${useSkill(['ecc:verification-loop', 'ecc:fastapi-patterns'])}\n${ctx}\nThree agents just changed api/app/discovery.py, validator.py, ` +
    `enrich.py, icp.py. Run the API on port 8020 and verify the whole flow end to end with curl: /reset, POST /intake (Tenki), POST /discover, /companies (sources ` +
    `verified), enrich until 402, draft, review approve -> sent, /analytics, /bandit. Fix only breakages (any file in api/app). Report PASS/FAIL per step.\n\n` +
    `Their reports:\n${built.filter(Boolean).join('\n---\n')}`, { label: 'verify', phase: 'Build' })
  out.build = { built, verify }
}

if (run('polish')) {
  phase('Polish')
  const M = { model: 'fable', phase: 'Polish' }
  const pol = await parallel([
    () => agent(`${useSkill(['ecc:make-interfaces-feel-better', 'ecc:frontend-design-direction', 'ecc:react-patterns'])}\n${ctx}\n` +
      `Make the Next.js app in ${ROOT}/web look and feel award-winning for a 2:30 demo video recorded at 1440px wide (read ${ROOT}/DEMO.md for the click path). ` +
      `Keep the design language (editorial + dense grid, emerald/amber/rose, serif headings). Fix known QA issues: graph labels overlapping, Kanban badges ` +
      `clipped ("Var"), header wrapping when the out-of-credits banner shows, duplicate Agent Thinking entries, Discovery grid not visible at narrower widths. ` +
      `Add tasteful motion (row/card enter, credit meter tick, thinking steps streaming in), clear loading/empty states, and a crisp "Proved / Dropped" ` +
      `citation chip. Only edit ${ROOT}/web/src (other agents edit api/ and docs). Run \`cd web && npx tsc --noEmit && npm run build\`; check pages with the ` +
      `dev server on port 3100 and screenshots. Report (<150 words).`, { ...M, label: 'polish:web' }),
    () => agent(`${useSkill(['ecc:doc-updater', 'ecc:architecture-decision-records', 'ecc:api-design'])}\n${ctx}\n` +
      `Write the two required docs from the actual code (read api/app/*, api/band_agents/*, api/rl/*, web/src/lib/*): ${ROOT}/README.md (what it is, live demo URL ` +
      `https://e6ohax5xwx6jbzz5mu2pjvx3v2zkimtq--u6faat.us.sb.tenki.sh, a mermaid architecture diagram, setup for web/api/band agents with env vars, ` +
      `sponsor integrations Band/Flexprice/Snyk/Tenki/Tavily and exactly how each is used, honest "live vs fallback" table, deploy via deploy.sh) and ` +
      `${ROOT}/ARCHITECTURE.md (the spec's System Design doc: query logic, graph ontology with the real Kùzu schema and the warm-path/hiring Cypher, reasoning loops ` +
      `incl. validator + Reviewer/Security + HITL + bandit + verifier-as-GRPO-reward, data flow per screen, bonus services). Only edit those two files. ` +
      `Report (<100 words).`, { ...M, label: 'polish:docs' }),
    () => agent(`${useSkill(['ecc:investor-materials', 'ecc:product-lens'])}\n${ctx}\nWrite ${ROOT}/PITCH.md for the "Startup viability 15%" criterion: ` +
      `problem with evidence, who pays, pricing per verified lead (metered by Flexprice), market size with sourced numbers (web search, cite URLs), ` +
      `competitors (from IDEATION.md), why now, moat (proof graph + warm-path data), 90-day go-to-market, and 5 crisp answers to likely judge questions. ` +
      `One page, plain words. Only edit PITCH.md. Report (<80 words).`, { ...M, label: 'polish:pitch' }),
  ])
  out.polish = pol
}

if (run('ui')) {
  phase('UI')
  const shots = `Look at the current app first: run \`cd ${ROOT}/web && npm run dev -- -p 3400\` (only one agent should start it; if :3400 already answers, reuse it) ` +
    `and screenshot all 6 pages (intake, icp, discovery, outreach, pipeline, model) at 1440px. User's decided direction: a LIGHT app like most pro tools — a deep blue/navy left sidebar (with subtle liquid-glass ` +
    `nav pills and the logo) and a clean light main canvas (off-white like #f7f8fb, white cards with hairline borders, never stark pure-white everywhere), ` +
    `one blue accent (#2f5bff), liquid glass used sparingly (sidebar, sticky top bar, hero/credits strip, modals) so it reads premium not gimmicky. ` +
    `Fonts are decided: Geist for headings and body, Geist Mono for numbers/scores/Cypher, and Instrument Serif italic for ONE accent word in each page hero. Do NOT edit code. ` +
    `Return a concrete spec (exact CSS values, Tailwind classes, component names/files to change) under 350 words.`
  const roles = [
    ['designer', ['ecc:liquid-glass-design', 'high-end-visual-design', 'ecc:frontend-design-direction'], 'Visual direction for the light canvas + blue sidebar: colour tokens (canvas, cards, borders, text, chips, status), where liquid glass goes and its exact recipe (backdrop-filter blur+saturate, translucent fill, specular top highlight, inner border), card elevation, the blue sidebar treatment.'],
    ['layout', ['ui-ux-pro-max', 'ecc:make-interfaces-feel-better'], 'Where buttons and controls go: primary vs secondary CTA hierarchy per page, one primary per view, button sizes/shapes (pill, glow on primary), toolbar/filter chip placement, spacing grid, alignment of hero/actions/tables.'],
    ['typography', ['design-taste-frontend', 'apple-hig'], 'Fonts are decided (Geist, Geist Mono, Instrument Serif italic accent) — load via next/font/google; define the full type scale, weights (400/500 only, 600 for tiny labels if needed), tracking, line-heights, tabular-number rules, and where each style is used.'],
    ['usability', ['ecc:click-path-audit', 'ui-ux-pro-max'], `Ease of use for the 2:30 demo in ${ROOT}/DEMO.md: fewest clicks, obvious next step on each page, empty/loading states, what a judge sees in 1 second per page, tooltips/labels to rename, anything confusing (e.g. the "every claim has a source" check text wrapping into a column).`],
    ['motion', ['emil-design-eng', 'ecc:motion-patterns'], 'Motion: page enter, card hover lift, glass sheen, credit meter, thinking stream, button press, kanban drag; durations/easings; reduced-motion.'],
    ['accessibility', ['ecc:accessibility'], 'Contrast on glass over dark (WCAG AA for 13px text), focus rings that fit the glass look, colour-only signals, hit targets.'],
  ]
  const specs = await parallel(roles.map(([key, skills, task]) => () =>
    agent(`${useSkill(skills)}\nYou are the ${key} agent in a UI design team for Kindred (${ROOT}/web, Next.js + Tailwind v4). ${task}\n${shots}`,
      { label: `ui:${key}`, phase: 'UI' })))
  const build = await agent(`${useSkill(['ecc:frontend-design-direction', 'ecc:react-patterns'])}\nYou are the UI orchestrator and implementer for Kindred (${ROOT}/web). ` +
    `Merge these specialist specs into one coherent design (resolve conflicts; designer wins on look, accessibility wins on contrast, usability wins on flow), ` +
    `write the merged spec to ${ROOT}/web/DESIGN-SYSTEM.md, then implement it across web/src (globals.css tokens, shell, all 6 pages). Only edit web/. Keep every feature working. ` +
    `Verify with \`npx tsc --noEmit && npm run build\` and screenshots of all 6 pages at 1440px (dev server on 3400; stop it at the end). Report (<150 words).\n\n` +
    roles.map(([k], i) => `## ${k}\n${specs[i] || '(no output)'}`).join('\n\n'), { label: 'ui:orchestrator', phase: 'UI' })
  const qa = await agent(`${useSkill(['design-review', 'ecc:accessibility'])}\n${ctx}\nDesign QA of the restyled Kindred web app (${ROOT}/web): start dev on 3400, screenshot all 6 pages at 1440px, ` +
    `check glass looks real, no stray white surfaces, type hierarchy, button hierarchy, contrast. Fix only small issues directly in web/src (tsc must pass), stop the server, and report (<120 words).`,
    { label: 'ui:qa', phase: 'UI' })
  out.ui = { build, qa }
}

if (run('review')) {
  phase('Review')
  const [fe, be, sec] = await parallel([
    () => agent(`${useSkill(['ecc:typescript-reviewer', 'ecc:react-patterns'])}\n${ctx}\nReview ${ROOT}/web/src for bugs that would break the live demo ` +
      `(runtime errors, broken imports, SSR issues with react-force-graph, unhandled fetch failures). List file:line and the fix. Max 10 findings.`,
      { label: 'review:web', phase: 'Review' }),
    () => agent(`${useSkill(['ecc:python-reviewer', 'ecc:fastapi-patterns'])}\n${ctx}\nReview ${ROOT}/api for bugs that would break the demo ` +
      `(route mismatches with web/src/lib/api.ts, missing fallbacks when an env key is absent, blocking calls in async routes). file:line + fix. Max 10.`,
      { label: 'review:api', phase: 'Review' }),
    () => agent(`${useSkill(['ecc:security-reviewer'])}\n${ctx}\nSecurity review of ${ROOT}: secrets in code or git, outbound send paths that could email a real prospect ` +
      `(must only ever go to DEMO_INBOX), SSRF in the source validator, CORS. file:line + fix. Max 8.`,
      { label: 'review:security', phase: 'Review' }),
  ])
  out.review = { fe, be, sec }
}

if (run('qa')) {
  phase('QA')
  out.qa = await agent(`${useSkill(['ecc:browser-qa'])}\n${ctx}\nThe app runs at ${(args && args.url) || 'http://localhost:3000'} (API at ${(args && args.api) || 'http://localhost:8000'}). ` +
    `Walk the demo path: intake → generate ICP → accept an expansion → discovery (select lead, see warm path + Cypher) → enrich until credits block → ` +
    `outreach approve/edit/reject → pipeline drag a card → analytics + audit. Report every step as PASS/FAIL with the error and a screenshot path.`,
    { label: 'browser-qa', phase: 'QA' })
}

if (run('gate')) {
  phase('Gate')
  out.gate = await agent(`${useSkill(['ecc:delivery-gate'])}\n${ctx}\nScore the current build against every row of the judging matrix (DESIGN section 1) and the ` +
    `submission checklist (prototype, public repo + README, 2–3 min video, design doc). For each: done / partial / missing and the fastest fix. ` +
    `End with GO or NO-GO for submission.`, { label: 'delivery-gate', phase: 'Gate' })
}

return out
