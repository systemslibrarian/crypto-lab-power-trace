/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

// Loaded through Vite rather than node:fs: this lab has no @types/node, and
// `tsc --noEmit` gates its build.
const sources = import.meta.glob('../.github/workflows/*.yml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const names = Object.keys(sources).map((path) => path.slice(path.lastIndexOf('/') + 1)).sort();
const read = (name: string): string => {
  const key = Object.keys(sources).find((path) => path.endsWith(`/${name}`));
  if (key === undefined) throw new Error(`no workflow named ${name}`);
  return sources[key];
};

/**
 * CodeQL `actions/missing-workflow-permissions` reported ci.yml with no
 * `permissions:` block at all, so every job in it ran with whatever the
 * repository default grants. deploy.yml had the opposite problem: it declared
 * `pages: write` and `id-token: write` at the TOP level, so `build` — the job
 * that checks out and executes repository code, npm scripts and a Playwright
 * browser install — carried publish rights it never uses.
 *
 * CodeQL re-raises the first on every analysis, which is that fix's standing
 * guard. These pin what CodeQL does not check: that the write scopes stay OFF
 * the jobs running repository code, and land on the one that publishes.
 */
describe('workflow token scopes', () => {
  it('finds the workflows at all', () => {
    // A scan over nothing would pass every rule below.
    expect(names.length).toBeGreaterThanOrEqual(2);
  });

  it('declares a least-privilege default in every workflow', () => {
    const missing = names.filter((n) => !/^permissions:\n\s+contents: read/m.test(read(n).split('\njobs:')[0]));
    expect(missing).toEqual([]);
  });

  it('never lets a job that checks out repository code publish', () => {
    const offenders: string[] = [];
    for (const name of names) {
      const source = read(name);
      // A top-level grant reaches every job, including the ones that check out.
      if (/pages:\s*write|id-token:\s*write/.test(source.split('\njobs:')[0])) offenders.push(`${name}: preamble`);
      for (const [, job, body] of source.matchAll(/\n {2}([a-z0-9_-]+):\n((?: {4}.*\n|\n)*)/g)) {
        const publishes = /pages:\s*write|id-token:\s*write/.test(body);
        const checksOut = /uses:\s*actions\/checkout/.test(body);
        if (publishes && checksOut) offenders.push(`${name}: ${job}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the publish scopes on the job that actually publishes', () => {
    // Narrowing is only safe while the scopes land where they are needed.
    const deploy = read('deploy.yml');
    const job = deploy.slice(deploy.indexOf('\n  deploy:'));
    expect(job).toMatch(/permissions:\n\s+pages: write\n\s+id-token: write/);
    expect(job).toMatch(/uses:\s*actions\/deploy-pages/);
    expect(job).not.toMatch(/uses:\s*actions\/checkout/);
  });
});
