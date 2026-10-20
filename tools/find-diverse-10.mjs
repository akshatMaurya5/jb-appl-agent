import { readFileSync, existsSync } from 'fs';

// Load tracked URLs and company/role pairs
const trackedUrls = new Set();
const trackedPairs = new Set();

if (existsSync('data/applications.md')) {
  const lines = readFileSync('data/applications.md', 'utf8').split('\n');
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length > 4 && parts[1] !== '#' && parts[1] !== '---') {
      const company = parts[3].toLowerCase();
      const role = parts[4].toLowerCase();
      trackedPairs.add(`${company}:::${role}`);
      const urlMatch = line.match(/https?:\/\/[^\s\)\|\"]+/);
      if (urlMatch) trackedUrls.add(urlMatch[0].toLowerCase().replace(/\/$/, ''));
    }
  }
}

if (existsSync('data/pipeline.md')) {
  const text = readFileSync('data/pipeline.md', 'utf8');
  const matches = text.match(/https?:\/\/[^\s\)\|\"]+/g) || [];
  for (const u of matches) trackedUrls.add(u.toLowerCase().replace(/\/$/, ''));
}

if (existsSync('data/scan-history.tsv')) {
  const lines = readFileSync('data/scan-history.tsv', 'utf8').split('\n');
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts[2]) trackedUrls.add(parts[2].toLowerCase().replace(/\/$/, ''));
  }
}

function cleanText(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseExperience(text) {
  const lower = text.toLowerCase();
  
  // Explicit disqualify checks: 6+, 7+, 8+, 10+, 12+ years of experience, or 5-8, 6-8, 7-10 etc.
  const highExpPatterns = [
    /\b([6-9]|1[0-9])\+?\s*(?:to|-|\/)\s*\d+\s*(?:years?|yrs?)/i,
    /\b\d+\s*(?:to|-|\/)\s*([6-9]|1[0-9])\s*(?:years?|yrs?)/i,
    /\b(?:at\s+least|minimum\s+of|min\.?)\s*([6-9]|1[0-9])\s*(?:years?|yrs?)\b/i,
    /\b([6-9]|1[0-9])\+?\s*(?:years?|yrs?)(?:\s+of)?(?:\s+relevant)?(?:\s+professional)?(?:\s+software)?\s*(?:experience|exp)\b/i,
  ];
  for (const pat of highExpPatterns) {
    const m = lower.match(pat);
    if (m) {
      return { status: 'disqualified', reason: `Requires >5 YOE: "${m[0]}"` };
    }
  }

  // Look for target 1-5 YOE patterns
  const validExpPatterns = [
    /\b([1-5])\s*(?:to|-)\s*([2-5])\s*(?:years?|yrs?)(?:\s+of)?(?:\s+relevant)?(?:\s+professional)?(?:\s+software)?\s*(?:experience|exp)\b/i,
    /\b([1-5])\+?\s*(?:years?|yrs?)(?:\s+of)?(?:\s+relevant)?(?:\s+professional)?(?:\s+software)?\s*(?:experience|exp)\b/i,
    /\b(?:at\s+least|minimum\s+of|min\.?)\s*([1-5])\s*(?:years?|yrs?)\b/i,
  ];
  for (const pat of validExpPatterns) {
    const m = lower.match(pat);
    if (m) {
      return { status: 'matched', exp: m[0] };
    }
  }

  return { status: 'unspecified' };
}

function checkRoleRelevance(title) {
  const t = title.toLowerCase();
  
  // Disqualify staff, principal, lead, director, vp, manager, intern, student
  if (/\b(staff|principal|director|vp|vice president|chief|head of|manager|lead|intern|internship|co-op|graduate|student)\b/i.test(t)) {
    return false;
  }

  // Qualifying patterns
  const patterns = [
    /\bsoftware\s+engineer\b/i,
    /\bbackend\b/i,
    /\bback-end\b/i,
    /\bsoftware\s+developer\b/i,
    /\bsde\b/i,
    /\bswe\b/i,
    /\bdistributed\s+systems\b/i,
    /\bplatform\s+engineer\b/i,
    /\binfrastructure\s+engineer\b/i,
    /\bcloud\s+engineer\b/i,
    /\bsre\b/i,
    /\bsite\s+reliability\b/i,
    /\bjava\b/i,
    /\bgolang\b/i,
    /\bgo\s+engineer\b/i,
    /\bsystems\s+engineer\b/i,
    /\bdata\s+platform\b/i,
    /\bdata\s+engineer\b/i,
  ];

  return patterns.some(p => p.test(t));
}

async function checkBoard(boardName, companyName, options = {}) {
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${boardName}/jobs?content=true`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) return [];
    const data = await res.json();
    const jobs = data.jobs || [];
    const matched = [];

    for (const job of jobs) {
      const url = (job.absolute_url || `https://job-boards.greenhouse.io/${boardName}/jobs/${job.id}`).toLowerCase().replace(/\/$/, '');
      if (trackedUrls.has(url)) continue;

      const title = job.title || '';
      const pairKey = `${companyName.toLowerCase()}:::${title.toLowerCase()}`;
      if (trackedPairs.has(pairKey)) continue;

      if (!checkRoleRelevance(title)) continue;

      const text = cleanText(job.content);
      const expCheck = parseExperience(text);
      if (expCheck.status === 'disqualified') continue;

      const locName = job.location?.name || '';
      const lowerLoc = locName.toLowerCase();
      const lowerText = text.toLowerCase();

      // Exclude India onsite
      if (lowerLoc.includes('india') && !lowerLoc.includes('remote')) continue;

      // Disqualify explicit US-only / security clearance / no sponsorship
      if (/\b(us citizenship required|active secret clearance|top secret|must be a us citizen|authorized to work in the us without sponsorship|cannot sponsor|will not sponsor|unable to sponsor)\b/i.test(lowerText)) {
        continue;
      }

      let isEligible = false;
      let locType = '';

      // 1. Worldwide remote
      if (
        /\b(worldwide|anywhere in the world|global|work from anywhere|all countries)\b/i.test(lowerLoc) ||
        (/\bremote\b/i.test(lowerLoc) && /\b(worldwide|global remote|work from anywhere|anywhere in the world)\b/i.test(lowerText))
      ) {
        isEligible = true;
        locType = 'Worldwide Remote';
      }
      // 2. Visa sponsorship / Relocation offered in Europe, UK, Singapore, Japan, UAE, etc.
      else if (
        /\b(visa\s+sponsorship(?:\s+is)?\s+(?:available|provided|offered|supported)|relocation\s+(?:assistance|package|provided|support)|will\s+sponsor\s+(?:work\s+)?visas?|sponsorship\s+is\s+provided|relocation\s+support\s+is\s+available)\b/i.test(lowerText) ||
        /\b(relocation\s+provided|visa\s+sponsorship)\b/i.test(lowerLoc)
      ) {
        isEligible = true;
        locType = 'International Onsite with Sponsorship/Relocation';
      }
      // 3. Known global remote company (Canonical, GitLab) where location allows APAC/EMEA/Worldwide
      else if (options.isGlobalRemote) {
        if (
          lowerLoc.includes('worldwide') ||
          lowerLoc.includes('apac') ||
          lowerLoc.includes('emea') ||
          lowerLoc.includes('remote') ||
          lowerLoc.includes('home based')
        ) {
          isEligible = true;
          locType = 'Global Remote Company';
        }
      }

      if (!isEligible) continue;

      matched.push({
        company: companyName,
        board: boardName,
        id: job.id,
        title,
        url: job.absolute_url || `https://job-boards.greenhouse.io/${boardName}/jobs/${job.id}`,
        location: locName,
        locationType: locType,
        experience: expCheck.status === 'matched' ? expCheck.exp : '1-5 YOE (mid-level)',
        textSummary: text.slice(0, 180) + '...'
      });
    }

    return matched;
  } catch (e) {
    return [];
  }
}

