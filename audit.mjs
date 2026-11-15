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

// ---- report ------------------------------------------------------------------
const w = (s, n) => String(s).padEnd(n);
console.log(`grid ${cols} x ${gridRows} = ${cols * gridRows} cells, padding ${padding}, rail ${railWidth}%`);
console.log(w('set', 18) + w('names', 7) + w('styles', 8) + w('urls', 6) + 'broken');
for (const r of rows) console.log(w(r.label, 18) + w(r.names, 7) + w(r.styles, 8) + w(r.urls, 6) + r.broken);
console.log(`photos/sites/plugins checked: ${imUrls}`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error('  ✗ ' + p);
  process.exit(1);
}
console.log('\nall checks passed');
process.exit(0);
