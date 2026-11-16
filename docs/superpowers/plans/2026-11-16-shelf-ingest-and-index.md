# Shelf Ingest and Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every sheet (type, icons, 3D, images, tools) fillable by one repeatable command that reads each source's licence at source, and change the wall so a category of 163 faces stays browsable.

**Architecture:** Records leave `d.html` and become data (`data/records.json`), generated into the file by `build.mjs` between markers so `d.html` stays a single deployable file. A controlled licence vocabulary (`data/licenses.json`) makes the tier a property of the licence, not a guess; `ingest.mjs` crawls a source manifest with bounded concurrency, emits candidates with a dated quote as evidence, and refuses to emit a tier it cannot source. The UI gains an index mode and on-approach specimen painting so a 200-record wall never paints what is off screen.

**Tech Stack:** Node 22 built-ins only (`node:test`, `fetch`, `node --check`), plain HTML/CSS/JS in `d.html`, GitHub Pages, existing `audit.mjs` as the gate.

**Spec:** the conversation of 2026-11-16 (the 163-face uncut.wtf audit) plus `audit.mjs`, which is the executable spec of the tier rules and the layout budget.

## Global Constraints

- No dependencies. Every script runs on stock Node 22 and `node <script>.mjs`.
- `d.html` stays the single deployable file: all markup, CSS and behaviour inside it, data inlined by `build.mjs`.
- Tiers are `pd` (FF), `open` (CN), `terms` (P), in that order, and every record's mark is derived from its licence string, never typed.
- Type specimen sizes stay 21.0–23.7px at 390px; card heights 64/99/109px at 390 (69/107/117 at 412).
- Every record carries `lic`, `href`, `copy.lead`, `copy.about`, at least two `copy.use` lines and a `copy.watch`; names are unique and links use `rel="noopener"`.
- Nothing the licence forbids redistributing is stored in the repo. The repo hosts no font or image binaries.
- `node audit.mjs` and `node audit.mjs --live` must pass before any push; direct pushes to `main` are allowed and expected.
- Commits are plain sentences saying why, one line under 72 characters plus a body, ending in the Codebuff footer.

## Review Focus

1. A face that is OFL but whose foundry asks for credit (Velvetyne, Collletttivo) — must read CN, never FF.
2. A source whose HTML or JSON schema changes — the run must fail naming the item and URL, never silently drop it.
3. A licence that forbids redistribution (Licence Amicale, CC BY-ND) — the preview must not require the repo to host the file.
4. A category with 200 records — first paint and scroll must stay inside the frame budget, not degrade silently.
5. The same face reachable from two sources (a GitHub repo and uncut.wtf) — one card, both links, no duplicate name.

---

### Task 1: Licence vocabulary

**Files:**
- Create: `data/licenses.json`
- Create: `license.mjs`
- Test: `test/license.test.mjs`

**Interfaces:**
- Produces: `licenceFor(quote: string): {id: string, display: string, tier: 'pd'|'open'|'terms'} | null`
- Produces: `licenceById(id: string)` — same object or `null`
- Produces: `tierOfDisplay(display: string): 'pd'|'open'|'terms'` — first vocabulary entry whose `display` prefixes the string, else `'terms'`

- [ ] **Step 1: Write the failing test**

```js
// test/license.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { licenceFor, tierOfDisplay } from '../license.mjs';

test('credit-asked OFL outranks plain OFL', () => {
  assert.equal(licenceFor('Remember to credit the type designer').id, 'ofl-credit');
  assert.equal(licenceFor('SIL Open Font License, Version 1.1').id, 'ofl');
});
test('the restricted licences in the uncut audit keep their tier', () => {
  assert.equal(licenceFor('Creative Commons Attribution-No Derivatives 4.0').tier, 'terms');
  assert.equal(licenceFor('Licence Amicale').tier, 'terms');
  assert.equal(licenceFor('Creative Commons Zero').tier, 'pd');
});
test('an unrecognised string is null, not a default tier', () => {
  assert.equal(licenceFor('free for commercial use'), null);
});
test('display strings map back to their tier', () => {
  assert.equal(tierOfDisplay('OFL 1.1'), 'pd');
  assert.equal(tierOfDisplay('CUTE · credit'), 'open');
  assert.equal(tierOfDisplay('CC BY-ND 4.0'), 'terms');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/license.test.mjs`
Expected: FAIL — `Cannot find module '../license.mjs'`.

- [ ] **Step 3: Write `data/licenses.json`**

