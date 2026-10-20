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

console.log(`Loaded ${trackedUrls.size} tracked URLs and ${trackedPairs.size} tracked pairs.`);

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

function checkLocationPolicy(locStr, text) {
  const loc = (locStr || '').toLowerCase();
  const lowerText = text.toLowerCase();

  // Exclude India onsite/hybrid
  if (/\bindia\b/i.test(loc) && !loc.includes('remote')) {
    return { eligible: false, reason: 'India onsite' };
  }

  // Country-specific remote exclusions (e.g. US only, Canada only)
  // If the location specifies a specific country like "US | Remote" or "Canada (Remote)" or "United States"
  // without explicitly stating global/worldwide remote in the JD text
  const isCountryRestrictedRemote = (
    /\b(united states|usa|us|canada|mexico|brazil|latam|emea|germany|spain|uk|ireland|australia)\s*(?:\(remote\)|remote|\|\s*remote)\b/i.test(loc) ||
    /\b(remote\s*-\s*(?:us|usa|canada|uk|germany|spain|france|ireland))\b/i.test(loc)
  );

  // Check if text restricts to US/Canada residency/authorization
  const countryRestrictedText = /\b(must be (?:located|based|resident) in the (?:us|united states|canada)|authorized to work in the (?:us|united states) without (?:visa )?sponsorship|us citizenship required|security clearance)\b/i.test(lowerText);
  if (countryRestrictedText) {
    return { eligible: false, reason: 'Country restricted residency/authorization' };
  }

  // Genuine Worldwide / Global remote check
  const isWorldwideRemote = (
    /\b(worldwide|anywhere|global|all countries|work from anywhere|anywhere in the world)\b/i.test(loc) ||
    (/\bremote\b/i.test(loc) && /\b(worldwide|global remote|work from anywhere|anywhere in the world)\b/i.test(lowerText))
  );

  // Check visa sponsorship or relocation explicitly offered
  const offersSponsorship = (
    /\b(visa\s+sponsorship(?:\s+is)?\s+(?:available|provided|offered)|relocation\s+(?:assistance|package|provided|support)|will\s+sponsor\s+(?:work\s+)?visas?|sponsorship\s+is\s+provided|relocation\s+support\s+is\s+available)\b/i.test(lowerText) ||
    /\b(relocation\s+provided|visa\s+sponsorship)\b/i.test(loc)
  );

  // Explicit no-sponsorship disqualifier
  if (/\b(cannot sponsor|will not sponsor|do not offer (?:visa )?sponsorship|unable to sponsor|no visa sponsorship)\b/i.test(lowerText)) {
    if (!isWorldwideRemote) {
      return { eligible: false, reason: 'No visa sponsorship' };
    }
  }

  if (isWorldwideRemote) {
    return { eligible: true, type: 'Worldwide Remote' };
  }

  if (offersSponsorship) {
    return { eligible: true, type: 'International Onsite/Hybrid with Sponsorship' };
  }

  // If company is known remote-first with global hiring (e.g. Canonical, GitLab, Automattic, etc.)
  if (loc.includes('home based') || loc.includes('remote') || loc.includes('anywhere')) {
    if (/\b(canonical|gitlab|kraken|duckduckgo|wikimedia)\b/i.test(lowerText)) {
      return { eligible: true, type: 'Global Remote Company' };
    }
  }

  return { eligible: false, reason: 'Does not match location/remote/visa criteria' };
}

async function scanBoard(boardName, companyName) {
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
      const locCheck = checkLocationPolicy(locName, text);
      if (!locCheck.eligible) continue;

      matched.push({
        company: companyName,
        board: boardName,
        id: job.id,
        title,
        url: job.absolute_url || `https://job-boards.greenhouse.io/${boardName}/jobs/${job.id}`,
        location: locName,
        locationType: locCheck.type,
        experience: expCheck.status === 'matched' ? expCheck.exp : '1-5 YOE (unspecified mid-level)',
        textSnippet: text.slice(0, 300)
      });
    }

    return matched;
  } catch (e) {
    return [];
  }
}

async function run() {
  const boards = [
    { board: 'elastic', name: 'Elastic' },
    { board: 'grafanalabs', name: 'Grafana Labs' },
    { board: 'cockroachlabs', name: 'Cockroach Labs' },
    { board: 'canonical', name: 'Canonical' },
    { board: 'adyen', name: 'Adyen' },
    { board: 'deliveroo', name: 'Deliveroo' },
    { board: 'getyourguide', name: 'GetYourGuide' },
    { board: 'contentful', name: 'Contentful' },
    { board: 'celonis', name: 'Celonis' },
    { board: 'monzo', name: 'Monzo' },
    { board: 'okx', name: 'OKX' },
    { board: 'speechmatics', name: 'Speechmatics' },
    { board: 'parloa', name: 'Parloa' },
    { board: 'n26', name: 'N26' },
    { board: 'lyft', name: 'Lyft' },
    { board: 'stripe', name: 'Stripe' },
    { board: 'datadog', name: 'Datadog' },
    { board: 'cloudflare', name: 'Cloudflare' },
    { board: 'gitlab', name: 'GitLab' },
    { board: 'instacart', name: 'Instacart' },
    { board: 'affirm', name: 'Affirm' },
    { board: 'brex', name: 'Brex' },
    { board: 'checkr', name: 'Checkr' },
    { board: 'figma', name: 'Figma' },
    { board: 'databricks', name: 'Databricks' },
    { board: 'flexport', name: 'Flexport' },
    { board: 'chime', name: 'Chime' },
    { board: 'gusto', name: 'Gusto' },
    { board: 'robinhood', name: 'Robinhood' },
    { board: 'reddit', name: 'Reddit' },
    { board: 'mongodb', name: 'MongoDB' },
    { board: 'mattermost', name: 'Mattermost' },
    { board: 'launchdarkly', name: 'LaunchDarkly' },
    { board: 'pagerduty', name: 'PagerDuty' },
    { board: 'braze', name: 'Braze' },
  ];

  console.log(`Scanning ${boards.length} boards...`);
  const allMatches = [];
  for (const b of boards) {
    const matches = await scanBoard(b.board, b.name);
    if (matches.length > 0) {
      console.log(`Found ${matches.length} matching jobs at ${b.name}`);
      allMatches.push(...matches);
    }
  }

  console.log(`\nTotal candidate matches found: ${allMatches.length}`);
  console.log(JSON.stringify(allMatches.slice(0, 15), null, 2));
}

run();
