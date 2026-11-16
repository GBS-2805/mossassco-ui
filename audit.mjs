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
//
// Data is read out of d.html itself, so the audit follows the file.

import { readFile } from 'node:fs/promises';

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
  await Promise.all(urls.map(async (u) => {
    try {
      const res = await fetch(u.url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
      const body = res.ok ? await res.text() : '';
      if (!res.ok || !/<svg/i.test(body)) bad.push({ ...u, status: res.status || 0, reason: res.ok ? 'not an SVG' : 'http' });
    } catch (e) {
      bad.push({ ...u, status: 0, reason: e.code || e.message });
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
if (!/counts\[t\]/.test(html) || !/mark\(t,counts\[t\]\)/.test(html)) problems.push('category headers must print the licence mix: counts[t] + mark(t,counts[t])');
if (!/function paintMeta\(/.test(html)) problems.push('no paintMeta(): the header counts must follow a licence filter');
if (!/function applyFilter\(/.test(html) || !/FILTER\.tier/.test(html)) problems.push('the licence tiers must filter the wall, not just label it');
if (!/kinds\.push\(\{tier:t/.test(html)) problems.push('FF, CN and P must be filter tabs in the kinds row');
if (!/\.kinds \.sep\{/.test(html)) problems.push('the kinds row needs a .kinds .sep divider before the licence tabs');
if (!/class="lic">'\+mark\(t\)/.test(html)) problems.push('the record bar must show its tier badge: mark(t)');
if (!/class="cap top"><b>'\+r\.n\+'<\/b>'\+mark\(t\)/.test(html)) problems.push('every card in the wall must carry its tier badge in the caption');
if (!/id="legend"/.test(html) || !/TIER_ORDER\.map/.test(html)) problems.push('the legend under the rule must spell out every tier');
if (!/<div class="lic"/.test(html) && !/class="lic"/.test(html)) problems.push('the record bar must carry its tier mark');

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

// ---- report ------------------------------------------------------------------
const w = (s, n) => String(s).padEnd(n);
console.log(`grid ${cols} x ${gridRows} = ${cols * gridRows} cells, padding ${padding}, rail ${railWidth}%`);
console.log(w('set', 18) + w('names', 7) + w('styles', 8) + w('urls', 6) + 'broken');
for (const r of rows) console.log(w(r.label, 18) + w(r.names, 7) + w(r.styles, 8) + w(r.urls, 6) + r.broken);
console.log(`photos/sites/plugins checked: ${imUrls}`);
console.log(`layout: ${edgesChecked} safe-area edges checked, viewport-fit=cover, 380/760/1280 breakpoints, thumb targets`);
console.log(`licences: ${recordLines.length} records · FF ${tierCount.pd} · CN ${tierCount.open} · P ${tierCount.terms} · missing ${noLicence}`);
console.log(`motion: cached chip geometry, rAF-throttled scroll, in-place preview paint`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error('  ✗ ' + p);
  process.exit(1);
}
console.log('\nall checks passed');
process.exit(0);
