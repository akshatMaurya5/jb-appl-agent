// job-queue.mjs — one parser for every shape `data/pipeline.md` has ever been
// written in, plus the "mark this posting done" write that keeps a submitted
// application from being re-attempted forever.
//
// WHY THIS EXISTS
// ---------------
// `apply-runner.mjs` used to parse a pending line with exactly one regex:
//
//   /^\s*- \[ \]\s+(https?:\/\/\S+)\s*—\s*(.+)$/     (em dash only)
//
// Measured against the real queue, 774 of 798 pending entries are the PIPE
// shape produced by the scanners and discovery scripts:
//
//   - [ ] https://jobs.ashbyhq.com/cursor/… | Cursor | Software Engineer | Remote
//   - [ ] https://jobs.lever.co/palantir/… — Palantir (Backend Engineer, London)
//
// So the runner saw 3 of 20 targets on a real queue and silently ignored the
// rest — the single biggest reason "the apply flow never gets through the
// list". A parser that refuses to admit a line exists cannot be fixed by
// adding retries downstream.
//
// The second half of the same bug is on the WRITE side. After a confirmed
// submission `autofill.mjs` appended `- [x] {url}` only when the URL was not
// already in the file. A URL that was already queued as `- [ ]` therefore kept
// its pending line, so the next runner cycle offered the same posting again —
// the duplicate application you cannot take back. markPipelineSubmitted()
// rewrites the existing line instead of appending beside it.
//
// WHAT IT DOES NOT DO
// -------------------
// It never fetches, never evaluates, never reorders the queue's intent. It
// reads lines and (only for markPipelineSubmitted) flips one checkbox.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeUrl } from '../url-key.mjs';

/** Checkbox states a pipeline line can carry. */
export const LINE_STATE = Object.freeze({
  PENDING: 'pending',
  DONE: 'done',
  BLOCKED: 'blocked',
  OTHER: 'other',
});

const CHECKBOX_RE = /^\s*[-*]\s*\[(.)\]\s*/;
const URL_RE = /(https?:\/\/[^\s|]+)/;

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function stateFor(marker) {
  if (marker === ' ') return LINE_STATE.PENDING;
  if (marker === 'x' || marker === 'X') return LINE_STATE.DONE;
  if (marker === '!') return LINE_STATE.BLOCKED;
  return LINE_STATE.OTHER;
}

/**
 * Parse `Company (Role, Location)` — the em-dash format. The trailing detail in
 * parentheses is split on commas, but the FIRST comma only, because roles
 * themselves contain commas ("Engineer, Infrastructure").
 */
function parseParenthetical(description) {
  const text = clean(description);
  const open = text.indexOf('(');
  if (open === -1 || !text.endsWith(')')) {
    return { company: text, role: '', location: '' };
  }
  const company = clean(text.slice(0, open));
  const inner = clean(text.slice(open + 1, -1));
  // "Role, London, United Kingdom" -> role = "Role", location = the rest.
  const parts = inner.split(',').map(part => part.trim()).filter(Boolean);
  if (!parts.length) return { company, role: '', location: '' };
  const looksLikeLocation = value => /\b(?:remote|hybrid|onsite|on-site|united|germany|india|europe|emea|apac|us|usa|uk|canada|berlin|london|bangalore|bengaluru|new york|san francisco|singapore|amsterdam|dublin|paris|tokyo)\b/i.test(value);
  if (parts.length === 1) return { company, role: parts[0], location: '' };
  // Walk from the right while the tail still looks like a location.
  let firstLocation = parts.length;
  while (firstLocation > 1 && looksLikeLocation(parts[firstLocation - 1])) firstLocation--;
  const role = parts.slice(0, firstLocation).join(', ');
  const location = parts.slice(firstLocation).join(', ');
  return { company, role, location };
}

/**
 * Parse one pipeline line.
 *
 * Returns null for lines that are not queue entries at all (headings, prose,
 * table rows). A line WITH a URL always parses, because being unable to read a
 * company is not a reason to hide a job from the queue.
 */
export function parsePipelineLine(line) {
  const checkbox = String(line).match(CHECKBOX_RE);
  const state = checkbox ? stateFor(checkbox[1]) : LINE_STATE.OTHER;
  const body = checkbox ? String(line).slice(checkbox[0].length) : String(line);
  const urlMatch = body.match(URL_RE);
  if (!urlMatch) return null;
  const url = urlMatch[1].replace(/[),.;]+$/, '');
  const remainder = clean(body.slice(body.indexOf(urlMatch[1]) + urlMatch[1].length));
  const entry = { url, state, format: '', company: '', role: '', location: '' };

  if (remainder.startsWith('|')) {
    // Pipe format: url | company | role | location (location optional).
    const fields = remainder.split('|').map(part => clean(part)).filter((part, index, all) => !(index === 0 && !part) && !(index === all.length - 1 && !part));
    entry.format = 'pipe';
    entry.company = fields[0] || '';
    entry.role = fields[1] || '';
    entry.location = fields[2] || '';
    return entry;
  }

  if (/^[—–-]\s*/.test(remainder)) {
    const description = remainder.replace(/^[—–-]\s*/, '');
    // Strip a trailing provenance note: "(…; submitted 2026-01-01)".
    const withoutProvenance = description.replace(/;\s*(?:submitted|expired|skipped)[^)]*\)\s*$/i, ')');
    const parsed = parseParenthetical(withoutProvenance);
    entry.format = 'em-dash';
    entry.company = parsed.company;
    entry.role = parsed.role;
    entry.location = parsed.location;
    return entry;
  }

  // Free text after the URL: treat it as the company/title line.
  entry.format = 'freeform';
  entry.company = remainder.replace(/^[-–—:]\s*/, '');
  return entry;
}

