#!/usr/bin/env node
// Checks that every relative Markdown link in docs/ and the root Markdown files points to an
// existing file or directory. Skipped: links with a scheme (https:, mailto:, ftp:, tel:, ...),
// protocol-relative links (//host), same-page anchors, fenced code blocks and inline code.
// A leading "/" resolves from the repository root, as it does on GitHub.
//   node .github/scripts/check-links.mjs   # exits 1 and lists broken links
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// [text](target), [text](<target>), with an optional "title", 'title' or (title).
const INLINE = /\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
// Reference definitions: [label]: target
const REFERENCE = /^ {0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})\s*$/;

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

function targetsIn(line) {
  const withoutCode = line.replace(/(`+)[\s\S]*?\1/g, '');
  const targets = [...withoutCode.matchAll(INLINE)].map((m) => m[1]);
  const reference = withoutCode.match(REFERENCE);
  if (reference) targets.push(reference[1]);
  return targets.map((t) => (t.startsWith('<') && t.endsWith('>') ? t.slice(1, -1) : t));
}

/** The path a link points to, or null when it is not a local file link. */
function localPath(file, target) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//') || target.startsWith('#')) return null;
  let filePart = target.split('#')[0].split('?')[0];
  if (!filePart) return null;
  try {
    filePart = decodeURIComponent(filePart);
  } catch {
    // Not valid percent-encoding (for example "100%.md"): check the name as written.
  }
  return filePart.startsWith('/') ? path.join(ROOT, filePart) : path.resolve(path.dirname(file), filePart);
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
  // A fence closes only on the same character, at least as long, with nothing after it.
  let fence = null;
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (fence) {
        const close = line.match(CLOSING_FENCE);
        if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
        return;
      }
      const open = line.match(FENCE);
      if (open) {
        fence = { char: open[1][0], length: open[1].length };
        return;
      }
      for (const target of targetsIn(line)) {
        const resolved = localPath(file, target);
        if (!resolved) continue;
        checked += 1;
        if (!existsSync(resolved)) {
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
