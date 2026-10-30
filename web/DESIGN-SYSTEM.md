# Kindred design system: light canvas, navy sidebar

Merged from five specialist specs (designer, layout, typography, usability, motion, accessibility).
Conflict rules: the designer decides the look, accessibility decides contrast, and usability decides the flow.

## Direction
- **Product.** A GTM workbench used again and again across six steps (Intake, ICP, Discovery, Outreach, Pipeline, Learning). It should be dense, quiet and easy to scan.
- **Shape.** Same as most tools (Linear, Attio, Stripe). A navy rail runs flush to the left edge. A white canvas sits on it as one rounded sheet (`my-2 mr-2 rounded-[18px]`). Content lives on white cards.
- **Memorable detail.** The page title carries one Instrument Serif italic accent word in accent blue. The active nav item is a glass pill that slides between steps.

## Tokens (`src/app/globals.css`)
| Token | Value | Note |
|---|---|---|
| canvas `--bg-0` | `#f7f8fb` | No grain and no radial glows (a11y and designer agree) |
| card | `#fff`, 1px `#e6e9f0`, `--shadow-card` | Radius 16px. Inner elements use 8px so the corners stay concentric |
| accent | `#2f5bff`, hover `#2449e0` | 5.2:1 on white. Never use it as text on navy (3.5:1) |
| navy | `#0d1d52 → #081236` + accent glow top-left | `.shell-navy`. Falls back to solid `#0b1640` when reduced transparency is on |
| neutral 50–300 | `#f4f6fa #eef1f6 #e6e9f0 #d5dae4` | Fills and hairlines |
| neutral 400–950 | `#6b7590 #5b6683 #4d5873 #3d4862 #2a3450 #1f2a44 #0b1430` | **a11y ladder wins** over the designer and typography ramps. 500 is the floor for 13px text (5.6:1); 400 is for placeholders and meta only |
| status `-300` (text) | emerald `#047857`, rose `#be123c`, amber `#92400e`, violet `#6d28d9`, sky `#0369a1` | All pass 4.5:1 on their own `-50` fill |
| status `-50`/`-200` | Tailwind light tints | For chip fills and rings |
| input boundary | `#8a93a8` | SC 1.4.11, 3.2:1 |

`.nav-dark` re-scopes the old dark neutral ladder inside the sidebar, so Nav markup keeps using `text-neutral-*`.
The legacy aliases `font-serif` and `font-display` are **kept** and map to Geist semibold, because about 20 headings use them. Typography asked for them to be deleted; we kept them to protect existing markup. The editorial serif is only `--font-editorial`.

## Surfaces
- `.glass` / `.glass-2` are white cards. The names are kept so the markup stays the same. `.glass-card` adds a hover lift (−1px, blue-tinted shadow, border `#d6dcf0`) for fine pointers only.
- **Liquid glass appears only where something scrolls under it:**
  - `.glass-bar` is the sticky header inside `<main>` (`rgba(255,255,255,.78)`, `blur(16px) saturate(180%)`).
  - `.glass-3` covers modals, tooltips and the credits popover (`.86` + `blur(24px)`, deep shadow).
  - `.scrim` is the modal overlay (`rgba(11,18,48,.32)` + `blur(6px)`).
- `.glass-band` is the card header strip (`#fafbfd` with an inset hairline). `.glass-chip` is a white chip with a hairline ring.
- Fallbacks: `prefers-reduced-transparency` makes the glass solid white; `prefers-contrast: more` darkens card borders to `#9aa3b5`.

## Shell
- **Nav** (`w-60`):
  - Logo rings are white plus `#5b7cff`, with a 16px semibold wordmark.
  - A "Workflow" label sits above the steps (11px uppercase).
  - Items are `h-12` pills. Hover is `bg-white/5`.
  - The active item is a single absolutely positioned glass pill that slides with `translateY(index*52px)` over 220ms ease-in-out. It has a 2px `#9fd3ff` left bar, semibold text and `aria-current="page"`, so the active state never depends on colour alone.
  - Hints are on one line at 11px `#aab6d3` (8.8:1). The footer uses `#8d99b8`.
