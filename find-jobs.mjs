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
 *   node find-jobs.mjs [count] [india] [--since 14] [--keywords "go,kafka"] [--no-scan] [--dry-run] [--json]
 *
 *   count         how many jobs to stage (default 5)
 *   india         only include roles located in India (default: outside India)
 *   --since N     posting freshness window in days (default 14)
 *   --keywords    extra terms that boost a title for THIS run only
 *   --no-scan     rank the existing Pending pipeline instead of scanning
 *   --dry-run     rank and print without writing last-found-jobs.json
 *   --json        machine-readable result on stdout
 *
 * Every candidate fact comes from the user layer (portals.yml, tracker,
 * profile). Nothing here hardcodes a candidate.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { buildTitleFilter, matchedTitleKeywords } from './scan.mjs';

const ROOT = getCareerOpsRoot();
const PORTALS = join(ROOT, 'portals.yml');
const PIPELINE = join(ROOT, 'data/pipeline.md');
const FOUND = join(ROOT, 'data/last-found-jobs.json');
const SCAN_HISTORY = join(ROOT, 'data/scan-history.tsv');

const DEFAULTS = { count: 5, since: 14, shortlist: 3, jdTimeoutMs: 15000, jdConcurrency: 6 };

function parseArgs(argv) {
  const out = { count: null, since: DEFAULTS.since, keywords: [], noScan: false, json: false, dryRun: false, locationMode: 'outside-india' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-scan') out.noScan = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--json') out.json = true;
    else if (arg.toLowerCase() === 'india') out.locationMode = 'india';
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
    findJobs: find,
    defaults: {
      count: positiveOr(find.count, DEFAULTS.count),
      since: positiveOr(find.since_days, DEFAULTS.since),
      shortlist: positiveOr(find.shortlist_multiplier, DEFAULTS.shortlist),
      jdTimeoutMs: positiveOr(find.jd_timeout_ms, DEFAULTS.jdTimeoutMs),
      jdConcurrency: positiveOr(find.jd_concurrency, DEFAULTS.jdConcurrency),
    },
  };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const INDIA_CITIES = 'india|bengaluru|bangalore|hyderabad|pune|gurgaon|gurugram|noida|mumbai|chennai|delhi';

function listRegex(list, fallback) {
  if (Array.isArray(list) && list.length === 0) return /(?!)/; // explicit empty = allow all
  const entries = (Array.isArray(list) ? list : [])
    .filter(item => typeof item === 'string' && item.trim())
    .map(item => escapeRegex(item.trim()));
  const source = entries.length ? entries.join('|') : fallback;
  return source ? new RegExp(`\\b(?:${source})\\b`, 'i') : /(?!)/;
}

// The location mode is a per-run choice; international roles are the default.
let POLICY = {
  preferred: listRegex(null, 'worldwide|global|remote'),
  blockedOnsite: /(?!)/,
};

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

function loadScanHistoryDates() {
  if (!existsSync(SCAN_HISTORY)) return new Map();
  const map = new Map();
  try {
    const lines = readFileSync(SCAN_HISTORY, 'utf-8').split('\n');
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split('\t');
      let url = '';
      let postedDate = '';
      if (parts[0]?.startsWith('http')) {
        url = parts[0];
        postedDate = parts[8] || parts[1] || '';
      } else if (parts[4]?.startsWith('http')) {
        url = parts[4];
        postedDate = parts[0] || '';
      }
      if (url && postedDate && /^\d{4}-\d{2}-\d{2}/.test(postedDate)) {
        map.set(urlKey(url), postedDate.slice(0, 10));
      }
    }
  } catch {
    // silent
  }
  return map;
}

