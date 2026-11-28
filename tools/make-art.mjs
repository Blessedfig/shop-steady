#!/usr/bin/env node
// Makes the website illustrations with OpenAI's image model (the "GPT" images) from assets/art/prompts.json,
// saves them as assets/art/<id>.webp, and points the site pages at them in place of the <id>.svg placeholders.
//
//   OPENAI_API_KEY=sk-... node tools/make-art.mjs            make every image that doesn't exist yet
//   OPENAI_API_KEY=sk-... node tools/make-art.mjs hero stube make just these
//   node tools/make-art.mjs --force hero                     redo one even if it exists
//   node tools/make-art.mjs --link-only                      no API: just point pages at any <id>.webp/.png/.jpg
//                                                            already in assets/art (e.g. made by hand in ChatGPT)
// Optional: IMAGE_MODEL (default gpt-image-1), IMAGE_QUALITY (low | medium | high, default high).
// The key is read from the environment only. Never put it in a file in this repo (the repo is public).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artDir = path.join(root, 'assets', 'art');
const spec = JSON.parse(fs.readFileSync(path.join(artDir, 'prompts.json'), 'utf8'));
const args = process.argv.slice(2);
const force = args.includes('--force');
const linkOnly = args.includes('--link-only');
const only = args.filter(a => !a.startsWith('--'));
const known = new Set(spec.images.map(i => i.id));
for (const id of only) if (!known.has(id)) { console.error(`Unknown image "${id}". Known: ${[...known].join(', ')}`); process.exit(2); }

const found = id => ['webp', 'png', 'jpg'].map(ext => `${id}.${ext}`).find(f => fs.existsSync(path.join(artDir, f)));

async function make(img) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set. See docs/website-ux.md, "Making the pictures".');
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.IMAGE_MODEL || 'gpt-image-1',
      prompt: `${spec.style}\n\n${img.prompt}`,
      size: img.size,
      quality: process.env.IMAGE_QUALITY || 'high',
      output_format: 'webp',
      output_compression: 82,
      n: 1,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${body?.error?.message || res.statusText}`);
  const b64 = body?.data?.[0]?.b64_json;
  if (!b64) throw new Error('No image came back.');
  fs.writeFileSync(path.join(artDir, `${img.id}.webp`), Buffer.from(b64, 'base64'));
}

// Point every top-level page at the finished file instead of the placeholder.
function link(id, file) {
  for (const page of fs.readdirSync(root).filter(f => f.endsWith('.html'))) {
    const p = path.join(root, page);
    const html = fs.readFileSync(p, 'utf8');
    const next = html.replaceAll(`assets/art/${id}.svg`, `assets/art/${file}`);
    if (next !== html) { fs.writeFileSync(p, next); console.log(`  ${page}: now uses ${file}`); }
  }
}

let failed = 0;
for (const img of spec.images) {
  if (only.length && !only.includes(img.id)) continue;
  let file = found(img.id);
  if (!linkOnly && (force || !file)) {
    process.stdout.write(`Making ${img.id} (${img.size})... `);
    try { await make(img); file = `${img.id}.webp`; console.log('done'); }
    catch (e) { failed++; console.log(`failed: ${e.message}`); continue; }
  }
  if (file) link(img.id, file); else if (linkOnly) console.log(`${img.id}: no finished file yet, keeping the placeholder`);
}
process.exit(failed ? 1 : 0);