- **Header**: sticky `h-14 px-8`, with the "Selling Tenki" chip on the left. The credits meter and the Agent Thinking button sit on the right as ghost buttons.
- **Agent Thinking** is a white right column inside the sheet (`border-l`). It uses `aria-live="polite"` and has an sr-only "live" label. Cypher blocks are Geist Mono 11px on `#f4f6fa`. Dropped rows use `bg-rose-50` with a rose left bar.

## Type
| Role | Spec |
|---|---|
| `.k-hero` | 32/38, 600, −0.025em (intake) |
| `.k-title` | 28/32, 600, −0.02em (every other page h1) |
| h2 section | 20px semibold −0.015em |
| `.k-h3` card title | 15/22, 500 |
| body | 14/22; tables and chips 13/12px |
| label | 11px, 600, uppercase, +0.04em. Only for table headers, the nav group label and verdict labels |
| numbers | Geist Mono, `tabular-nums slashed-zero`, right-aligned in tables |
| accent word | `.k-accent` / `.accent-word`: Instrument Serif italic, 1.08em, `#2f5bff`. One per page |

Geist loads at 400/500/600 (300 is dropped). Every font uses `display: swap`.

## Buttons (`ui/Button.tsx`)
- `primary`: `h-10 px-5 rounded-full bg-accent`, inner highlight plus a soft blue shadow. Only **one** per page, at the top right.
- `secondary`: `h-9`, white, with a hairline border.
- `ghost`: `h-8`, `hover:bg-black/[.04]`.
- `success`: emerald, for inline approve actions.
- All variants: `active:scale-[.97]`, and transitions list their exact properties (never `all`).

| Page | Primary |
|---|---|
| Intake | Generate ICP. "Use Tenki demo" is primary until the basics are filled, then they swap (existing logic) |
| ICP | Find companies → /discovery |
| Discovery | Run discovery (promoted from ghost) |
| Outreach | Approve all passing (n). Opens the confirm modal |
| Pipeline | None. "Simulate 300 sends" is secondary in the Learning loop card |
| Model | Review drafts → /outreach. There is no training-run API, so we added no fake "Start training" button |

## Flow fixes (usability)
- `/intake` crashed (`ArrowRight` was not imported). Fixed.
- Discovery auto-selects the top A-tier account, so the graph, the warm path and the Cypher show without a click.
- Discovery's grid and graph now sit in one white card. The filters are a band of `h-8` pill chips (tier chips use `aria-pressed`), the selects have a visible `#8a93a8` boundary, and the count is in mono on the right.
- The empty state on the graph pane now says "Select a company to see who can introduce you".
- The outreach checklist is a 2-column grid. Failure detail sits on its own line, and an sr-only pass/fail label is added. "Dropped" becomes "Unverified · dropped".
- The ICP confidence bar is narrower (`w-10`, `aria-hidden`), so names wrap less.
- The Model page's developer message ("set NEXT_PUBLIC_API_URL") is replaced with plain copy.

## Motion (CSS only, no library)
- `--ease-out (.23,1,.32,1)`, `--ease-in-out (.77,0,.175,1)` and `--ease-drawer (.32,.72,0,1)`.
- Durations: press 120, fast 160, base 220, enter 280.
- Page enter: 6px, blur 2px, 280ms. The `.wp-rise` stagger steps 40ms and is capped at 6.
- The card sheen has been removed.
- Kanban drag: `scale(1.02) rotate(.5deg)` with an accent border. The drop column gets a 4% accent tint and an inset ring.
- Credits fill is an accent gradient. It turns amber below 15% and rose when blocked, and the ring pulses only 3×.
- Reduced motion turns off every transform: the nav slide, the drag tilt and button presses. Fades are kept.

## Not done (follow-ups)
- Kanban "Move to…" keyboard menu (SC 2.5.7).
- The full sweep of 79 `text-[11px]` uses into tokens.
- The sticky filter strip at `top-14`. The discovery card scrolls internally instead.
