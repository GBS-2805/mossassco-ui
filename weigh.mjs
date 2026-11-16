#!/usr/bin/env node
// What the page costs on the wire.
//
//   node weigh.mjs
//
// The product is one file, but the file is not the page: most of what a phone
// downloads is fetched from two font CDNs, and none of it shows up in wc -c.
// This walks the stylesheets d.html links to and counts the faces they
// declare, so a font change that quietly doubles the download is visible
// without opening a browser.
//
// It is a report, not a gate. Every number depends on a third party answering,
// and the declared total is an upper bound: a browser only fetches the faces
// the rendered text actually uses. The audit gates what the repo controls.

import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const html = await readFile(new URL('./d.html', import.meta.url), 'utf8');
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

async function get(url, method = 'GET') {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { method, headers: { 'user-agent': UA, 'accept-encoding': 'gzip' } });
      if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
      if (!res.ok) return { status: res.status, bytes: 0, text: '' };
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, bytes: buf.length, text: method === 'GET' ? buf.toString('utf8') : '' };
    } catch (e) {
      if (i === 2) return { status: String(e.message || e), bytes: 0, text: '' };
      await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
}

// A font CDN answers HEAD without a length, so ask for one byte and read the
// total out of content-range instead.
async function size(url) {
  const head = await fetch(url, { method: 'HEAD', headers: { 'user-agent': UA } }).catch(() => null);
  const len = head && head.ok ? Number(head.headers.get('content-length')) : 0;
  if (len) return len;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, range: 'bytes=0-0' }, signal: AbortSignal.timeout(15000) });
      const range = res.headers.get('content-range') || '';
      const total = Number((range.match(/\/(\d+)/) || [])[1]);
      if (total) return total;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length;
    } catch (e) {
      if (i === 2) return 0;
      await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }
  return 0;
}

// The specimen families are the expensive part: one woff2 per family, a few
// tens of KB each, all fetched because every specimen is on screen at once.
const sheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)]
  .map((m) => (m[0].match(/href="([^"]+)"/) || [])[1])
  .filter((u) => u && /fonts\.googleapis\.com|api\.fontshare\.com/.test(u));

const hosts = {};
let faces = 0;
let latin = 0;
const families = new Set();

for (const url of [...new Set(sheets)]) {
  const css = await get(url);
  if (!css.text) {
    console.log(`  ! ${new URL(url).host} stylesheet did not answer (${css.status})`);
    continue;
  }
  const blocks = css.text.split('@font-face').slice(1);
  for (const b of blocks) {
    faces++;
    let src = (b.match(/url\(\s*['"]?((?:https?:)?\/\/[^)'"]+?\.woff2[^)'"]*)['"]?\s*\)/) || [])[1];
    if (src && src.startsWith('//')) src = 'https:' + src;   // Fontshare serves protocol-relative
    const range = (b.match(/unicode-range:([^;]+)/) || [])[1] || '';
    const isLatin = !range || /U\+0*0-0*FF/i.test(range);
    const fam = (b.match(/font-family:\s*['"]?([^;'"]+)/) || [])[1];
    if (fam) families.add(fam.trim());
    // Count latin only: the other subsets never load for this page's text, and
    // counting them would make the report read four times worse than reality.
    if (!src || !isLatin) continue;
    latin++;
    const bytes = await size(src);
    const host = new URL(src).host.replace(/^www\./, '');
    hosts[host] = hosts[host] || { n: 0, b: 0 };
    hosts[host].n++;
    hosts[host].b += bytes;
  }
}

const raw = Buffer.byteLength(html);
const gz = gzipSync(html, { level: 9 }).length;
const page = { 'github.io (the file)': { n: 1, b: gz } };
console.log(`\nthe file: ${kb(raw)} raw · ${kb(gz)} gzip (what Pages sends)`);
console.log(`fonts: ${faces} faces declared across ${families.size} families, ${latin} latin woff2 to fetch`);
for (const [h, v] of Object.entries({ ...page, ...hosts }).sort((a, b) => b[1].b - a[1].b)) {
  console.log(`  ${h.padEnd(24)} ${String(v.n).padStart(3)} req  ${kb(v.b).padStart(9)}`);
}
const total = Object.values({ ...page, ...hosts }).reduce((a, v) => a + v.b, 0);
console.log(`  ${'fonts subtotal'.padEnd(24)} ${String(latin).padStart(3)} req  ${kb(Object.values(hosts).reduce((a, v) => a + v.b, 0)).padStart(9)}`);
console.log(`  ${'measured floor'.padEnd(24)}      ${kb(total).padStart(9)} — file + every latin face; icons and photos are on top`);
