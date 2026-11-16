#!/usr/bin/env node
// Audit for d.html — the checks that catch a frame with a hole in it.
//
//   node audit.mjs
//
// Fails (exit 1) when:
//   - any icon URL for any set, in any of its styles, does not return an SVG
//   - any icon set has a different number of names than the grid has cells
//   - the icon grid is not uniform on all sides (or does not clear the rail)
//   - any photo, site or plugin asset referenced by the data is unreachable
//   - the page stops drawing behind a phone's camera cutout or rounded corners
//   - a padded edge loses its safe-area inset (including inside a media query)
//   - the phone, narrow-phone or three-column breakpoint goes missing or loses
//     its order, so a wider block overrides a narrower one
//   - a record has no licence, or a CC0 / open-licence record is filed under
//     the wrong tier mark
//   - a category header loses its licence marks, or the legend loses a tier
//   - the roulette goes back to measuring inside the scroll handler, or the
//     sheet goes back to re-rendering on every option change (both made it
//     jitter)
//   - a filter, close or copy button drops below thumb size
//   - the page's own script stops parsing
//   - a record loses its https link, its copy, or its name becomes a duplicate
//   - with --live, the published page is not byte-identical to this file
//
// Data is read out of d.html itself, so the audit follows the file.

import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const html = await readFile(new URL('./d.html', import.meta.url), 'utf8');
const problems = [];
const rows = [];

const unquote = (s) => s.trim().replace(/^['"]|['"]$/g, '');

// ---- what the CSS promises the grid looks like -------------------------------
const gridRule = html.match(/\.icons \.pv\{([^}]*)\}/);
if (!gridRule) {
  problems.push('could not find the .icons .pv rule');
}
const css = gridRule ? gridRule[1] : '';
const cols = Number((css.match(/grid-template-columns:repeat\((\d+),1fr\)/) || [])[1]);
const gridRows = Number((css.match(/grid-template-rows:repeat\((\d+),1fr\)/) || [])[1]);
const padding = (css.match(/padding:([^;}]+)/) || [])[1];
const railWidth = Number((html.match(/\.rail\{[^}]*width:(\d+)%/) || [])[1]);

if (!cols || !gridRows) problems.push('.icons .pv must declare both grid-template-columns and grid-template-rows with repeat(n,1fr)');
if (!padding) problems.push('.icons .pv must set padding');

// padding must be one value (all four sides) or start with the rail offset + one value
const padParts = (padding || '').match(/calc\([^)]*\)|\d+(?:\.\d+)?%/g) || [];
const isUniform = padParts.length === 1;
const clearsRail = padParts.length === 2 && /calc\(\s*\d+(?:\.\d+)?%\s*\+\s*\d+(?:\.\d+)?%\s*\)/.test(padParts[0]) && padParts[1] === ((padParts[0].match(/\+\s*(\d+(?:\.\d+)?%)/) || [])[1]);
if (!isUniform && !clearsRail) problems.push(`.icons .pv padding is not even on all sides: ${padding}`);

const hasRailRule = html.match(/\.icons\.hasrail \.pv\{([^}]*)\}/);
if (hasRailRule) {
  const pad = (hasRailRule[1].match(/padding:([^;}]+)/) || [])[1] || '';
  const parts = pad.match(/calc\([^)]*\)|\d+(?:\.\d+)?%/g) || [];
  const calcRaw = parts.find((p) => p.startsWith('calc('));
  const calc = calcRaw && calcRaw.match(/calc\(\s*(\d+(?:\.\d+)?)%\s*\+\s*(\d+(?:\.\d+)?%)\s*\)/);
  // the three literal sides must all equal the pad added to the rail width on the right
  const literals = parts.filter((p) => !p.startsWith('calc('));
  const even = calc && literals.length === 3 && literals.every((l) => l === calc[2]);
  if (!calc || Number(calc[1]) !== railWidth || !even) {
    problems.push(`.icons.hasrail .pv must be padding:<pad> calc(${railWidth}% + <pad>) <pad> <pad>, found: ${pad}`);
  }
}

