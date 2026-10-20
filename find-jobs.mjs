#!/usr/bin/env node
/**
 * find-jobs.mjs — fast, zero-LLM discovery for /find-jobs.
 *
 * Replaces the slow path (web search + a browser liveness check and a full JD
 * read per posting) with one deterministic pass:
 *
 *   1. `scan.mjs` fetches every enabled ATS board concurrently through its
 *      public API (no browser, no model tokens) and appends new postings to
 *      data/pipeline.md + data/scan-history.tsv, applying title/location/
 *      blacklist/dedup filters first.
 *   2. The postings that scan JUST added are ranked by the profile's own
 *      title_filter keywords, remote/worldwide location, and sponsorship
 *      wording.
 *   3. For the shortlist only, JD text comes from the ATS's own JSON API via
 *      fetch-jd.mjs (no browser) to reject roles explicitly requiring >5 YOE
 *      and onsite roles with no sponsorship signal.
 *   4. The top N go to data/last-found-jobs.json for /apply-job all.
 *
 * Usage:
 *   node find-jobs.mjs [count] [--since 14] [--keywords "go,kafka"] [--no-scan] [--json]
 *
 *   count        how many jobs to stage (default 5)
 *   --since N    posting freshness window in days (default 14)
 *   --keywords   extra terms that boost a title for THIS run only
 *   --no-scan    rank the existing Pending pipeline instead of scanning
 *   --json       machine-readable result on stdout
 *
 * Every candidate fact comes from the user layer (portals.yml, tracker,
 * profile). Nothing here hardcodes a candidate.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { buildTitleFilter, matchedTitleKeywords } from './scan.mjs';

const ROOT = getCareerOpsRoot();
const PORTALS = join(ROOT, 'portals.yml');
const PIPELINE = join(ROOT, 'data/pipeline.md');
const FOUND = join(ROOT, 'data/last-found-jobs.json');

const DEFAULTS = { count: 5, since: 14, shortlist: 3, jdTimeoutMs: 15000, jdConcurrency: 6 };

function parseArgs(argv) {
  const out = { count: null, since: DEFAULTS.since, keywords: [], noScan: false, json: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-scan') out.noScan = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--since') out.since = positiveInt(argv[++i], '--since');
    else if (arg.startsWith('--since=')) out.since = positiveInt(arg.slice(8), '--since');
    else if (arg === '--keywords') out.keywords.push(...splitKeywords(argv[++i]));
    else if (arg.startsWith('--keywords=')) out.keywords.push(...splitKeywords(arg.slice(11)));
    else if (/^\d+$/.test(arg)) out.count = Number(arg);
    else if (arg === '--help' || arg === '-h') {
      console.log(readFileSync(new URL(import.meta.url).pathname, 'utf-8').split('*/')[0].replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, ''));
      process.exit(0);
    } else {
      console.error(`find-jobs: unknown argument "${arg}"`);
      process.exit(2);
    }
  }
  out.count = out.count && out.count > 0 ? out.count : DEFAULTS.count;
  return out;
}

function positiveInt(raw, flag) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`find-jobs: ${flag} expects a positive integer, got "${raw}"`);
    process.exit(2);
  }
  return n;
}

function splitKeywords(raw) {
  return String(raw || '').split(/[,;]/).map(k => k.trim()).filter(Boolean);
}

function loadConfig() {
  if (!existsSync(PORTALS)) {
    console.error('find-jobs: portals.yml is missing. Run `node doctor.mjs` first.');
    process.exit(1);
  }
  const cfg = yaml.load(readFileSync(PORTALS, 'utf-8')) || {};
  const find = cfg.find_jobs || {};
  return {
    titleFilter: cfg.title_filter || { positive: [] },
    defaults: {
      count: positiveOr(find.count, DEFAULTS.count),
      since: positiveOr(find.since_days, DEFAULTS.since),
      shortlist: positiveOr(find.shortlist_multiplier, DEFAULTS.shortlist),
      jdTimeoutMs: positiveOr(find.jd_timeout_ms, DEFAULTS.jdTimeoutMs),
      jdConcurrency: positiveOr(find.jd_concurrency, DEFAULTS.jdConcurrency),
    },
  };
}

