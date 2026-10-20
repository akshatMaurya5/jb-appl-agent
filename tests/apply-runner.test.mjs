import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTargets } from '../apply-runner.mjs';

// readTargets resolves the data root from CAREER_OPS_ROOT first (an inherited
// one from the harness would otherwise outrank the fixture), so pin BOTH:
// set the high-precedence var to the fixture and clear the lower one.
const root = mkdtempSync(join(tmpdir(), 'apply-runner-'));
delete process.env.CAREER_OPS_DATA_DIR;
process.env.CAREER_OPS_ROOT = root;
try {
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'data/last-found-jobs.json'), JSON.stringify([
    { index: 1, name: 'Acme', company: 'Acme', role: 'SWE', url: 'https://jobs.ashbyhq.com/acme/111' },
    { index: 2, name: 'Beta', company: 'Beta', role: 'PM', url: 'https://job-boards.greenhouse.io/beta/jobs/222' },
  ]));
  writeFileSync(join(root, 'data/pipeline.md'), [
    '# Pipeline — Pending URLs',
    '## Pending',
    '- [ ] https://jobs.lever.co/gamma/333 — Gamma (Engineer, London, UK)',
    '- [x] https://jobs.lever.co/done/444 — Done (Already processed)',
    '- [ ] https://jobs.ashbyhq.com/acme/111 — Acme (SWE, duplicate URL across sources)',
  ].join('\n'));

  test('readTargets merges the discovery batch and Pending URLs, deduped by URL', () => {
    const targets = readTargets();
    assert.equal(targets.length, 3, '2 found + 1 new pending; duplicate and checked rows dropped');
    const acme = targets.find(target => target.company === 'Acme');
    assert.equal(acme.role, 'SWE');
    assert.equal(acme.url, 'https://jobs.ashbyhq.com/acme/111');
    const gamma = targets.find(target => target.url.includes('lever.co/gamma'));
    assert.equal(gamma.company, 'Gamma');
    assert.equal(gamma.role, 'Engineer, London, UK');
  });

  test('readTargets tolerates missing source files', () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'apply-runner-empty-'));
    process.env.CAREER_OPS_ROOT = emptyRoot;
    try {
      assert.deepEqual(readTargets(), []);
    } finally {
      process.env.CAREER_OPS_ROOT = root;
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });
} finally {
  // node:test runs tests after this module body; defer cleanup to exit.
  process.on('exit', () => {
    delete process.env.CAREER_OPS_ROOT;
    rmSync(root, { recursive: true, force: true });
  });
}