// ---- icon sets ---------------------------------------------------------------
const iconChunks = html.split(/\nIC\(/).slice(1);
if (iconChunks.length === 0) problems.push('no IC() records found');

for (const chunk of iconChunks) {
  const label = unquote(chunk.slice(0, chunk.indexOf(',')));
  const namesMatch = chunk.match(/names:\[([^\]]*)\]/);
  if (!namesMatch) {
    problems.push(`${label}: no names array`);
    continue;
  }
  const names = namesMatch[1].split(',').map(unquote).filter(Boolean);

  const styles = [...chunk.matchAll(/\{l:'([^']+)',b:'([^']+)',s:'([^']*)'\}/g)].map((m) => ({ label: m[1], base: m[2], suffix: m[3] }));
  const base = (chunk.match(/(?:^|[,{])base:'([^']+)'/) || [])[1];
  const suffix = (chunk.match(/(?:^|[,{])suf:'([^']*)'/) || [])[1];
  if (styles.length === 0 && !base) {
    problems.push(`${label}: no base URL and no styles`);
    continue;
  }
  const variants = styles.length ? styles : [{ label: 'default', base, suffix }];

  const cells = cols * gridRows;
  if (names.length !== cells) {
    problems.push(`${label}: ${names.length} names but the grid has ${cells} cells (${cols}x${gridRows})`);
  }

  const urls = [];
  for (const v of variants) for (const n of names) urls.push({ style: v.label, name: n, url: v.base + n + (v.suffix || '') });

  const bad = [];
  // A runner on a different network sees different weather, so a connection
  // blip or a 5xx gets one retry. A 403 or 404 will not change on the second
  // ask, and must never be swallowed: it means the CDN is refusing this host,
  // which is a real risk to the page.
  const probe = async (url) => {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const body = res.ok ? await res.text() : '';
    return { ok: res.ok && /<svg/i.test(body), status: res.status, reason: res.ok ? 'not an SVG' : 'http' };
  };
  await Promise.all(urls.map(async (u) => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const r = await probe(u.url);
        if (r.ok) return;
        const settled = r.status && r.status !== 429 && r.status < 500;
        if (attempt === 2 || settled) {
          bad.push({ ...u, status: r.status, reason: r.reason });
          return;
        }
      } catch (e) {
        if (attempt === 2) {
          bad.push({ ...u, status: 0, reason: e.code || e.message });
          return;
        }
      }
      await new Promise((r) => setTimeout(r, 350 * attempt));
    }
  }));

  for (const b of bad) problems.push(`${label} · ${b.style} · ${b.name}: ${b.status} ${b.reason} — ${b.url}`);
  rows.push({ label, names: names.length, styles: variants.length, urls: urls.length, broken: bad.length, cells });
}