Ordered, most specific first. Each entry: `{id, display, tier, pattern}`. Entries to include, with the quotes they were read from: `ofl-credit` (Velvetyne FAQ "you must credit the name of the type designer", Collletttivo "remember to credit"), `cute` (Bye Bye Binary CUTE terms), `ofl`, `cc0`, `cc-by`, `cc-by-sa`, `cc-by-nc` and `cc-by-nd` (both `terms`), `amicale` ("prevents anyone to post the licensed creations on any website"), `itf-free` (fontshare, "no conversion"), `unsplash`, `pexels`, `mit`, `isc`, `apache`, `freeware-personal` ("free for personal use only"), `gpl-font` (GNU FreeFont). No catch-all entry: unknown must stay null.

- [ ] **Step 4: Implement `license.mjs`**

`licenceFor` lowercases the quote and tests each `pattern` (a case-insensitive regex source) in file order, returning the first entry that appears. Keep the file under 60 lines.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/license.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add data/licenses.json license.mjs test/license.test.mjs
git commit -m "Make the licence a vocabulary entry, so a tier can be checked"
```

---

### Task 2: Records become data, generated into d.html

**Files:**
- Create: `data/records.json`
- Create: `records.mjs`
- Create: `build.mjs`
- Modify: `d.html` — replace the 37 inline `T()/IC()/IM()/I.push()` calls with `<!-- DATA:START -->` … `<!-- DATA:END -->`
- Modify: `audit.mjs` — marker and freshness gates
- Test: `test/records.test.mjs`

**Interfaces:**
- Consumes: `tierOfDisplay` from Task 1.
- Produces from `records.mjs`: `validateRecord(r): string[]` — schema problems, empty when valid; `slug(name): string`.
- Produces from `build.mjs`: `renderBlock(records): string` — the `T()/IC()/IM()` call text for the marker region; `buildCli(argv)` — `--check` exits 1 when `d.html` is stale.

- [ ] **Step 1: Write the failing test**

```js
// test/records.test.mjs
import { validateRecord } from '../records.mjs';
const base = { id:'inter', name:'Inter', kind:'type', lic:'OFL 1.1', href:'https://fonts.google.com/specimen/Inter',
  copy:{ lead:'x', about:'y', use:['a','b'], watch:'z' }, evidence:{ url:'https://fonts.google.com/specimen/Inter', quote:'SIL Open Font License 1.1', checked:'2026-11-16' } };

