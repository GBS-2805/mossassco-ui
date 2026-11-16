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
sheet); and a script that no longer parses.

Live at https://gbs-2805.github.io/mossassco-ui/d.html
