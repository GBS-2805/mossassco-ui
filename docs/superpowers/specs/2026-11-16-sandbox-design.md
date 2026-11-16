# Shelf Sandbox — short design

**Status:** proposed, not approved. Nothing gets built until the owner approves this page.
**Date:** 2026-11-16
**Goal:** a page on the Shelf site where the owner can pick one of the 80 faces, set the
specimen, choose a real cut and a motion, watch the actual index card behave, and copy the
result out — so a direction can be shown by making it, not by asking for it.

## Why this exists

Every round of feedback so far has been a still image (screenshots, annotated screenshots),
and stills cannot say what moves. Play — the phone app that did design-and-motion in one
place — was wound down after Apple acquired its team, so nothing off the shelf fills the
gap. What Shelf already owns is the hard part: 80 real faces, their real cut names, the card
CSS, and a specimen that fits itself to the width. A sandbox is the smallest page that turns
those into something the owner can drive.

## Goals

- Choose a face and see it in the real card, at real size, immediately.
- Choose a cut only where a cut exists (Azeret 36, Geist 9, Honey 7, Galgo 3 …; the other 69
  show their single real name and no control).
- Set the specimen text once and have it drive every preview, as `Shelf - 123` does today.
- Feel the motion: a cut change animates at a chosen speed, and the chosen speed can be
  compared against another.
- Copy the result as one self-contained HTML file that opens next to `fonts/`.

## Non-goals

- A general app builder, multi-screen flows, or native iOS elements.
- A code editor (that is v2, behind a toggle, if v1 proves useful).
- Accounts, a database, or saving back into the repo. A public page cannot hold a token.
- Publishing anything, or a second place to browse the index.

## Anti-goals

- A second copy of the card CSS that drifts from `d.html`.
- A preview that renders in a fallback face — the exact thing the index was built to stop.
- A knob that does nothing (one cut, one state, no change).
- Any byte added to `d.html`.

## Constraints

- One static page on GitHub Pages: no server, no build step at request time, no third-party
  script.
- Phone first: 390px, thumb-reachable controls at the bottom, nothing scrolls sideways at
  320px.
- Flat: hairlines, no pills, no filled chips, controls act in place.
- The 80 woff2 files stay the only type assets; no new family is fetched.
- The repo stays dependency-free; every check runs as `node <script>.mjs`.

## Approaches considered

| | What it is | Cost | Verdict |
|---|---|---|---|
| **A. Knob sandbox** | Five flat controls over the real card; copy-the-HTML at the end | ~20 KB of JS, no dependency, no iframe | **Chosen.** Reuses code already proven at 390 and cannot drift from the card if checked |
| **B. Lite code sandbox** | A above plus a CSS textarea and a console bridge | +8 KB, plus the phone keyboard and smart-quote problem (iOS turns `'` into `’` and the code stops parsing) | Deferred: v2 behind a toggle on the same page |
| **C. Embed LiveCodes** | Free, open-source, client-side playground from a CDN | ~0 KB of ours | Rejected: it is a whole app inside a phone screen, it knows nothing about the 80 faces, and it teaches code rather than showing type |

## The design (v1)

One page, `sandbox.html`, three bands top to bottom.

1. **Preview — the real card.** The same markup and CSS the index uses: hairline box, name
   top-left, `TYPE ● FF` top-right, specimen fitted with the existing fit logic, note line
   under it. The specimen animates when the cut, size or motion changes.
2. **Controls — five flat rows**, each a hairline apart, none of them a pill:
   - **Face** — a single-line strip of names, each set in its own face, snapped so the centred
     name is the chosen one (the lane pattern from the two-lane mockup).
   - **Cut** — the real names from the font file, each drawn in its own cut; absent entirely
     when the family has one cut, where the name is printed instead.
   - **Specimen** — a text field, defaulting to the same string as `d.html`, with autocorrect,
     autocapitalisation and spellcheck off.
   - **Size** — a horizontal drag track, 16–74px, with the value printed live; 74px is the
     cap the index already uses.
   - **Motion** — three named speeds for the cut change (tight, standard, slow) plus a replay
     tap, so a speed can be felt rather than described.
3. **Footer — thumb reach.** `Copy HTML`, `Reset`, and a quiet line saying when the draft was
   last kept.

