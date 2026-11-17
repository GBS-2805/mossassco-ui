---
name: add-a-face
description: How to add a face to the free index in d.html — verify the licence, download the specimen into fonts/, record the source in fonts/manifest.json, add the record, pass the audit. Use whenever a new typeface joins the Type · free section.
---

# Add a face to the free index

The free index promises one thing per entry: real type, served from here, with
the licence stated plainly. Every step below exists because skipping it has
broken the audit or the promise before.

## 1. Verify the licence before anything else

Read the licence at the foundry, not a mirror. The index only takes faces that
are genuinely free: OFL, MIT, ISC, Apache, CC0, GPL + font exception, public
domain. If the licence needs credit in the UI or forbids some use, the face
belongs in the paid sections with tier CN or P — not here.

Record the licence string exactly as the foundry states it; the audit checks
that a record's tier agrees with its licence string.

## 2. Download the specimen into fonts/

- One woff2 per face, named from the family: `fonts/<slug>.woff2`.
- If the foundry ships otf/ttf, convert to woff2 — every visitor downloads
  these files, so a fat specimen is a real cost.
- If the foundry ships a licence file, keep it beside the font as
  `fonts/<slug>.txt`.
- Convert only foundry files, never a re-rip from a font aggregator.

## 3. Record the source in fonts/manifest.json

Add one entry keyed by family name:

```json
"Family Name": {
  "c": null,
  "file": "slug.woff2",
  "h": null,
  "kb": 12.3,
  "l": "OFL 1.1",
  "n": "Family Name",
  "src": "https://the-exact-url-the-file-came-from",
  "u": "https://foundry-page/"
}
```

`src` is the exact URL the file was downloaded from, not the foundry home
page. `kb` is the file's real size. Faces with no downloadable file yet get
`"err": "no source"` and no `file`.

## 4. Add the record in d.html

Free-index records live in the data section and carry `c` (category: display /
sans / serif / mono), `n`, `h` (host for the credit line), `u`, `f` (font-family
slug matching the @font-face), `l`. Faces with a specimen get real copy —
`lead`, `about`, `use`, `watch` — written from the face's own character, not
filled in. A face with no file says so plainly instead of showing a control
that does nothing.

Add the `@font-face` rule next to the others in the stylesheet.

## 5. Pass the gates

```sh
node audit.mjs     # licences, dead URLs, duplicates, weight budget
node weigh.mjs     # what the specimen wall costs
```

The audit fails on a record with no licence, no https link, no copy, a
duplicate name, a tier that disagrees with its licence string, or the file
going past 150 KB raw / 45 KB gzip. Fix what it names, do not work around it.

## 6. Commit

Commits go to `main` and say why in plain sentences, e.g. "Add Galgo to the
free index, specimen and all". Then follow the publish-and-verify skill before
telling the owner anything is live.
