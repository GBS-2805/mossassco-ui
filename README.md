# mossassco-ui — Shelf

A repository of free type, icons, 3D, images and tools, with the licence of every
entry stated plainly: **FF** full freedom, **CN** credit needed, **P** prohibited
terms.

## Files

- `d.html` — the product. One file: markup, CSS, data and behaviour.
- `index.html` — redirect to `d.html`.
- `audit.mjs` — the gates; dependency-free.

`a.html`, `b.html`, `b2.html`, `c.html` are older attempts, linked from the footer.

## Gates

```sh
node audit.mjs          # everything that can be checked without the network being ready
node audit.mjs --live   # also asserts the published page is byte-identical to d.html
```

The audit fails on: a dead icon, photo or site URL; a record with no licence,
no https link, no copy or a duplicate name; a tier that disagrees with its
licence string; a category that loses a mark or a zero; the layout rules
(viewports, safe-area insets, breakpoints, thumb targets); the jitter
regressions (layout reads in the scroll handler, a transform tween, a rebuilt
sheet); a script that no longer parses; and the file's own weight — past 150 KB raw
or 45 KB gzip it fails, because every visitor downloads the whole thing. It
prints what each section costs on every run.

## What it costs

The file is the small part. Measured on 16 Nov 2026, cold cache, 412px wide,
after `networkidle`:

| | |
|---|---|
| the file | 78.9 KB raw · **24.1 KB gzip** (Pages sends gzip, not brotli; `max-age=600`) |
| fonts | **438.6 KB** over 11 files — 76% of the page |
| icons | 107.8 KB over 80 requests, deferred and `fetchpriority="low"` |
| total | **576.6 KB** over 96 requests |

`node weigh.mjs` reports the other number: what the two font stylesheets
*declare*. That is 44 latin woff2 and about 1,469 KB, an upper bound — a browser
fetches only the faces the rendered text uses, which is why the real page is
576 KB and not 1,469.

Two things that look like savings and are not:

- **Minifying.** Comments and all indentation removed: 1.3% gzipped (315 bytes).
  Whitespace is already free once gzip has run, and the file is hand-read.
- **Deferring the specimen fonts.** Every specimen shares one optical size,
  computed at load from all the families' metrics; loading a family late
  re-fits the whole wall and the type visibly resizes while you scroll.

Pages serves gzip only, so that 24.1 KB is the floor for the file itself.

## In CI

`.github/workflows/audit.yml` runs `node audit.mjs` on every pull request and
on every push to `main`; once a day it adds `--live` so a published page that
drifts from this file is caught without anyone committing.

`main` requires that `audit` check to pass before a pull request can merge.
There is no pull-request requirement and no push restriction, so commits can
still be pushed straight to `main` — protection stops a red pull request, not a
push. A push that fails the audit still lands, and the run goes red afterwards.

Live at https://gbs-2805.github.io/mossassco-ui/d.html
