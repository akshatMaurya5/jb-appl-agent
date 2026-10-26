// education-facts.mjs — parse the candidate's education from cv.md's
// Education section. config/profile.yml → candidate.education wins over the
// parsed values (the engine checks the profile first and only calls this as a
// fallback), so hand-maintained profile facts are never silently shadowed by
// CV formatting.
//
// Expected cv.md shape (see examples/cv-example.md):
//   ## Education
//   ### University Name -- City, Country
//   **B.Tech, Electronics & Communication Engineering**
//   2020 – 2024

const SECTION = /^##\s+Education\s*$/im;
const ENTRY = /^###\s+(.+)$/gm;
const BOLD = /\*\*([^*\n]+)\*\*/;
const YEARS = /(\d{4})\s*[–—-]\s*(\d{4})/;

export function educationFacts(cv = '') {
  const text = String(cv || '');
  const sectionStart = text.search(SECTION);
  if (sectionStart < 0) return {};
  const section = text.slice(sectionStart);
  const nextSection = section.match(/^##\s+[^E]/m)?.index ?? section.length;
  const body = section.slice(0, nextSection);

  const entry = body.match(ENTRY);
  const facts = {};
  if (entry) {
    const heading = entry[1].trim();
    const parts = heading.split(/\s+[–—-]\s+/);
    facts.university = (parts[0] || heading).trim();
    if (parts[1]) {
      const [city, country] = parts[1].split(/\s*,\s*/).map(part => part.trim());
      if (city) facts.city = city;
      if (country) facts.country = country;
    }
  }
  const bold = body.match(BOLD);
  if (bold) {
    const [degree, major] = bold[1].split(/\s*,\s*/).map(part => part.trim());
    if (degree) facts.degree = degree;
    if (major) facts.major = major;
  }
  const years = body.match(YEARS);
  if (years) {
    facts.start_year = Number(years[1]);
    facts.end_year = Number(years[2]);
  }
  return facts;
}
