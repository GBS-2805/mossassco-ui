---
name: publish-and-verify
description: How to ship a change to the site and prove it is live — audit, commit to main, wait for Pages, check live parity, hand the owner the full URL. Use before ever telling the owner a change is live.
---

# Publish and verify

Nothing is live until this skill says it is. "I pushed it" is not live; Pages
has to build, and the published bytes have to be these bytes.

## 1. Audit before pushing

```sh
node audit.mjs
```

Must pass. If it fails, fix what it names — the audit is the owner's standing
rules in code, and working around a gate is worse than the bug it caught.

## 2. Commit to main

Commits go to `main` and say why in plain sentences:

```sh
git add -A
git commit -m "Move the cut rail onto the card, where the thumb is"
git push origin main
```

## 3. Wait for Pages, then check parity

Pages needs a few minutes after a push, and serves with `max-age=600`, so a
fresh check can still see the old page. Poll:

```sh
node audit.mjs --live
```

It fetches https://gbs-2805.github.io/shelf/d.html and compares bytes with
`d.html`. Expect "live: byte-identical to d.html" — usually within three or
four polls. A 404 or a mismatch is not live; keep waiting or investigate, never
claim it.

## 4. Hand the owner the link, in full

Every page, file, commit or screenshot gets its full clickable URL on the same
line as the thing it belongs to. The owner is on a phone; a bare path or "it's
live in the panel" cannot be opened.

- site: https://gbs-2805.github.io/shelf/d.html
- mockups: https://gbs-2805.github.io/shelf/mockups/<name>.html
- source: https://github.com/GBS-2805/shelf/blob/main/<path>
- a commit: https://github.com/GBS-2805/shelf/commit/<sha>

## 5. Watch the run

CI runs `node audit.mjs` on every push to main. If it goes red after a push,
that push still landed — fix forward with a new commit, never force-push.
