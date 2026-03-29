// scripts/generate-manifest.mjs
// Scans public/ for all .md files and writes public/manifest.json
// Run: node scripts/generate-manifest.mjs

import { readdir, readFile, writeFile } from 'fs/promises';
import { join, relative, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const outputFile = join(publicDir, 'manifest.json');

const partTitles = {
  'part-1': 'Part 1: Foundations of State',
  'part-2': 'Part 2: Angular Signals Deep Dive',
  'part-3': 'Part 3: NgRx Classic Store Mastery',
  'part-4': 'Part 4: NgRx SignalStore',
  'part-5': 'Part 5: State Architecture at Scale',
  'part-6': 'Part 6: Nx Monorepo and Micro-Frontends',
  'part-7': 'Part 7: The Playbook',
};

async function walkDir(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDir(fullPath)));
    } else if (entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

async function extractTitle(filePath) {
  const content = await readFile(filePath, 'utf-8');
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

async function main() {
  const allFiles = await walkDir(publicDir);

  // Group by parent folder (relative to publicDir)
  const groups = new Map();

  for (const filePath of allFiles) {
    const rel = relative(publicDir, filePath).replace(/\\/g, '/');
    const parts = rel.split('/');

    if (parts.length < 2) continue; // skip top-level files

    const groupKey = parts.slice(0, -1).join('/'); // e.g. "book/part-1"
    const urlPath = rel.replace(/\.md$/, ''); // strip .md for URL

    const title = (await extractTitle(filePath)) ?? parts[parts.length - 1].replace(/\.md$/, '');

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey).push({ path: urlPath, file: rel, title });
  }

  // Sort chapters within each group
  for (const [, chapters] of groups) {
    chapters.sort((a, b) => a.file.localeCompare(b.file));
  }

  // Build parts array, grouping by top-level folder under book/
  const partsMap = new Map();
  for (const [groupKey, chapters] of groups) {
    const segments = groupKey.split('/');
    // segments e.g. ["book", "part-1"] or ["book", "part-1", "section"]
    const partKey = segments[1] ?? segments[0]; // e.g. "part-1"
    const partTitle = partTitles[partKey] ?? partKey;

    if (!partsMap.has(partKey)) {
      partsMap.set(partKey, { name: partKey, title: partTitle, chapters: [] });
    }
    partsMap.get(partKey).chapters.push(...chapters);
  }

  const parts = Array.from(partsMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const manifest = { parts };
  await writeFile(outputFile, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`manifest.json written with ${parts.length} part(s)`);
  for (const part of parts) {
    console.log(`  ${part.title}: ${part.chapters.length} chapter(s)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