function positiveOr(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

// ── scan ────────────────────────────────────────────────────────────

function runScan(sinceDays) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'scan.mjs'), '--json', '--quiet', '--since', String(sinceDays)], {
      cwd: ROOT,
      env: { ...process.env, CAREER_OPS_SCAN_CONCURRENCY: process.env.CAREER_OPS_SCAN_CONCURRENCY || '20' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', err => resolve({ error: err.message, added: [] }));
    child.on('close', () => {
      const line = stdout.trim().split('\n').filter(Boolean).pop() || '';
      try {
        const receipt = JSON.parse(line);
        resolve({ receipt, added: Array.isArray(receipt.added_urls) ? receipt.added_urls : [], stderr });
      } catch {
        resolve({ error: `scan produced no JSON receipt${stderr ? `: ${stderr.trim().split('\n').pop()}` : ''}`, added: [] });
      }
    });
  });
}

// ── pipeline parsing ────────────────────────────────────────────────

function pipelineEntries() {
  if (!existsSync(PIPELINE)) return [];
  const entries = [];
  for (const line of readFileSync(PIPELINE, 'utf-8').split('\n')) {
    // `- [ ] {url} | {company} | {title} | {location?} | {comp?} | ...`
    // Split positionally instead of regex-capturing: a lazy group followed by
    // an optional one can stop after the first character of the title.
    // Only unchecked Pending entries are discovery candidates; `[x]` entries
    // are already processed and must never be staged again.
    if (!/^- \[ \]\s+/.test(line)) continue;
    const parts = line.replace(/^- \[ \]\s+/, '').split(' | ');
    if (parts.length < 3) continue;
    entries.push({
      url: parts[0].trim(),
      company: parts[1].trim(),
      title: parts[2].trim(),
      location: (parts[3] || '').trim(),
    });
  }
  return entries;
}