// ---- photos, sites, plugins --------------------------------------------------
const imChunks = html.split(/\nIM\(/).slice(1);
let imUrls = 0;
for (const chunk of imChunks) {
  const label = unquote(chunk.slice(0, chunk.indexOf(',')));
  const rest = chunk.slice(chunk.indexOf(',') + 1);
  const url = unquote(rest.slice(rest.indexOf("'") + 1, rest.indexOf("'", rest.indexOf("'") + 2)));
  if (!url || !/^https?:/.test(url)) continue;
  imUrls++;
  try {
    const res = await fetch(url, { method: 'GET', headers: { range: 'bytes=0-2047' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok && res.status !== 206) problems.push(`${label}: ${res.status} — ${url}`);
  } catch (e) {
    problems.push(`${label}: ${e.code || e.message} — ${url}`);
  }
}

// ---- layout rules ------------------------------------------------------------
// Each of these has a reason on a real phone (Galaxy Flip-class punch hole,
// rounded corners) or on a wide monitor. Break one knowingly, not by accident.
const SIDES = ['top', 'right', 'bottom', 'left'];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const viewportMeta = (html.match(/<meta name="viewport" content="([^"]*)"/) || [])[1] || '';
if (!/viewport-fit=cover/.test(viewportMeta)) {
  problems.push(`viewport meta must include viewport-fit=cover, found "${viewportMeta || 'none'}"`);
}

function expandPadding(value) {
  const parts = value.match(/calc\((?:[^()]|\([^()]*\))*\)|var\((?:[^()]|\([^()]*\))*\)|[^\s]+/g) || [];
  if (parts.length === 1) return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
  if (parts.length === 2) return { top: parts[0], bottom: parts[0], right: parts[1], left: parts[1] };
  if (parts.length === 3) return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
  return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
}

// selector, property, and the edges that actually touch the display
const surfaces = [
  ['header', 'padding', ['top', 'right', 'left']],
  ['.kinds', 'padding', ['right', 'left']],
  ['.rule', 'margin', ['right', 'left']],
  ['.gh', 'padding', ['right', 'left']],
  ['.legend', 'padding', ['right', 'left']],
  ['.wall', 'padding', ['right', 'left']],
  ['footer', 'padding', ['right', 'left', 'bottom']],
  ['.sheet .bar', 'padding', ['top', 'right', 'left']],
  ['.sheet .info', 'padding', ['right', 'left', 'bottom']],
  ['.sheet .preview', 'padding', ['right', 'left']],
];

let edgesChecked = 0;
for (const [selector, prop, edges] of surfaces) {
  const blocks = [...html.matchAll(new RegExp(escapeRe(selector) + '\\{([^}]*)\\}', 'g'))];
  if (!blocks.length) {
    problems.push(`no ${selector} rule found, so its safe-area padding cannot be checked`);
    continue;
  }
  for (const block of blocks) {
    const body = block[1];
    const shorthand = (body.match(new RegExp(`(?:^|;)${prop}:([^;}]*)`)) || [])[1];
    const expanded = shorthand ? expandPadding(shorthand) : null;
    for (const edge of edges) {
      const longhand = (body.match(new RegExp(`${prop}-${edge}:([^;}]*)`)) || [])[1];
      const value = longhand !== undefined ? longhand : expanded && expanded[edge];
      if (!value || /^0(px)?$/.test(value.trim())) continue;
      edgesChecked++;
      if (!value.includes(`--sa-${edge[0]}`)) {
        problems.push(`${selector} ${prop} on the ${edge} edge must add var(--sa-${edge[0]}), found "${value.trim()}"`);
      }
    }
  }
}

const wideIdx = html.indexOf('@media(min-width:1280px){.wall{columns:3}}');
const phoneIdx = html.indexOf('@media(max-width:760px)');
const narrowIdx = html.indexOf('@media(max-width:380px)');
if (wideIdx < 0) problems.push('the wall must take three columns from 1280px: @media(min-width:1280px){.wall{columns:3}}');
if (phoneIdx < 0) problems.push('missing @media(max-width:760px): phones get one column and a scrolling filter row');
if (narrowIdx < 0) problems.push('missing @media(max-width:380px): narrow phones keep the tight gutters');
if (phoneIdx > -1 && narrowIdx > -1 && narrowIdx < phoneIdx) {
  problems.push('the max-width:380px block sits before max-width:760px, so the wider block overrides it — put the narrower one last');
}

const touchTargets = [['.sheet .bar button', 44], ['.copy', 44], ['.kinds button', 40]];
for (const [selector, min] of touchTargets) {
  const blocks = [...html.matchAll(new RegExp(escapeRe(selector) + '\\{([^}]*)\\}', 'g'))];
  if (!blocks.length) {
    problems.push(`no ${selector} rule found, so its touch target cannot be checked`);
    continue;
  }
  const heights = blocks.map((b) => Number((b[1].match(/min-height:(\d+)px/) || [])[1]) || 0);
  const best = Math.max(...heights);
  if (best < min) problems.push(`${selector} needs min-height:${min}px under a thumb, found ${best ? best + 'px' : 'none'}`);
}

// ---- licence tiers -----------------------------------------------------------
// Three marks, three claims. A record's tier comes from its licence string, so
// the icon can never drift from the text next to it in the sheet.
const tierOf = (lic) =>
  /CC BY-NC|CC-BY-NC|CC BY-ND|CC-BY-ND/.test(lic) ? 'terms'
  : /CC BY|CC-BY/.test(lic) ? 'open'
  : /^(CC0|public domain)/i.test(lic) || /\b(OFL|MIT|ISC|Apache)\b/.test(lic) ? 'pd'
  : 'terms';

// The mapping is the whole point: a free font or icon set must never come out
// as anything but full freedom.
for (const [lic, want] of [
  ['OFL 1.1', 'pd'], ['OFL 1.1 / Apache 2.0', 'pd'], ['MIT', 'pd'], ['ISC · MIT (Feather icons)', 'pd'],
  ['CC0 1.0', 'pd'], ['CC0 · brand marks', 'pd'], ['CC0 1.0 / CC BY 3.0', 'open'], ['CC BY-SA 4.0', 'open'],
  ['CC BY-NC 4.0', 'terms'], ['per model · CC0 to CC BY-NC-ND', 'terms'], ['ITF Free · no conversion', 'terms'],
  ['Unsplash License · no resale', 'terms'], ['IconScout Simple License', 'terms'],
]) {
  const got = tierOf(lic);
  if (got !== want) problems.push(`tierOf("${lic}") returns ${got}, expected ${want} — a free licence must read as full freedom`);
}

if (!/var TIER_ORDER=\['pd','open','terms'\];/.test(html)) problems.push('TIER_ORDER must list pd, open, terms in that order');
for (const t of ['pd', 'open', 'terms']) {
  if (!new RegExp(`\\.m\\.${t} svg`).test(html)) problems.push(`no .m.${t} svg style, so the ${t} mark has no shape`);
}

const recordLines = [];
for (const [fn, kind] of [['T', 'type'], ['IC', 'icons'], ['IM', 'image/3d']]) {
  for (const chunk of html.split(new RegExp(`\\n${fn}\\(`)).slice(1)) {
    const end = chunk.indexOf('});');
    if (end < 0) continue;
    recordLines.push({ fn, kind, line: chunk.slice(0, end + 3) });
  }
}
for (const chunk of html.split("I.push({").slice(1)) {
  const end = chunk.indexOf('});');
  const body = end < 0 ? chunk : chunk.slice(0, end + 3);
  if (body.includes("k:'tools'")) recordLines.push({ fn: 'I.push', kind: 'tools', line: body });
}

const tierCount = { pd: 0, open: 0, terms: 0 };
let noLicence = 0;
for (const r of recordLines) {
  const name = (r.line.match(/^'([^']+)'|n:'([^']+)'/) || []).slice(1).filter(Boolean)[0] || r.kind;
  const lic = (r.line.match(/lic:'([^']*)'/) || [])[1];
  if (!lic) {
    noLicence++;
    problems.push(`${name}: no licence string, so no tier mark can be honest`);
    continue;
  }
  const tier = tierOf(lic);
  if (r.line.includes("tier:'") && !r.line.includes(`tier:'${tier}'`)) problems.push(`${name}: declares a tier that disagrees with its licence "${lic}"`);
  tierCount[tier]++;
}

for (const a of ['FF', 'CN', 'P']) {
  if (!new RegExp(`a:'${a}',`).test(html)) problems.push(`no abbreviation for the ${a} tier — every mark must read FF, CN or P`);
}
if (!/counts\[t\]/.test(html) || !/mark\(t,counts\[t\]/.test(html)) problems.push('category headers must print the licence mix: counts[t] + mark(t,counts[t])');
if (!/TIER_ORDER\.map\(function\(t\)\{return mark\(t,counts\[t\]\|\|0\)\}/.test(html)) {
  problems.push('a header must show all three tiers with their counts, including zero — otherwise a category silently loses its CN');
}
if (!/\.kinds \.lic-tab\{/.test(html)) problems.push('.kinds .lic-tab must give the licence tabs their own weight so they are easy to spot');
if (!/TIER_TOTAL\[o\.tier\]/.test(html)) problems.push('each licence tab must carry the number of items it holds, before it is tapped');
if (!/var TIER_TOTAL=\{\};I\.forEach/.test(html)) {
  problems.push('TIER_TOTAL must be tallied from the data, not typed in');
} else {
  const tally = { pd: 0, open: 0, terms: 0 };
  for (const r of recordLines) {
    const lic = (r.line.match(/lic:'([^']*)'/) || [])[1];
    if (lic) tally[tierOf(lic)]++;
  }
  for (const [key, want] of [['pd', tally.pd], ['open', tally.open], ['terms', tally.terms]]) {
    if (tally[key] !== tierCount[key]) problems.push(`tier tally drifted: ${key} ${tally[key]} vs ${tierCount[key]}`);
  }
}
if (!/function paintMeta\(/.test(html)) problems.push('no paintMeta(): the header counts must follow a licence filter');
if (!/function applyFilter\(/.test(html) || !/FILTER\.tier/.test(html)) problems.push('the licence tiers must filter the wall, not just label it');
if (!/kinds\.push\(\{tier:t/.test(html)) problems.push('FF, CN and P must be filter tabs in the kinds row');
if (!/\.kinds \.sep\{/.test(html)) problems.push('the kinds row needs a .kinds .sep divider before the licence tabs');
if (!/class="lic">'\+mark\(t\)/.test(html)) problems.push('the record bar must show its tier badge: mark(t)');
if (!/<b>'\+r\.n\+'<\/b><i>'\+kTag\(r\.k\)\+'<\/i>'\+mark\(t\)/.test(html)) {
  problems.push('a card must read name · KIND · badge: the tier badge goes after the category tag');
}
for (const g of ['free', 'credit', 'prohibited']) {
  if (!new RegExp(`g:'${g}'`).test(html)) problems.push(`the legend gloss must stay one word, missing g:'${g}'`);
}
const kindsRule = (html.match(/\n\.kinds\{([^}]*)\}/) || [])[1] || '';
if (!/align-items:center/.test(kindsRule)) problems.push('.kinds must align its items on the centre line, or the licence divider hangs off the top of the row');
if (!/\.kinds \.sep\{[^}]*align-self:center/.test(html)) problems.push('.kinds .sep must sit on the centre line with the tabs');
if (!/id="legend"/.test(html) || !/TIER_ORDER\.map/.test(html)) problems.push('the legend under the rule must spell out every tier');

// ---- the free-font index -----------------------------------------------------
// 102 faces whose licence was read at the foundry. They are a list, not a
// specimen wall: no font file is embedded, so the index must say so, and every
// row must carry a licence this shelf calls FF.
const freeBlock = (html.match(/var FREE=\[([\s\S]*?)\n\];/) || [])[1] || '';
if (!freeBlock) problems.push('no FREE[] — the free-font index has no data to draw');
if (html.indexOf('var FREE=[') < html.indexOf("var groupsEl=document.getElementById('groups');")) {
  problems.push('the index builds itself before groupsEl exists — it throws on load, and a syntax check will not see it');
}
const freeRows = [...freeBlock.matchAll(/\{c:'([^']+)',n:'([^']+)',h:'([^']+)',u:'(https:\/\/[^']+)',(?:f:'([^']+)',)?l:'([^']+)'\}/g)]
  .map((m) => ({ c: m[1], n: m[2], h: m[3], u: m[4], f: m[5] || '', l: m[6] }));
if (freeRows.length < 100) problems.push(`FREE[] lists ${freeRows.length} faces, expected at least 100`);
for (const r of freeRows) {
  if (!['display', 'sans-serif', 'serif', 'monospace'].includes(r.c)) problems.push(`${r.n}: unknown category "${r.c}"`);
  if (!/OFL|CC0|MIT|GPL|WTFPL|MPL|public domain|Apache|ISC/i.test(r.l)) {
    problems.push(`${r.n}: "${r.l}" is not a licence this shelf calls FF — the index may only hold full-freedom faces`);
  }
  if (!r.h || !/^https:\/\//.test(r.u)) problems.push(`${r.n}: no https link to the foundry`);
}
const freeNames = freeRows.map((r) => r.n);
const dupes = freeNames.filter((n, i) => freeNames.indexOf(n) !== i);
if (dupes.length) problems.push(`FREE[] repeats ${dupes.join(', ')}`);
const wallNames = [...html.matchAll(/\nT\('([^']+)'/g)].map((m) => m[1]);
for (const n of freeNames) {
  if (wallNames.includes(n)) problems.push(`${n}: in the wall and in the index — one face, one place`);
}
if (freeRows.length !== new Set(freeNames).size) problems.push('FREE[] has duplicate names, so a count in the header would lie');
if (!/TIER_TOTAL\.pd=\(TIER_TOTAL\.pd\|\|0\)\+FREE\.length/.test(html)) {
  problems.push('the FF tab count must add FREE.length, or the tab undercounts by the whole index');
}
if (!/\.faces \.fc\{/.test(html) || !/\.faces \.fc \.word\{/.test(html) || !/\.faces \.fnote\{/.test(html)) {
  problems.push('the free index lost its card, specimen or note style');
}
if (!/downloaded to fonts\//.test(html)) {
  problems.push('the index must say the specimens are served from this repo, or a reader cannot tell whose files they are');
}

// The specimens are the point: a card that names a face but shows a default
// sans is the thing this section was built to stop doing.
const faceFiles = await readdir(new URL('./fonts/', import.meta.url)).catch(() => []);
const tagged = freeRows.filter((r) => r.f);
const faceRules = [...html.matchAll(/@font-face\{font-family:"([^"]+)";src:url\('fonts\/([^']+)'\)/g)]
  .map((m) => ({ name: m[1], file: m[2] }));
const ruleByFile = new Map(faceRules.map((r) => [r.file, r.name]));
for (const r of tagged) {
  if (!faceFiles.includes(r.f + '.woff2')) problems.push(`${r.n}: tagged with ${r.f}.woff2 but fonts/ has no such file`);
  const named = ruleByFile.get(r.f + '.woff2');
  if (!named) problems.push(`${r.n}: no @font-face rule points at fonts/${r.f}.woff2 — the card would render in the fallback`);
  else if (named !== r.n) problems.push(`${r.n}: its file is declared as "${named}", so the card sets the wrong family`);
}
for (const rule of faceRules) {
  if (!tagged.some((r) => r.f + '.woff2' === rule.file)) problems.push(`fonts/${rule.file} is declared but no face uses it — dead weight in the download`);
}
if (!tagged.length) problems.push('no face in the index carries a specimen file');
if (!/var PTX='12345 - Shelf'/.test(html)) problems.push("the preview text must default to '12345 - Shelf'");
if (!/\.faces \.fc:not\(\[data-nofile\]\) \.word/.test(html)) problems.push('typing in the preview box must reach the index cards too');
if (!/kinds\.push\(\{k:'faces'/.test(html)) problems.push('the kinds row needs a free fonts tab, or the index cannot be filtered to');
if (!/sec\.dataset\.kind==='faces'/.test(html)) problems.push('applyFilter must treat the index as one block: it has rows, not .item cards');
for (const gone of ['Cambrian', 'Phosphène', 'Berlin Grotesk', 'Slibinas', 'Boris', 'Granturismo']) {
  if (freeNames.includes(gone)) problems.push(`${gone}: rests only on the catalogue licence field, so it may not be shelved yet`);
}

// ---- what the page fetches -----------------------------------------------------
// The icon grid is eighty decorative SVGs — more requests than everything else
// combined. They are lazy and low-priority so they queue behind the fonts the
// specimens need; if that markup changes, the grid silently starts racing the
// type for bandwidth, which no local check would otherwise notice.
if (!/names\.forEach[^\n]*fetchpriority="low"/.test(html)) {
  problems.push('icon grid images lost loading="lazy" / fetchpriority="low" — eighty SVGs would compete with the specimen fonts');
}

// Fonts are the whole point of the page and also most of its weight, so the
// stylesheets have to stay a small, known list a person can read and trim.
const fontSheets = (html.match(/<link[^>]*(?:fonts\.googleapis\.com|api\.fontshare\.com)[^>]*>/g) || [])
  .filter((tag) => /rel="stylesheet"/.test(tag)).length;
if (fontSheets !== 2) problems.push(`expected 2 font stylesheets (Google, Fontshare), found ${fontSheets}`);

// ---- motion -----------------------------------------------------------------
// Layered fixes for the jitter: cached chip geometry, one rAF per scroll frame,
// and in-place preview painting instead of rebuilding the sheet.
const optRule = (html.match(/\.strip \.opt\{([^}]*)\}/) || [])[1] || '';
if (!optRule) problems.push('no .strip .opt rule');
if (/transition:[^;}]*transform/.test(optRule)) problems.push('.strip .opt must not transition transform — every scroll frame restarts the tween, which is the jitter');
if (!/will-change:transform/.test(optRule)) problems.push('.strip .opt must declare will-change:transform so the chips stay on their own layer');
if (!/backface-visibility:hidden/.test(optRule)) problems.push('.strip .opt must declare backface-visibility:hidden for the rotateY tilt');

function fnBody(name) {
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) return '';
  const next = html.indexOf('\nfunction ', start + 10);
  return html.slice(start, next < 0 ? start + 1600 : next);
}
const rouletteBody = fnBody('roulette');
if (!rouletteBody) problems.push('no roulette() found');
if (/offsetLeft|offsetWidth/.test(rouletteBody)) {
  problems.push('roulette() must not read offsetLeft/offsetWidth — cache them in prepStrip() instead');
}
if (!/requestAnimationFrame/.test(html)) problems.push('the strip scroll handler must be rAF-throttled');
if (!/\\.__chips|__chips/.test(rouletteBody)) problems.push('roulette() must use the cached chip centres');

const variantBody = fnBody('applyVariant');
if (!variantBody) problems.push('no applyVariant() found');
if (/openTab\(/.test(variantBody)) problems.push('applyVariant() must not call openTab() — rebuilding the sheet on every option change is the flicker');
if (!/paintCard\(/.test(variantBody) || !/paintSheet\(/.test(variantBody)) problems.push('applyVariant() must paint the card and the open sheet in place');

if (!/function paintSheet\(/.test(html)) problems.push('no paintSheet(): the open preview needs an in-place update');
if (!/function fitOneType\(/.test(html)) problems.push('no fitOneType(): a weight change must not re-fit every specimen');

// ---- what every record must carry ---------------------------------------------
// A record that opens a sheet with an empty paragraph, or a link to nowhere, is
// a hole in the page. Names are the page's only identifiers, so they must be
// unique.
function pick(line, field) {
  const at = line.indexOf(field + ":'");
  if (at < 0) return '';
  let out = '';
  for (let i = at + field.length + 2; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\') { out += line[i + 1]; i++; continue; }
    if (ch === "'") break;
    out += ch;
  }
  return out;
}

const seenNames = new Set();
let copyChecked = 0;
for (const r of recordLines) {
  const name = pick(r.line, 'n') || (r.line.match(/^'([^']+)'/) || [])[1] || r.kind;
  if (seenNames.has(name)) problems.push(`two records share the name "${name}"`);
  seenNames.add(name);
  const href = pick(r.line, 'href');
  if (!/^https:\/\//.test(href)) problems.push(`${name}: the link must be https, found "${href || 'none'}"`);
  for (const field of ['lead', 'about', 'watch']) {
    const text = pick(r.line, field);
    if (text.trim().length < 12) problems.push(`${name}: ${field} is missing or says nothing`);
  }
  if (!/use:\[[^\]]{8,}\]/.test(r.line)) problems.push(`${name}: needs at least one "use it for" line`);
  copyChecked++;
}
if (!/target="_blank" rel="noopener"/.test(html)) problems.push('outbound links must carry target="_blank" rel="noopener"');
if (!/<link rel="icon"/.test(html)) problems.push('no favicon declared, so every load makes a 404 for /favicon.ico');

// ---- the page's own script ----------------------------------------------------
const scriptBody = (html.match(/<script>([\s\S]*)<\/script>/) || [])[1];
let scriptOk = false;
if (!scriptBody) {
  problems.push('d.html has no inline <script> to run');
} else {
  const dir = mkdtempSync(join(tmpdir(), 'shelf-gate-'));
  const file = join(dir, 'page.js');
  writeFileSync(file, scriptBody);
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    scriptOk = true;
  } catch (e) {
    const detail = String(e.stderr || e.stdout || e.message).split('\n').filter(Boolean).slice(0, 3).join(' | ');
    problems.push(`the inline script does not parse: ${detail}`);
  }
}

// ---- live parity (opt in) -----------------------------------------------------
// `node audit.mjs --live` answers the only question a deployment can ask: is the
// published file this file?
let liveChecked = false;
if (process.argv.includes('--live')) {
  try {
    const res = await fetch('https://gbs-2805.github.io/mossassco-ui/d.html?v=' + Date.now(), { signal: AbortSignal.timeout(20000) });
    const live = await res.text();
    liveChecked = true;
    if (!res.ok) problems.push(`live page answered ${res.status}`);
    else if (live !== html) problems.push('the live page is not this file — push it, or wait for Pages to finish (usually three or four polls)');
  } catch (e) {
    problems.push(`could not read the live page: ${e.code || e.message}`);
  }
}

// ---- page weight -------------------------------------------------------------
// The product is one file, and every visitor downloads all of it: on Pages there
// is no partial load, no lazy chunk, no build step to split it. So size is a
// design decision with a number attached, and the number gets checked here.
// Chrome is everything that is not data; data is counted per section so the one
// that quietly doubles shows up by name instead of as a vague total.
const RAW_BUDGET = 150 * 1024;
const GZIP_BUDGET = 45 * 1024;
const rawBytes = Buffer.byteLength(html);
const gzipBytes = gzipSync(html, { level: 9 }).length;
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

const byKind = {};
for (const r of recordLines) byKind[r.kind] = (byKind[r.kind] || 0) + Buffer.byteLength(r.line);
const indexBlock = (html.match(/var FREE=\[[\s\S]*?\n\];/) || [''])[0];
const indexBytes = Buffer.byteLength(indexBlock);
const indexRows = (indexBlock.match(/\{c:'/g) || []).length;
const dataBytes = Object.values(byKind).reduce((a, b) => a + b, 0) + indexBytes;
const chromeBytes = rawBytes - dataBytes;
const parts = [
  ['chrome', chromeBytes],
  ...Object.entries(byKind),
  [`index (${indexRows})`, indexBytes],
].sort((a, b) => b[1] - a[1]);
const weightLine = `${kb(rawBytes)} raw · ${kb(gzipBytes)} gzip — ` + parts.map(([n, b]) => `${n} ${kb(b)}`).join(' · ');

const biggest = parts[0];
for (const [label, budget, bytes] of [['raw', RAW_BUDGET, rawBytes], ['gzip', GZIP_BUDGET, gzipBytes]]) {
  if (bytes > budget) {
    problems.push(
      `d.html is ${kb(bytes)} ${label}, over its ${kb(budget)} budget by ${kb(bytes - budget)}: ` +
      `the whole file is one download for every visitor, and the largest part is ${biggest[0]} at ${kb(biggest[1])}`
    );
  }
}

// ---- report ------------------------------------------------------------------
const w = (s, n) => String(s).padEnd(n);
console.log(`grid ${cols} x ${gridRows} = ${cols * gridRows} cells, padding ${padding}, rail ${railWidth}%`);
console.log(w('set', 18) + w('names', 7) + w('styles', 8) + w('urls', 6) + 'broken');
for (const r of rows) console.log(w(r.label, 18) + w(r.names, 7) + w(r.styles, 8) + w(r.urls, 6) + r.broken);
console.log(`photos/sites/plugins checked: ${imUrls}`);
console.log(`layout: ${edgesChecked} safe-area edges checked, viewport-fit=cover, 380/760/1280 breakpoints, thumb targets`);
console.log(`licences: ${recordLines.length} records · FF ${tierCount.pd} · CN ${tierCount.open} · P ${tierCount.terms} · missing ${noLicence}`);
console.log(`motion: cached chip geometry, rAF-throttled scroll, in-place preview paint`);
console.log(`records: ${copyChecked} with https links, copy and uses · names unique · links rel=noopener`);
console.log(`weight: ${weightLine}`);
console.log(`script: ${scriptOk ? 'parses' : 'FAILS TO PARSE'}${liveChecked ? ' · live: byte-identical to d.html' : ' · live: not checked (pass --live)'}`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error('  ✗ ' + p);
  process.exit(1);
}
console.log('\nall checks passed');
process.exit(0);
