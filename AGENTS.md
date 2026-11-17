# Rules for this repo

Read these before touching anything. They are the owner's standing
instructions, learned the hard way.

## Always give clickable links

Every time you refer to a page, a file, a commit or a screenshot, give the
address in full as a URL the owner can tap, on the same line as the thing it
belongs to. They are on a phone: a bare path such as `mockups/x.html` or a
sentence like "it's live in the Browser panel" is not a link and cannot be
opened. If a page is published, give its `https://gbs-2805.github.io/...`
address, not a preview host that needs a sign-in, and not the file name alone.

- site: https://gbs-2805.github.io/shelf/d.html
- mockups: https://gbs-2805.github.io/shelf/mockups/<name>.html
- source: https://github.com/GBS-2805/shelf/blob/main/<path>
- a commit: https://github.com/GBS-2805/shelf/commit/<sha>

## The owner is on a phone

Design and verify at 390–430px first. Nothing may scroll sideways at that
width; check it rather than assuming. Controls belong within thumb reach, and
the bottom of the screen is where a thumb is, not the top right.

## The preview text

The specimen text defaults to `Shelf - 123`. It is one string shared by every
specimen on the page; typing in the preview field re-sets all of them.

## Specimens are live and adjustable

Every face shows real type, not a name in a fallback font. Where a family has
more than one cut, the cut is switchable in place and changes smoothly. Where it
has one cut, say so plainly instead of showing a control that does nothing.

## Flat cards, controls on the card

Cards are flat: a 1px hairline, no rounded pills, no filled chips, no bubbles.
Controls sit on the card and act in place — tap a cut on the rail and the
specimen on that same card changes, smoothly. Interaction never moves behind a
sheet or a separate screen when it can happen where the thumb already is.

## A reference image is already the mockup

When the owner sends a picture of the thing they want, they have already drawn
it. Send it back or work from it directly — do not spend a turn rebuilding the
same card in HTML so they can look at a copy of their own screenshot. Build only
what the picture cannot show (behaviour, states, the awkward data).

## Mock first, build second

A UI change that is not obviously right gets a throwaway mockup in `mockups/`
first, published so the owner can tap it, and the site is left alone until they
pick a direction.

## The product itself

- `d.html` is the whole site. Keep it working at phone width and keep it fast.
- `node audit.mjs` must pass, and `node audit.mjs --live` before claiming
  anything is live.
- Commits say why in plain sentences, and go to `main`.
