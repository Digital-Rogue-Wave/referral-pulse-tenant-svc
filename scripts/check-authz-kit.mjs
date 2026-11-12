// E1 decision D1: tenant-service is the source of the authorization kit the other services copy verbatim. This
// check fails when a kit file changes without its manifest being regenerated (so the copies get the new hashes). Set AUTHZ_KIT_MANIFEST_URL to tenant-service's raw manifest to compare against the
// source of truth itself (a kit change in tenant-service then fails here until the copy is refreshed).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const local = JSON.parse(readFileSync(new URL('../authz-kit.manifest.json', import.meta.url), 'utf8'));
const url = process.env.AUTHZ_KIT_MANIFEST_URL;
const manifest = url ? await (await fetch(url, { headers: process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {} })).json() : local;

const drift = Object.entries(manifest.files).filter(([file, hash]) => {
    const content = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    return createHash('sha256').update(content).digest('hex') !== hash;
});
if (drift.length > 0) {
    console.error(`Authorization kit drifted from ${manifest.source}:\n${drift.map(([file]) => `  ${file}`).join('\n')}`);
    process.exit(1);
}
console.log(`Authorization kit matches ${manifest.source} (${Object.keys(manifest.files).length} files).`);