test('a complete record validates', () => assert.deepEqual(validateRecord(base), []));
test('a record with no evidence fails', () => {
  assert.match(validateRecord({ ...base, evidence: undefined }).join(' '), /evidence/);
});
test('a record with fewer than two use lines fails', () => {
  assert.match(validateRecord({ ...base, copy: { ...base.copy, use: ['a'] } }).join(' '), /use/);
});
test('a restricted licence with a cdn preview fails', () => {
  assert.match(validateRecord({ ...base, lic:'Licence Amicale', preview:{ mode:'cdn', url:'x' } }).join(' '), /redistribut/);
});
```

- [ ] **Step 2: Run it and watch it fail** — `node --test test/records.test.mjs`, expected `Cannot find module`.

- [ ] **Step 3: Write `data/records.json` from the current file**

Convert the 37 calls with a throwaway script, keeping every string byte-identical, then delete the script. Records missing copy or evidence get `copy:null` / `evidence:null` and the audit is expected to flag them — fix those by hand until counts match today: 37 records, FF 23 · CN 1 · P 13, 8 sections.

- [ ] **Step 4: Implement `records.mjs`**

`validateRecord` checks, in this order: `id` slug, unique `name` (checked in `build` across all records), `lic` present and `licenceFor`-compatible via `tierOfDisplay`, `href` https, `copy` with two `use` lines, `evidence.url` https plus `evidence.quote` plus `checked` `YYYY-MM-DD`, and `preview.mode` in `cdn|remote-image|frame`, with `cdn` forbidden when `tierOfDisplay(lic) === 'terms'` unless `preview.redistributable === true`. Each failure is one sentence naming the field.

- [ ] **Step 5: Implement `build.mjs`**

`renderBlock` groups by kind, emits `T(name, fam, label, {…})` / `IC(…)` / `IM(…)` with keys in the current order, and joins with `\n`. The CLI replaces the text between the two markers in `d.html`; `--check` recomputes and exits 1 with the first differing line.

- [ ] **Step 6: Prove nothing moved**

Run: `node build.mjs && node audit.mjs && node audit.mjs --live`
Expected: `37 records · FF 23 · CN 1 · P 13`, `8 sections`, live parity passes.

- [ ] **Step 7: Add the audit gates**

In `audit.mjs`: both markers exist exactly once and in order; `renderBlock` output equals the marker region (import `build.mjs`); `data/records.json` parses; every record validates; `d.html` contains no `T(`/`IC(`/`IM(` call outside the marker region; the counts printed by the audit are recomputed from the JSON, not from the file text.

- [ ] **Step 8: Break it on purpose**

Change one record's `lic` to `CC BY-NC 4.0` without regenerating; `node audit.mjs` must exit 1 saying the file is stale. Regenerate, commit.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "Move the records out of d.html so a script can write them"
```

---

### Task 3: Ingest one source end to end

**Files:**
- Create: `data/sources/uncut.json`
- Create: `ingest.mjs`
- Create: `test/fixtures/uncut-fonts.json`, `test/fixtures/uncut-foundry.html`
- Create: `data/candidates/uncut.json` (generated, committed)
- Test: `test/ingest.test.mjs`

**Interfaces:**
- Consumes: `licenceFor` (Task 1), `validateRecord` shape (Task 2).
- Produces: `runSource(source, opts): Promise<{candidates, problems}>` where a candidate is `{id, name, authors, kind, href, dl, lic, tier, evidence:{url, quote, checked}, preview:{mode, url}, status:'verified'|'unverified'}`.
- Produces CLI: `node ingest.mjs --source uncut [--check] [--cache .cache]`, exit 1 on any `problems`.

- [ ] **Step 1: Save the fixtures**

`uncut-fonts.json` = the real `https://uncut.wtf/fonts.json` (24 KB). `uncut-foundry.html` = the Karrik page and the Betatron page, saved as they are today.

- [ ] **Step 2: Write the failing test**

```js
test('a foundry page that asks for credit reads as open, not pd', …);
test('an item whose page 404s becomes a problem, not a candidate', …);   // fetch stub returns 404
test('two runs over the same fixtures are byte-identical', …);            // JSON.stringify equality
test('the cache makes the second run hit the network zero times', …);     // counting stub
```

- [ ] **Step 3: Run and watch it fail** — `node --test test/ingest.test.mjs`.

- [ ] **Step 4: Write `data/sources/uncut.json`**

```json
{
  "id": "uncut",
  "label": "UNCUT.wtf",
  "kind": "type",
  "list": { "url": "https://uncut.wtf/fonts.json", "items": "categories.*.fonts" },
  "item": { "urlField": "dl", "nameField": "name", "authorField": "authors" },
  "licence": { "scope": "page", "follow": ["github.com"], "repoFiles": ["LICENSE", "OFL.txt", "LICENSE.md"] },
  "preview": { "mode": "frame" },
  "creditAsked": ["velvetyne.fr", "collletttivo.it"]
}
```

`creditAsked` promotes `ofl` to `ofl-credit`: the foundry's own words outrank the licence name.

- [ ] **Step 5: Implement `ingest.mjs`**

Crawl order `list → items → page (or repo licence file)`; concurrency 8; 15 s timeout; one retry on network error or 5xx, never on 403/404 (mirror the icon probe in `audit.mjs`); cache raw bodies by URL hash, `--check` reads the cache first. Candidate ids are `slug(name)`; duplicates inside one source are a problem. `problems` entries are `{id, url, reason}` and any non-empty `problems` exits 1.

- [ ] **Step 6: Run it for real**

`node ingest.mjs --source uncut`
Expected: 163 candidates, `verified` 72–97 depending on how many JS pages render server-side, `unverified` counted, zero problems for the 404s (they become candidates with `status:'unverified'` and a `problems` entry only if the same URL failed twice on separate runs).

- [ ] **Step 7: Derive the preview, and refuse what may not be pulled**

For each candidate, in this order: `cdn` when the manifest declares a public webfont URL for that family (Google Fonts, jsDelivr, fontshare) — the shelf references it, never copies it; `remote-image` when the foundry page declares an `og:image` and the page is not in `creditAsked` (a foundry that asks for credit does not thereby permit hotlinking its artwork); `frame` otherwise, which renders the name in the shelf's own stack next to the licence line. `cdn` and `remote-image` are both refused when `tier === 'terms'`. Write the reason into the candidate as `preview.why`, so the frame that shows no artwork always says why.

- [ ] **Step 8: Record the result**

Commit `data/candidates/uncut.json`. The file is the audit trail: every candidate carries the quote and the date it was read. Head it with a comment-less `meta` object `{generated, source, counts:{pdf, open, terms, unverified}}`.

- [ ] **Step 9: Commit**

```bash
git add data/sources data/candidates ingest.mjs test
git commit -m "Read a source's licences at source, with the quote as proof"
```

---

### Task 4: Index mode and search

**Files:**
- Modify: `d.html` — `MODE`, `CAP=12`, `#q`, `.cat--long`, `renderIndex()`
- Modify: `audit.mjs` — mode, cap and search gates

**Interfaces:**
- Consumes: the inlined records block (Task 2).
- Produces: `renderMode(cat, mode)`, `filterRecords(q)`.

- [ ] **Step 1: Add the failing gate first**

In `audit.mjs`, assert `d.html` contains `var CAP=12`, `renderIndex(`, `id="q"`, `.cat--long`, and a `.index .row` rule whose height is under 44px. Run `node audit.mjs`; expect exit 1 naming the first missing one.

- [ ] **Step 2: Implement `renderIndex`**

A row is one line: `name · KIND · FF/CN/P badge · source host`, height 40px at 390, whole row tappable, `aria-label` as on the wall. A category with more than `CAP` records renders `CAP` rows plus a `all 163` toggle that swaps the category body; with `CAP` or fewer it keeps today's muscles unchanged.

- [ ] **Step 3: Add search**

`#q` filters on substring against name, author, host and `copy.use` lines, case- and diacritic-insensitive (`normalize('NFD').replace(/\p{Diacritic}/gu,'')`). It composes with the licence tabs through the existing `applyFilter`. Empty result prints `nothing matches "x"` in the empty-state slot.

- [ ] **Step 4: Check it at 37 and at 200**

Run the app, then in the console `I.splice(0,0,...Array(170).fill(I[0]).map((r,i)=>({...r,id:r.id+i,name:r.name+i})))` before `paint()`, reload, and confirm the type section is a capped index. Measure: type 21.01–23.71px, card heights 64/99/109 at 390 unchanged in wall mode.

- [ ] **Step 5: Commit**

```bash
git add d.html audit.mjs
git commit -m "Give a long category an index, so 163 faces can be found"
```

---

### Task 5: Paint specimens on approach

**Files:**
- Modify: `d.html` — `io` observer, `paintQueued`, `content-visibility`
- Modify: `audit.mjs` — budget gates

**Interfaces:**
- Consumes: `fitOneType`, `paintCard`, `paintSheet` as they exist.
- Produces: `schedulePaint(el)`, called by the observer with `rootMargin:'400px 0px'`.

- [ ] **Step 1: Write the gate**

`audit.mjs` asserts: an `IntersectionObserver` is constructed with `rootMargin`; `.frame` declares `content-visibility:auto` and `contain-intrinsic-size`; `fitOneType` is only called from the observer path or the first visible screen.

- [ ] **Step 2: Implement**

Observe every `.frame` at build time; unobserve after first paint. Queue at most one paint per rAF, ordered by distance to viewport centre. Keep `fitTypes(scope)` for the visible batch so the measure pass stays one layout read.

- [ ] **Step 3: Measure, do not claim**

With the 200-record fixture, scroll 40 frames at 390 and 412 in the browser: worst frame gap ≤ 24 ms, zero layout reads inside the scroll handler. Record both numbers in the commit body.

- [ ] **Step 4: Commit**

```bash
git add d.html audit.mjs
git commit -m "Paint a specimen when it is near, not when the page loads"
```

---

### Task 6: Roll the pipeline to the other sheets, and keep it honest

**Files:**
- Create: `data/sources/{icons,three-d,photos,tools}.json`
- Modify: `ingest.mjs` — `--all`
- Modify: `.github/workflows/audit.yml` — weekly `--check`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above. Produces `node ingest.mjs --all --check`.

- [ ] **Step 1: Write one manifest per sheet** using the Task 3 shape: icons from jsDelivr package manifests, 3D from Poly Haven's API, photos from a fixed hand-picked list, tools from a hand-written list of `{name, href, quote}`. A sheet with no enumerable list carries its items inline in the manifest and is marked `"manual": true`.

- [ ] **Step 2: Implement `--all`** to run manifests sequentially, one cache directory per source, and to write `data/candidates/<id>.json` for each.

- [ ] **Step 3: Write the duplicate test**

```js
// a face on GitHub and on uncut.wtf is one record with two links
test('the same face from two sources collapses to one card', () => {
  const merged = mergeCandidates([ghCandidate, uncutCandidate]); // both name:'Karrik'
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].also[0].href, uncutCandidate.href);
});
```

Matching is `slug(normalise(name)) + first author surname`, not name alone: different designers ship same-named faces. The winner keeps the richer `preview` and the stricter `tier`; the loser's URL lands in `also[]`, which the sheet prints under the row as a second link.

- [ ] **Step 4: Implement `mergeCandidates(list)`** in `ingest.mjs`, run it across sources in `--all`, and add a gate: no two records in `data/records.json` share a merge key.

- [ ] **Step 5: Add the drift gate** — `node ingest.mjs --all --check` exits 1 when a committed candidate's licence no longer matches the fresh read, naming the record, the old quote and the new one. Add it to the weekly schedule step next to `--live`; pull requests keep the offline `node audit.mjs`.

- [ ] **Step 6: Prove the gate bites** — edit one candidate's `lic` by hand, run `--check`, expect exit 1 with both quotes; restore.

- [ ] **Step 7: README** — one paragraph: what `ingest.mjs` does, that a record cannot exist without a quote, and that unknown licences come out as P by design.

- [ ] **Step 8: Commit and push**

```bash
git add -A && git commit -m "Let every sheet be filled and re-checked the same way"
```
