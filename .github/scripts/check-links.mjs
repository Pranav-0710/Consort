#!/usr/bin/env node
// Checks that every relative Markdown link in docs/ and the root Markdown files points to
// an existing file or directory. External links (http, https, mailto) and same-page
// anchors are skipped. Fenced code blocks are ignored.
//   node .github/scripts/check-links.mjs   # exits 1 and lists broken links
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function markdownFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const files = [
  ...readdirSync(ROOT)
    .filter((name) => name.endsWith('.md') && statSync(path.join(ROOT, name)).isFile())
    .map((name) => path.join(ROOT, name)),
  ...markdownFiles(path.join(ROOT, 'docs')),
];

const broken = [];
let checked = 0;
for (const file of files) {
  let inFence = false;
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      if (inFence) return;
      for (const match of line.matchAll(LINK)) {
        const target = match[1];
        if (/^(https?:|mailto:|#)/i.test(target)) continue;
        const filePart = decodeURIComponent(target.split('#')[0]);
        if (!filePart) continue;
        checked += 1;
        if (!existsSync(path.resolve(path.dirname(file), filePart))) {
          broken.push(`${path.relative(ROOT, file).split(path.sep).join('/')}:${i + 1} -> ${target}`);
        }
      }
    });
}

console.log(`Checked ${checked} relative links in ${files.length} Markdown files.`);
if (broken.length) {
  console.error(`Broken links (${broken.length}):\n${broken.join('\n')}`);
  process.exit(1);
}
