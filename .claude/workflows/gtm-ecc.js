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