function urlKey(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return `${u.host.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return String(url).replace(/\/+$/, '');
  }
}

// ── relevance ranking ───────────────────────────────────────────────

const REMOTE_RE = /\b(?:remote|worldwide|anywhere|global(?:ly)?|distributed team|work from home)\b/i;
const WORLDWIDE_RE = /\b(?:worldwide|global(?:ly)?|anywhere|any country|fully remote)\b/i;
const INDIA_RE = /\b(?:india|bengaluru|bangalore|hyderabad|pune|gurgaon|gurugram|noida|mumbai|chennai|delhi)\b/i;
const SPONSOR_RE = /\b(?:visa|work permit|work authori[sz]ation|sponsor(?:ship|ed|ing)?|relocat(?:e|ion)|blue card|skilled worker|tier 2|h-?1b|employment pass|s pass|global mobility)\b/i;
const SENIORITY_RE = /\b(?:senior|lead)\b/i;

function hasLocationSignal(location) {
  return Boolean(location) && !/^(?:not specified|n\/?a|unknown|—|-)$/i.test(location.trim());
}

function rankEntry(entry, titleFilter, extraKeywords) {
  const title = entry.title;
  const location = entry.location;
  const locationKnown = hasLocationSignal(location);
  const matched = matchedTitleKeywords(title, titleFilter);
  // A longer matched phrase is a more specific target ("Distributed Systems"
  // over "Go"), so it carries more weight than a short generic one.
  const specificity = matched.reduce((sum, kw) => sum + kw.replace(/^(?:word|stem):/, '').length, 0);

  let score = specificity + matched.length * 3;
  const worldwide = WORLDWIDE_RE.test(location);
  const remote = REMOTE_RE.test(location);
  const sponsored = SPONSOR_RE.test(location);
  if (worldwide) score += 50;
  else if (remote) score += 20;
  if (sponsored) score += 30;
  if (SENIORITY_RE.test(title)) score += 4;
  for (const kw of extraKeywords) {
    if (title.toLowerCase().includes(kw.toLowerCase())) score += 8;
  }
  // Onsite India is out of the location policy; worldwide/remote postings that
  // merely name an India office are not.
  if (INDIA_RE.test(location) && !remote) score -= 1000;
  // A KNOWN onsite location outside India with no sponsorship signal is a dead
  // end. A missing location is ambiguous, not unsponsorable — never penalize it
  // as if the provider had said "onsite".
  if (locationKnown && !remote && !sponsored) score -= 60;
  // A country-bound "Remote" (e.g. "Remote, Spain") is not worldwide remote.
  // Keep it reachable — sponsorship can still make it valid — but behind true
  // global-remote postings.
  if (remote && !worldwide && !sponsored) score -= 25;

  return { score, matched };
}

// ── JD checks (shortlist only, ATS API, no browser) ─────────────────

function fetchJd(url, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'fetch-jd.mjs'), url], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(''); }, timeoutMs);
    child.on('error', () => { clearTimeout(timer); resolve(''); });
    child.on('close', () => { clearTimeout(timer); resolve(out); });
  });
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Pull the minimum required years of experience out of a JD. Only phrasings
 * that tie a number to "experience" count; "the team has 10 years of combined
 * experience" and a founding year do not match. Returns null when the JD names
 * no requirement (ambiguous stays ambiguous — never guessed).
 */
export function parseRequiredYears(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const ranges = [];
  const patterns = [
    // "3+ years of ... experience", "2-4 years experience"
    /\b(\d{1,2})(?:\s*(?:[–—-]|to)\s*(\d{1,2}))?\s*\+?\s*(?:years?|yrs?)\b[^.!?\n]{0,70}?\bexperience\b/gi,
    // "experience of 3+ years", "experience: 2–4 years"
    /\bexperience\b[^.!?\n]{0,40}?[:of ]{0,6}(\d{1,2})(?:\s*(?:[–—-]|to)\s*(\d{1,2}))?\s*\+?\s*(?:years?|yrs?)\b/gi,
  ];
  for (const re of patterns) {
    for (const m of t.matchAll(re)) {
      const lo = Number(m[1]);
      const hi = m[2] ? Number(m[2]) : null;
      if (Number.isFinite(lo) && lo > 0) ranges.push({ lo, hi });
    }
  }
  if (!ranges.length) return null;
  return {
    minLo: Math.min(...ranges.map(r => r.lo)),
    maxHi: Math.max(...ranges.map(r => r.hi ?? r.lo)),
    mentions: ranges.length,
  };
}

function jdVerdict(entry, jd) {
  const haystack = `${entry.title} ${entry.location} ${jd}`;
  const locationKnown = hasLocationSignal(entry.location);
  const remote = REMOTE_RE.test(entry.location);
  const yoe = parseRequiredYears(jd);
  if (yoe && yoe.minLo > 5) {
    return { ok: false, reason: `requires ${yoe.minLo}+ years (outside 1-5 YOE)` };
  }
  const sponsored = SPONSOR_RE.test(haystack);
  const worldwide = WORLDWIDE_RE.test(entry.location);
  // Only a KNOWN onsite location demands a sponsorship signal. Missing location
  // data stays ambiguous and passes; the apply step sees the real form.
  if (locationKnown && !remote && !sponsored) {
    return { ok: false, reason: 'onsite outside India with no visa-sponsorship/relocation signal' };
  }
  // "Remote · United States" / "Remote, Spain" is country-bound, not worldwide
  // remote. It only clears the location policy when the posting also advertises
  // sponsorship/relocation.
  if (locationKnown && remote && !worldwide && !sponsored
      && /\b(?:united states|usa|u\.s\.|canada|united kingdom|uk|germany|france|spain|portugal|netherlands|poland|ireland|korea|japan|singapore|australia|brazil|europe|emea)\b/i.test(entry.location)) {
    return { ok: false, reason: 'remote restricted to a specific country with no sponsorship signal' };
  }
  if (remote && jd) {
    const restriction = jd.match(/\b(?:must|required to|only)\s+(?:be\s+)?(?:based|located|reside|residing)\b[^.!?\n]{0,80}/i);
    if (restriction && !/\b(?:india|worldwide|global|anywhere|apac|asia|any country|any time ?zone)\b/i.test(restriction[0])) {
      return { ok: false, reason: `remote restricted: ${restriction[0].trim().slice(0, 60)}` };
    }
  }
  return {
    ok: true,
    yoe: yoe ? `${yoe.minLo}${yoe.hi ? `-${yoe.maxHi}` : '+'} yrs` : 'unspecified',
    locationUnverified: !locationKnown,
  };
}

// ── main ────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { titleFilter, defaults } = loadConfig();
  const count = args.count || defaults.count;
  const since = args.since || defaults.since;

  let addedUrls = [];
  let receipt = null;
  if (!args.noScan) {
    console.error(`Scanning enabled ATS boards (zero-token, last ${since} days)...`);
    const scan = await runScan(since);
    if (scan.error) {
      console.error(`find-jobs: ${scan.error}`);
      process.exitCode = 1;
      return;
    }
    receipt = scan.receipt;
    addedUrls = scan.added;
    console.error(`Scan done: ${receipt.scanned} boards, ${receipt.found} postings, ${receipt.added} new matches.`);
  }

  let candidates = pipelineEntries();
  if (addedUrls.length) {
    const added = new Set(addedUrls.map(urlKey));
    candidates = candidates.filter(entry => added.has(urlKey(entry.url)));
  } else if (!args.noScan) {
    candidates = [];
  }
  if (!candidates.length) {
    console.error('No new postings matched. Try a longer window: node find-jobs.mjs 5 --since 30');
    if (!args.json) console.log('No new postings matched.');
    return;
  }

  // Re-apply the compiled title filter: scan already gated the postings it
  // just added, but `--no-scan` reads the whole Pending inbox, where older
  // entries may predate the current positive/negative lists.
  const passesTitleFilter = buildTitleFilter(titleFilter);
  const ranked = candidates
    .filter(entry => passesTitleFilter(entry.title))
    .map(entry => {
      const { score, matched } = rankEntry(entry, titleFilter, args.keywords);
      return { ...entry, score, matched };
    })
    .filter(entry => entry.score > -500)
    .sort((a, b) => b.score - a.score);

  const shortlistSize = Math.min(ranked.length, count * defaults.shortlist);
  const shortlist = ranked.slice(0, shortlistSize);

  console.error(`Checking ${shortlist.length} shortlisted postings (ATS JD API, no browser)...`);
  const checked = await mapPool(shortlist, defaults.jdConcurrency, async (entry) => {
    const jd = await fetchJd(entry.url, defaults.jdTimeoutMs);
    return { ...entry, jd, verdict: jdVerdict(entry, jd) };
  });

  const accepted = checked.filter(entry => entry.verdict.ok).slice(0, count);
  const rejected = checked.filter(entry => !entry.verdict.ok);

  if (!accepted.length) {
    console.error('Scan found matches, but none passed the 1-5 YOE / sponsorship checks.');
    if (!args.json) console.log('No suitable new postings.');
    return;
  }

  const batch = accepted.map((entry, i) => ({
    index: i + 1,
    name: entry.company,
    company: entry.company,
    role: entry.title,
    title: entry.title,
    url: entry.url,
    location: entry.location || 'Not specified',
    score: entry.score,
    yoe: entry.verdict.yoe,
    location_unverified: Boolean(entry.verdict.locationUnverified),
    reason: entry.matched.length ? `matched: ${entry.matched.slice(0, 3).join(', ')}` : 'title match',
  }));

  if (!args.dryRun) writeFileSync(FOUND, `${JSON.stringify(batch, null, 2)}\n`);

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ found: batch, rejected: rejected.map(e => ({ company: e.company, title: e.title, reason: e.verdict.reason })), receipt })}\n`);
    return;
  }

  console.log(`\n${batch.length} new job${batch.length === 1 ? '' : 's'} ${args.dryRun ? '(dry run — last-found-jobs.json unchanged)' : 'staged in data/last-found-jobs.json'}\n`);
  for (const job of batch) {
    console.log(`[${job.index}] ${job.company} — ${job.role}`);
    console.log(`    Location: ${job.location}${job.location_unverified ? ' (unverified — check the posting)' : ''}`);
    console.log(`    YOE: ${job.yoe} | ${job.reason}`);
    console.log(`    ${job.url}`);
  }
  if (rejected.length) {
    console.error(`\n(${rejected.length} shortlisted posting${rejected.length === 1 ? '' : 's'} rejected: ${rejected.map(e => e.verdict.reason).join('; ')})`);
  }
  console.log('\nApply to all with /apply-job all, or one with /apply-job <number>.');
}

main().catch(err => {
  console.error(`find-jobs: ${err.message}`);
  process.exitCode = 1;
});