/** Every pending, unblocked target in a pipeline document, deduped by URL. */
export function parsePipelineTargets(source) {
  const targets = [];
  const seen = new Set();
  for (const line of String(source || '').split(/\r?\n/)) {
    const entry = parsePipelineLine(line);
    if (!entry) continue;
    if (entry.state !== LINE_STATE.PENDING) continue;
    const key = normalizeUrl(entry.url) || entry.url;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      name: entry.company || entry.url,
      company: entry.company,
      role: entry.role,
      location: entry.location,
      url: entry.url,
      source: 'pipeline',
    });
  }
  return targets;
}

/** Normalize the `data/last-found-jobs.json` shape into queue targets. */
export function parseFoundJobs(list) {
  if (!Array.isArray(list)) return [];
  const targets = [];
  const seen = new Set();
  for (const job of list) {
    if (!job?.url) continue;
    const key = normalizeUrl(job.url) || job.url;
    if (seen.has(key)) continue;
    seen.add(key);
    const company = clean(job.company || job.name || '');
    targets.push({
      name: company || job.url,
      company,
      role: clean(job.role || job.title || ''),
      location: clean(job.location || ''),
      url: job.url,
      source: 'last-found-jobs',
    });
  }
  return targets;
}

/**
 * Combined queue: discovery output first (it is the freshest), then pending
 * pipeline entries, deduped by normalized URL so a posting that appears in
 * both lists is one target.
 */
export function buildQueue({ found = [], pipeline = '' } = {}) {
  const targets = [];
  const seen = new Set();
  const push = target => {
    const key = normalizeUrl(target.url) || target.url;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push(target);
  };
  for (const target of parseFoundJobs(found)) push(target);
  for (const target of parsePipelineTargets(pipeline)) push(target);
  return targets;
}

/** Read both queue sources from a data root. */
export function readJobQueue(root) {
  let found = [];
  const foundPath = resolve(root, 'data/last-found-jobs.json');
  if (existsSync(foundPath)) {
    try {
      found = JSON.parse(readFileSync(foundPath, 'utf8'));
    } catch {
      found = [];
    }
  }
  const pipelinePath = resolve(root, 'data/pipeline.md');
  const pipeline = existsSync(pipelinePath) ? readFileSync(pipelinePath, 'utf8') : '';
  return buildQueue({ found, pipeline });
}

/** True when the pipeline already records this URL as done. */
export function isPipelineDone(pipelinePath, url) {
  if (!pipelinePath || !existsSync(pipelinePath) || !url) return false;
  const wanted = normalizeUrl(url) || url;
  for (const line of readFileSync(pipelinePath, 'utf8').split(/\r?\n/)) {
    const entry = parsePipelineLine(line);
    if (!entry) continue;
    if ((normalizeUrl(entry.url) || entry.url) !== wanted) continue;
    return entry.state === LINE_STATE.DONE;
  }
  return false;
}

/**
 * Mark a posting done in `data/pipeline.md`.
 *
 * Rewrites the first pending line carrying that URL into `- [x] …`, appending a
 * short provenance suffix. When the URL is not present the caller decides
 * whether to append (pass `appendIfMissing`) — appending a second entry for a
 * URL that is already `- [x]` is exactly the duplicate the old code created.
 *
 * Returns `{ changed, action }` so the caller can log what happened.
 */
export function markPipelineSubmitted(pipelinePath, url, { note = '', appendIfMissing = true } = {}) {
  if (!pipelinePath || !existsSync(pipelinePath) || !url) return { changed: false, action: 'no-file' };
  const wanted = normalizeUrl(url) || url;
  const source = readFileSync(pipelinePath, 'utf8');
  const lines = source.split(/\r?\n/);
  let changed = false;
  let alreadyDone = false;
  const suffix = clean(note);
  for (let i = 0; i < lines.length; i++) {
    const entry = parsePipelineLine(lines[i]);
    if (!entry) continue;
    if ((normalizeUrl(entry.url) || entry.url) !== wanted) continue;
    if (entry.state === LINE_STATE.DONE) { alreadyDone = true; break; }
    if (entry.state !== LINE_STATE.PENDING) continue;
    let done = lines[i]
      .replace(CHECKBOX_RE, match => match.replace('[ ]', '[x]'))
      // A re-run of an already-annotated pending line must not stack notes.
      .replace(/\s*;\s*submitted[^)]*\)\s*$/i, ')');
    // Keep the rewrite simple and readable: append the note in parentheses
    // rather than trying to inject it inside an existing one.
    if (suffix && !/;\s*submitted/i.test(done)) done = `${done.trimEnd()} (submitted ${suffix})`;
    lines[i] = done;
    changed = true;
    break;
  }
  if (!changed) {
    if (alreadyDone) return { changed: false, action: 'already-done' };
    if (!appendIfMissing) return { changed: false, action: 'missing' };
    lines.push(`- [x] ${url}${suffix ? ` (submitted ${suffix})` : ''}`);
    changed = true;
  }
  if (changed) writeFileSync(pipelinePath, lines.join('\n'), 'utf8');
  return { changed: true, action: alreadyDone ? 'already-done' : 'rewritten' };
}
