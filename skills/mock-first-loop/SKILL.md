---
name: mock-first-loop
description: The mockup loop for any UI change that is not obviously right — throwaway page in mockups/, published for the owner to tap, site untouched until they pick. Use before changing d.html for anything visual or interactive.
---

# Mock first, build second

A UI change that is not obviously right gets a throwaway mockup first, and the
site is left alone until the owner picks a direction. Rebuilding the real page
on a guess is how d.html grows things nobody asked for.

## 1. Check the owner has not already drawn it

If the owner sent a picture of the thing they want, they have already designed
it. Send it back or work from it directly — do not spend a turn rebuilding
their screenshot in HTML. Build only what the picture cannot show: behaviour,
states, the awkward data.

## 2. Build the mockup in mockups/

One file, `mockups/<name>.html`, named for what it tests
(`two-lane.html`, `live-adjuster.html`). Older attempts (a, b, b2, c) stay
where they are; mockups are throwaway, not history to curate.

Design and verify at 390–430px first:

- Nothing may scroll sideways at that width — check it, do not assume it.
- Controls sit within thumb reach; the bottom of the screen is where a thumb
  is, not the top right.
- Flat cards: 1px hairline, no rounded pills, no filled chips, no bubbles.
- Interaction happens on the card, in place, smoothly — never behind a sheet
  or a separate screen when the thumb is already there.

If the change can be tapped, the mockup must be tappable, not a still picture.

## 3. Publish it and hand over the link

Push to `main`, wait for Pages, then follow the publish-and-verify skill.
Give the owner the full address:

https://gbs-2805.github.io/shelf/mockups/<name>.html

One mockup per direction is fine; several directions at once is often better
than asking the owner to imagine alternatives.

## 4. Wait for the pick

The site is untouched until the owner chooses. If they pick a mockup, port it
into `d.html` properly: same behaviour, same in-place interaction, then
`node audit.mjs` must pass and publish-and-verify runs before it is called
live. If they pick nothing, the mockup did its job — delete it or leave it,
per their word.