async function main() {
  const targets = [
    { board: 'canonical', name: 'Canonical', options: { isGlobalRemote: true } },
    { board: 'gitlab', name: 'GitLab', options: { isGlobalRemote: true } },
    { board: 'adyen', name: 'Adyen' },
    { board: 'getyourguide', name: 'GetYourGuide' },
    { board: 'deliveroo', name: 'Deliveroo' },
    { board: 'agoda', name: 'Agoda' },
    { board: 'monzo', name: 'Monzo' },
    { board: 'n26', name: 'N26' },
    { board: 'celonis', name: 'Celonis' },
    { board: 'speechmatics', name: 'Speechmatics' },
    { board: 'parloa', name: 'Parloa' },
    { board: 'contentful', name: 'Contentful' },
    { board: 'grafanalabs', name: 'Grafana Labs' },
    { board: 'elastic', name: 'Elastic' },
    { board: 'okx', name: 'OKX', options: { isGlobalRemote: true } },
  ];

  console.log(`Checking ${targets.length} targets...`);
  const allResults = [];
  for (const t of targets) {
    const res = await checkBoard(t.board, t.name, t.options || {});
    console.log(`${t.name}: ${res.length} valid matches`);
    allResults.push(...res);
  }

  console.log(`\nFound ${allResults.length} total qualified roles.`);
  for (let i = 0; i < allResults.length; i++) {
    const j = allResults[i];
    console.log(`[${i + 1}] ${j.company} — ${j.title}`);
    console.log(`    Location: ${j.location} (${j.locationType})`);
    console.log(`    Experience: ${j.experience}`);
    console.log(`    URL: ${j.url}\n`);
  }
}

main();
