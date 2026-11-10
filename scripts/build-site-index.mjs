import fs from 'node:fs';
import path from 'node:path';

const sourcePath = 'data/sites-source.json';
const outputDir = 'public/data/sites';
const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
const records = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

if (!Array.isArray(records)) throw new Error('sites-source.json must contain a JSON array.');

const shards = Object.fromEntries(letters.map(letter => [letter, []]));
const seenHosts = new Set();
const seenNames = new Set();
const errors = [];

for (const [index, site] of records.entries()) {
  const label = `record #${index + 1}`;
  if (!site || typeof site !== 'object') { errors.push(`${label}: not an object`); continue; }
  if (typeof site.name !== 'string' || !site.name.trim()) { errors.push(`${label}: missing name`); continue; }
  if (typeof site.url !== 'string') { errors.push(`${label} (${site.name}): missing URL`); continue; }
  let url;
  try { url = new URL(site.url); } catch { errors.push(`${label} (${site.name}): invalid URL`); continue; }
  if (url.protocol !== 'https:') { errors.push(`${label} (${site.name}): URL must use HTTPS`); continue; }
  if (!/^[a-z]/i.test(site.name.trim())) { errors.push(`${label} (${site.name}): name must start with A-Z for alphabetic shards`); continue; }
  if (typeof site.category !== 'string' || !site.category.trim()) { errors.push(`${label} (${site.name}): missing category`); continue; }
  if (!Array.isArray(site.subjects) || site.subjects.some(x => typeof x !== 'string')) { errors.push(`${label} (${site.name}): subjects must be an array of strings`); continue; }
  if (typeof site.description !== 'string' || !site.description.trim()) { errors.push(`${label} (${site.name}): missing description`); continue; }

  const host = url.hostname.toLowerCase().replace(/^www\\./, '');
  const nameKey = site.name.trim().toLowerCase();
  if (seenHosts.has(host)) { errors.push(`${label} (${site.name}): duplicate website domain ${host}`); continue; }
  if (seenNames.has(nameKey)) { errors.push(`${label} (${site.name}): duplicate website name`); continue; }
  seenHosts.add(host);
  seenNames.add(nameKey);

  const clean = {
    name: site.name.trim(),
    url: url.toString(),
    category: site.category.trim(),
    subjects: [...new Set(site.subjects.map(x => x.trim()).filter(Boolean))],
    description: site.description.trim()
  };
  shards[clean.name[0].toLowerCase()].push(clean);
}

if (errors.length) {
  console.error(errors.join('\\n'));
  throw new Error(`Index validation failed with ${errors.length} issue(s). Fix the source data; invalid entries are not silently skipped.`);
}

fs.mkdirSync(outputDir, { recursive: true });
for (const [letter, items] of Object.entries(shards)) {
  items.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(outputDir, `${letter}.json`), JSON.stringify(items, null, 2) + '\\n');
}
const manifest = {
  version: 1,
  total: seenHosts.size,
  target: 50000,
  generatedAt: new Date().toISOString(),
  letters: Object.fromEntries(Object.entries(shards).map(([letter, items]) => [letter, items.length]))
};
fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\\n');
console.log(`Built ${manifest.total} unique education websites into 26 alphabetical JSON files.`);
if (manifest.total < manifest.target) {
  console.log(`Progress: ${manifest.total}/${manifest.target}. Add real, reviewed records to ${sourcePath}; this script does not invent websites.`);
}