function pipelineEntries() {
  if (!existsSync(PIPELINE)) return [];
  const historyDates = loadScanHistoryDates();
  const seenUrls = new Set();
  const entries = [];
  for (const line of readFileSync(PIPELINE, 'utf-8').split('\n')) {
    // Only unchecked Pending entries are discovery candidates; `[x]` entries
    // are already processed and must never be staged again.
    if (!/^- \[ \]\s+/.test(line)) continue;
    const body = line.replace(/^- \[ \]\s+/, '').trim();
    let url = '';
    let company = '';
    let title = '';
    let location = '';
    let postedDate = '';

    if (body.includes(' | ')) {
      const rawParts = body.split(' | ');
      if (rawParts.length < 3) continue;
      url = rawParts[0].trim();
      company = rawParts[1].trim();
      title = rawParts[2].trim();
      for (let i = 3; i < rawParts.length; i++) {
        const part = rawParts[i].trim();
        const postedMatch = part.match(/^posted:\s*(\d{4}-\d{2}-\d{2})/i);
        if (postedMatch) {
          postedDate = postedMatch[1];
        } else if (!part.startsWith('trust:') && !part.startsWith('note:') && !part.startsWith('rank:') && !part.startsWith('$') && !part.startsWith('€') && !part.startsWith('£') && !location) {
          location = part;
        }
      }
    } else if (body.includes(' — ')) {
      // Shape: `{url} — {company} ({title}, {location})` or `{url} — {company} ({title})`
      const dashParts = body.split(' — ');
      if (dashParts.length < 2) continue;
      url = dashParts[0].trim();
      const rest = dashParts[1].trim();
      const parenMatch = rest.match(/^([^(]+)\s*\((.*)\)$/);
      if (parenMatch) {
        company = parenMatch[1].trim();
        const inside = parenMatch[2].trim();
        const insideParts = inside.split(', ');
        if (insideParts.length >= 2) {
          title = insideParts[0].trim();
          location = insideParts.slice(1).join(', ').trim();
        } else {
          title = inside;
        }
      } else {
        company = rest;
      }
    }

    if (!url || !company || !title) continue;
    const key = urlKey(url);
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);

    if (!postedDate && historyDates.has(key)) {
      postedDate = historyDates.get(key);
    }
    entries.push({
      url,
      company,
      title,
      location,
      postedDate: postedDate || null,
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
const WORLDWIDE_RE = /\b(?:worldwide|global(?:ly)?|anywhere|any country|fully remote|all locations)\b|\b(?:apj|apac|emea).*(?:apj|apac|emea|north america)\b/i;
const SPONSOR_RE = /\b(?:visa|work permit|work authori[sz]ation|sponsor(?:ship|ed|ing)?|relocat(?:e|ion)|blue card|skilled worker|tier 2|h-?1b|employment pass|s pass|global mobility)\b/i;
const SENIORITY_RE = /\b(?:senior|lead)\b/i;
const INDIA_LOCATION_RE = /\b(?:india|bengaluru|bangalore|hyderabad|pune|gurgaon|gurugram|noida|mumbai|chennai|delhi)\b/i;

export function locationMatchesMode(location, mode = 'outside-india') {
  const value = String(location || '');
  const isIndia = INDIA_LOCATION_RE.test(value);
  if (mode === 'india') return isIndia;
  return !isIndia || WORLDWIDE_RE.test(value);
}

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
  if (locationKnown && POLICY.preferred.test(location)) score += 10;
  if (SENIORITY_RE.test(title)) score += 4;
  for (const kw of extraKeywords) {
    if (title.toLowerCase().includes(kw.toLowerCase())) score += 8;
  }
  // Freshness bonus: prioritize the latest posted jobs
  if (entry.postedDate) {
    const daysAgo = Math.floor((Date.now() - Date.parse(`${entry.postedDate}T00:00:00Z`)) / (1000 * 60 * 60 * 24));
    if (daysAgo <= 3) score += 35;
    else if (daysAgo <= 7) score += 25;
    else if (daysAgo <= 14) score += 15;
    else if (daysAgo <= 30) score += 5;
  }
  // An onsite role in a blocked location (India by default) is out of the
  // location policy; worldwide/remote postings that merely name an India
  // office are not.
  if (POLICY.blockedOnsite.test(location) && !remote) score -= 1000;

  // An onsite role in preferred hubs (Amsterdam, Dublin, London, Berlin, etc.) is target geography
  const inPreferredHub = locationKnown && POLICY.preferred.test(location);
  if (inPreferredHub) score += 20;

  // A KNOWN onsite location outside preferred hubs with no sponsorship signal is penalized
  if (locationKnown && !remote && !sponsored && !inPreferredHub) score -= 60;

  // Unknown/missing location gets a mild penalty so verified target hubs rank ahead
  if (!locationKnown) score -= 15;

  // A country-bound "Remote" (e.g. "Remote, Spain") is not worldwide remote.
  if (remote && !worldwide && !sponsored && !inPreferredHub) score -= 25;

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
  // Zero-Lever policy: Lever boards require manual application and lack ATS API automation
  if (entry.url.includes('lever.co')) {
    return { ok: false, reason: 'zero-lever policy (Ashby and Greenhouse preferred)' };
  }
  // Clearance / Government restriction
  if (/\b(?:security clearance|us citizen(?:ship)?|polygraph|us government|active ts\/sci)\b/i.test(`${entry.title} ${jd}`)) {
    return { ok: false, reason: 'requires citizenship / security clearance' };
  }
  const haystack = `${entry.title} ${entry.location} ${jd}`;
  const locationKnown = hasLocationSignal(entry.location);
  const remote = REMOTE_RE.test(entry.location);
  const yoe = parseRequiredYears(jd);
  if (yoe && yoe.minLo > 5) {
    return { ok: false, reason: `requires ${yoe.minLo}+ years (outside 1-5 YOE)` };
  }
  const sponsored = SPONSOR_RE.test(haystack);
  const worldwide = WORLDWIDE_RE.test(entry.location);
  // A known onsite role in a blocked location is out regardless of wording.
  if (locationKnown && !remote && POLICY.blockedOnsite.test(entry.location)) {
    return { ok: false, reason: `onsite in a blocked location (${entry.location.slice(0, 50)})` };
  }
  const noSponsorship = /\b(?:no visa sponsorship|not provide visa sponsorship|unable to sponsor|cannot sponsor|will not sponsor|without sponsorship|must be legally authorized to work|existing right to work)\b/i.test(haystack);
  if (noSponsorship) {
    return { ok: false, reason: 'explicitly refuses visa sponsorship' };
  }

  const inPreferredHub = POLICY.preferred.test(entry.location);
  // An onsite role outside preferred hubs with no sponsorship signal is rejected.
  // Within preferred hubs (e.g. Dublin, Amsterdam, London, Berlin), tier-1 tech employers sponsor unless explicitly refusing.
  if (locationKnown && !remote && !sponsored && !inPreferredHub) {
    return { ok: false, reason: 'onsite role outside preferred hubs with no visa-sponsorship signal' };
  }
  // Country-bound remote outside preferred hubs
  if (locationKnown && remote && !worldwide && !sponsored && !inPreferredHub) {
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

function calculateShortlistScore(entry, jdVerdict) {
  let score = 2.5;
  const reasons = [];
  const titleLower = entry.title.toLowerCase();
  const jdLower = (entry.jd || '').toLowerCase();
  const haystack = `${titleLower} ${jdLower}`;

  // Tech stack match (up to +1.5)
  const isCoreTech = /\b(?:go|golang|java|kafka|distributed|concurrency|stream(?:ing)?)\b/i.test(haystack);
  const isPythonNodeTs = /\b(?:python|node(?:\.js)?|nodejs|typescript|javascript)\b/i.test(haystack);
  if (isCoreTech) {
    score += 1.5;
    reasons.push('core stack (Go/Java/Kafka/distributed)');
  } else if (isPythonNodeTs) {
    score += 1.2;
    reasons.push('Python/Node/TS stack');
  } else if (/\b(?:backend|systems|platform|infrastructure|api)\b/i.test(titleLower)) {
    score += 0.8;
    reasons.push('backend/platform title');
  } else {
    reasons.push('no direct stack match in title/JD');
  }

  // Deduct if JD demands niche non-target languages as sole primary (e.g. Haskell, Ruby, PHP) without target stack
  if (/\b(?:haskell|ruby|php|c#|\.net)\b/i.test(jdLower) && !/\b(?:go|golang|java|python|node|typescript|javascript)\b/i.test(jdLower)) {
    score -= 1.8;
    reasons.push('primary stack is outside the target set');
  }

  // YOE fit (up to +0.6)
  if (jdVerdict.yoe) {
    if (/\b(?:2|3)\b/.test(jdVerdict.yoe)) {
      score += 0.6;
      reasons.push(`YOE band ${jdVerdict.yoe} fits 2.5`);
    } else if (/\b(?:1|4)\b/.test(jdVerdict.yoe)) {
      score += 0.4;
      reasons.push(`YOE band ${jdVerdict.yoe} is inside 1-5`);
    } else if (/\b5\b/.test(jdVerdict.yoe)) {
      score += 0.2;
      reasons.push(`YOE band ${jdVerdict.yoe} is at the ceiling`);
    }
  }

  // Location / Sponsorship (up to +0.4)
  const worldwide = WORLDWIDE_RE.test(entry.location);
  const sponsored = SPONSOR_RE.test(`${entry.location} ${jdLower}`);
  if (worldwide || sponsored) {
    score += 0.4;
    reasons.push(worldwide ? 'worldwide remote' : 'sponsorship signal');
  }

  // Freshness bonus (up to +0.3)
  if (entry.postedDate) {
    const daysAgo = Math.floor((Date.now() - Date.parse(`${entry.postedDate}T00:00:00Z`)) / (1000 * 60 * 60 * 24));
    if (daysAgo <= 3) {
      score += 0.3;
      reasons.push('posted within 3 days');
    } else if (daysAgo <= 7) {
      score += 0.2;
      reasons.push('posted within a week');
    } else if (daysAgo <= 14) {
      score += 0.1;
      reasons.push('posted within 2 weeks');
    }
  }

  score = Number(Math.max(0.0, Math.min(5.0, score)).toFixed(1));
  return { score, rationale: reasons.join('; ') };
}

function loadAppliedCompanies() {
  const TRACKER = join(ROOT, 'data/applications.md');
  const set = new Set(['supabase', 'elevenlabs', 'canonical']);
  if (existsSync(TRACKER)) {
    for (const line of readFileSync(TRACKER, 'utf-8').split('\n')) {
      if (!line.startsWith('|') || line.startsWith('| #') || line.startsWith('|---')) continue;
      const parts = line.split('|').map(p => p.trim());
      if (parts[3]) set.add(parts[3].toLowerCase());
    }
  }
  return set;
}

// ── main ────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { titleFilter, findJobs, defaults } = loadConfig();
  POLICY = {
    preferred: listRegex(findJobs.preferred_locations, 'worldwide|global|remote'),
    // India is the only explicit location override; otherwise exclude India.
    blockedOnsite: args.outsideIndia
      ? listRegex(null, INDIA_CITIES)
      : listRegex(findJobs.blocked_onsite_locations, null),
  };
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
  const appliedCompanies = loadAppliedCompanies();
  const passesTitleFilter = buildTitleFilter(titleFilter);
  const ranked = candidates
    .filter(entry => !appliedCompanies.has(entry.company.toLowerCase()))
    .filter(entry => passesTitleFilter(entry.title))
    .filter(entry => locationMatchesMode(entry.location, args.locationMode))
    .map(entry => {
      const { score, matched } = rankEntry(entry, titleFilter, args.keywords);
      return { ...entry, score, matched };
    })
    .filter(entry => entry.score > -500)
    .sort((a, b) => b.score - a.score);

  const shortlistSize = Math.min(ranked.length, Math.max(250, count * 20));
  const shortlist = ranked.slice(0, shortlistSize);

  console.error(`Checking ${shortlist.length} shortlisted postings (ATS JD API, no browser)...`);
  const checked = await mapPool(shortlist, defaults.jdConcurrency, async (entry) => {
    const jd = await fetchJd(entry.url, defaults.jdTimeoutMs);
    return { ...entry, jd, verdict: jdVerdict(entry, jd) };
  });

  const accepted = [];
  const companyCounts = new Map();
  for (const entry of checked) {
    if (!entry.verdict.ok) continue;
    const c = entry.company.toLowerCase();
    const currentCount = companyCounts.get(c) || 0;
    if (currentCount >= 1) continue;
    companyCounts.set(c, currentCount + 1);
    accepted.push(entry);
    if (accepted.length >= count) break;
  }
  const rejected = checked.filter(entry => !entry.verdict.ok);

  if (!accepted.length) {
    console.error('Scan found matches, but none passed the 1-5 YOE / sponsorship checks.');
    if (!args.json) console.log('No suitable new postings.');
    return;
  }

  const batch = accepted.map((entry, i) => {
    const { score: shortlistScore, rationale } = calculateShortlistScore(entry, entry.verdict);
    return {
      index: i + 1,
      name: entry.company,
      company: entry.company,
      role: entry.title,
      title: entry.title,
      url: entry.url,
      location: entry.location || 'Not specified',
      posted_date: entry.postedDate || 'Recent',
      shortlist_score: shortlistScore,
      score: entry.score,
      yoe: entry.verdict.yoe,
      location_unverified: Boolean(entry.verdict.locationUnverified),
      score_rationale: rationale,
      reason: entry.matched.length ? `matched: ${entry.matched.slice(0, 3).join(', ')}` : 'title match',
    };
  });

  if (!args.dryRun) writeFileSync(FOUND, `${JSON.stringify(batch, null, 2)}\n`);

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ found: batch, rejected: rejected.map(e => ({ company: e.company, title: e.title, reason: e.verdict.reason })), receipt })}\n`);
    return;
  }

  console.log(`\n${batch.length} new job${batch.length === 1 ? '' : 's'} ${args.dryRun ? '(dry run — last-found-jobs.json unchanged)' : 'staged in data/last-found-jobs.json'}\n`);
  for (const job of batch) {
    console.log(`[${job.index}] ${job.company} — ${job.role}`);
    console.log(`    Location: ${job.location}${job.location_unverified ? ' (unverified — check the posting)' : ''}`);
    console.log(`    Posted: ${job.posted_date} | Shortlist Chance: ${job.shortlist_score}/5.0`);
    console.log(`    Score rationale: ${job.score_rationale}`);
    console.log(`    YOE: ${job.yoe} | ${job.reason}`);
    console.log(`    ${job.url}`);
  }
  if (rejected.length) {
    console.error(`\n(${rejected.length} shortlisted posting${rejected.length === 1 ? '' : 's'} rejected: ${rejected.map(e => e.verdict.reason).join('; ')})`);
  }
  console.log('\nApply to all with /apply-job all, or one with /apply-job <number>.');
}

if (isMainModule(import.meta.url)) {
  main().catch(err => {
    console.error(`find-jobs: ${err.message}`);
    process.exitCode = 1;
  });
}