**State** lives in `localStorage` under a single namespaced key, written on change, restored on
load, and cleared by `Reset`.

**Export** builds a minimal standalone document: the chosen face's `@font-face`, the card CSS,
the fitted specimen and the chosen motion, downloaded as `<face>-card.html`. Dropped into
`mockups/`, it opens as-is because it references `fonts/` relatively.

## What it reuses

| Piece | Source | How |
|---|---|---|
| 80 faces and their families | `d.html` `@font-face` block, `fonts/*.woff2` | Same rules, same files, no new requests |
| Real cut names | `mockups/faces.json` (generated from `fvar`) | Regenerated for all 80 faces by the existing fontTools script, shipped as data |
| Fit-to-width specimen | `fitOneType()` / 0.93 factor / 74px cap | Copied logic, same constants |
| Card look | `.faces .fc`, `.faces .fc .word`, `.faces .fnote` | Verbatim, and gated against drift |
| Lane behaviour | `mockups/two-lane.html` (snap, nearest-centre, rAF lock) | The drag and centring code |
| Specimen string | `var PTX` in `d.html` | Read by the audit, so the two cannot fork |
| Publishing | GitHub Pages | Another URL, no server |

## Size budget

Measured today: `d.html` 93.0 KB raw / 26.4 KB gzip; `mockups/two-lane.html` 9.4 KB raw /
3.6 KB gzip (specimen + list + lane, already working). The sandbox adds knobs, export, state
and the cut data to roughly that same shape.

- `sandbox.html`: **≤ 45 KB raw and ≤ 14 KB gzip**, printed by the audit like `d.html`'s line.
- Cut data: **≤ 24 KB raw / 3 KB gzip** once generated for all 80 faces.
- `d.html`: **0 bytes changed**. The shelf's download must not grow for a tool most visitors
  will never open.

## Checks it must pass

Executable, added to `audit.mjs`:

1. `sandbox.html` exists and is inside both size budgets, reported with its own weight line.
2. **No third party:** no `<script src>`, no off-origin `<link>` beyond the two font
   stylesheets `d.html` already allows.
3. **No drift:** the exact text of `.faces .fc{…}` and `.faces .fc .word{…}` from `d.html`
   appears verbatim in the sandbox; editing one side alone fails.
4. **Faces resolve:** every face the sandbox offers maps to an existing `fonts/<file>.woff2`
   and to an `@font-face` family of the same name (the existing orphan check, reused).
5. **One specimen string:** the sandbox's default equals `PTX` read out of `d.html`.
6. **Export exists:** an `exportHTML(` function and a Blob download path are present, and the
   page's inline script parses under `node --check`.
7. **Live parity:** `node audit.mjs --live` fetches `sandbox.html` too and compares bytes.
8. **`d.html` untouched:** the commit that adds the sandbox shows zero changed lines there.

Manual, recorded here because no static check can see it:

9. At 390 and at 320: no sideways scroll, every control ≥44px tall, specimen never clipped,
   card hairline intact.
10. Exported file opened on its own: specimen in the right face, not a fallback.
11. A family with one cut shows no cut control at all.

## Risks

- **Drift from the card** — mitigated by check 3, which is why the CSS is copied rather than
  imported.
- **Phone keyboard** — the text field is the only place typing is needed; autocorrect and
  smart quotes are off, and a paste is normalised to straight quotes.
- **Scope creep into a design tool** — v1 is five knobs and an export; anything else is v2.
- **A second surface to maintain** — the page stays one screen; if it grows past the budget,
  the budget fails before the owner notices.
- **Expectation** — this is not Play: no native elements, no Core Animation. Motion is CSS
  transforms and opacity, which composite, so it reads as immediate on a phone; it cannot
  reproduce SwiftUI behaviour.

## Left to the builder

- Final easing numbers for the three speeds, and whether the third is useful at all.
- Whether the face strip is searchable by typing, or scroll only.
- The export file's default name, and whether it lands in `mockups/` or at the root.
- Whether the licence line appears on the card or only in the export.

## One question for the owner

Does the sandbox ship as a linked product page (`sandbox.html`, reachable from the index), or
as a private tool under `mockups/` until it has earned a link? My call is the latter first:
`mockups/sandbox.html`, no link from the shelf, promoted once it has been used twice.
