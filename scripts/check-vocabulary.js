'use strict';

// Vocabulary guard for the six terms the project brief prohibits in user-facing
// text, comments, and exports. Patterns are assembled from fragments so this
// file itself does not contain the literal terms.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGETS = ['src', 'test', 'README.md', 'PROJECT_CONTEXT.md', '.env.example', 'demo-assets', 'DEVPOST.md'];
const EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.html', '.css', '.md', '.json', '.txt']);

const TERMS = [
  ['str', 'ess'],
  ['anxiet', 'y'],
  ['diagnos', 'is'],
  ['heal', 'th'],
  ['fatigu', 'ed'],
  ['abnorm', 'al'],
].map((parts) => parts.join(''));

function walk(target, files = []) {
  const abs = path.join(ROOT, target);
  if (!fs.existsSync(abs)) return files;
  const stat = fs.statSync(abs);
  if (stat.isFile()) {
    if (EXTENSIONS.has(path.extname(abs).toLowerCase())) files.push(abs);
    return files;
  }
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    walk(path.join(target, entry.name), files);
  }
  return files;
}

const files = TARGETS.flatMap((target) => walk(target));
const hits = [];

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const lower = text.toLowerCase();
  for (const term of TERMS) {
    let index = lower.indexOf(term);
    while (index !== -1) {
      const line = lower.slice(0, index).split('\n').length;
      hits.push({ file: path.relative(ROOT, file), line, term });
      index = lower.indexOf(term, index + term.length);
    }
  }
}

if (hits.length > 0) {
  console.error('[clippulse] Prohibited vocabulary found:');
  for (const hit of hits) {
    console.error(`  ${hit.file}:${hit.line}  ${hit.term}`);
  }
  process.exit(1);
}

console.log(`[clippulse] Vocabulary check clean (${files.length} files scanned).`);
