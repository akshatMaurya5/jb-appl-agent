import { chromium } from 'playwright';
import { existsSync } from 'fs';

async function testSubmit() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  console.log('1. Navigating to Canonical #5146709...');
  await page.goto('https://job-boards.greenhouse.io/canonical/jobs/5146709', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  console.log('2. Filling standard fields...');
  await page.locator('input#first_name').fill('Akshat');
  await page.locator('input#last_name').fill('Maurya');
  await page.locator('input#email').fill('mauryaakshat5@gmail.com');

  // Country
  console.log('3. Selecting Country (India)...');
  try {
    await page.locator('input#country').click();
    await page.waitForTimeout(300);
    await page.keyboard.type('India');
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
  } catch (e) {
    console.log('Country err:', e.message);
  }

  // Phone
  console.log('4. Filling Phone...');
  await page.locator('input#phone').fill('+91-7889021799');

  // Resume
  const pdfPath = '/Users/akshatmaurya/Desktop/CVS STUFF/Akshat Maurya-Resume.pdf';
  if (existsSync(pdfPath)) {
    console.log('5. Attaching master resume...');
    await page.locator('input#resume').setInputFiles(pdfPath);
  }

  // School, Degree, Discipline
  console.log('6. Selecting School, Degree, Discipline...');
  async function selectOption(selector, text) {
    try {
      const el = page.locator(selector).first();
      await el.click();
      await page.waitForTimeout(300);
      await page.keyboard.type(text);
      await page.waitForTimeout(400);
      await page.keyboard.press('Enter');
      console.log(`  ✔ Selected "${text}" for ${selector}`);
    } catch (e) {
      console.log(`  ✖ Failed ${selector}: ${e.message}`);
    }
  }

  await selectOption('#school--0', 'Dr. B.R. Ambedkar');
  await selectOption('#degree--0', 'Bachelor');
  await selectOption('#discipline--0', 'Engineering');

  // Math & Language performance
  console.log('7. Selecting Math & Language...');
  await selectOption('#question_40998748', 'Top 5%');
  await selectOption('#question_40998749', 'Top 5%');

  // Textarea essays
  console.log('8. Filling text essays...');
  await page.locator('textarea#question_40998750').fill('Top 1 percentile in competitive national engineering entrance examinations (JEE). Achieved LeetCode Knight ranking (1980+ contest rating, 1600+ algorithmic problems solved, top ~5% globally) and Codeforces Specialist ranking.');
  await page.locator('textarea#question_40998747').fill('Graduated B.Tech in Electronics and Communication Engineering from Dr. B.R. Ambedkar National Institute of Technology, Jalandhar (NIT Jalandhar) in 2024 with First Class distinction.');

  await selectOption('#question_42808640', 'Yes');
  await selectOption('#question_40998751', 'Yes');

  await page.locator('textarea#question_40999215').fill('At Storefox AI, I engineered backend microservices in Go, building high-concurrency event-driven notification pipelines that dispatched push alerts via Firebase Cloud Messaging to 50k+ active users with sub-second latency. I also developed sales-rep audit-trail services and integrated PostHog analytics tracking 10+ core operational KPIs, ensuring clean multi-tenant data isolation across SQL and MongoDB stores.');
  await page.locator('textarea#question_40999216').fill('At Visa Inc., I built an in-process JVM profiler using ByteBuddy bytecode manipulation to capture per-method execution spans and thread contention without manual instrumentation. When time-series storage bottlenecks capped throughput, I re-architected the storage layer around OpenHFT Chronicle Queue off-heap memory-mapped ring buffers, boosting sustained write throughput ~10x (~100K to ~1M events/sec) with zero garbage-collection overhead.');

  // LinkedIn (Notice: skip website unless mandatory)
  await page.locator('input#question_40998753').fill('https://linkedin.com/in/akshatMaurya5');

  // Work auth, notice, etc.
  console.log('9. Selecting work auth, notice, demographics...');
  await selectOption('#question_48921430', '2');
  await selectOption('#question_41964734', 'India');
  await selectOption('#question_40998754', 'Acknowledge/Confirm');
  await selectOption('#question_55383216', 'Male');
  await selectOption('[id*="65067561"]', 'Indian');
  await selectOption('#question_65067576', 'Asian');

  // EEO Demographics
  await selectOption('#gender', 'Male');
  await selectOption('#hispanic_ethnicity', 'No');
  await selectOption('#veteran_status', 'not a protected veteran');
  await selectOption('#disability_status', 'No');

  console.log('10. Checking for any unfilled required fields...');
  const unfilled = await page.evaluate(() => {
    const list = [];
    document.querySelectorAll('.remix-css-1a0ro4n-requiredInput').forEach(inp => {
      const container = inp.closest('.select__control') || inp.parentElement;
      const text = container ? container.innerText : '';
      if (text.includes('Select...')) {
        const parent = inp.closest('.field') || inp.closest('.form-field') || inp.parentElement;
        list.push(parent ? parent.innerText.split('\n')[0] : 'Unknown select');
      }
    });
    return list;
  });
  console.log('Unfilled selects:', unfilled);

  console.log('11. Clicking Submit Application...');
  const submitBtn = page.locator('button#submit_app, button[type="submit"]').first();
  await submitBtn.click();
  await page.waitForTimeout(5000);

  console.log('12. Current page URL:', page.url());
  const bodyText = await page.innerText('body');
  if (page.url().includes('confirmation') || bodyText.toLowerCase().includes('thank you for applying') || bodyText.toLowerCase().includes('application submitted')) {
    console.log('🎉🎉🎉 APPLICATION SUBMITTED SUCCESSFULLY! 🎉🎉🎉');
  } else {
    // Check validation errors
    const errors = await page.evaluate(() => {
      const details = [];
      document.querySelectorAll('[aria-invalid="true"]').forEach(el => {
        const parent = el.closest('.field') || el.closest('.form-field') || el.parentElement;
        details.push({
          id: el.id,
          name: el.name,
          value: el.value,
          parentText: parent ? parent.innerText : '',
        });
      });
      return details;
    });
    console.log('Detailed errors on page:', JSON.stringify(errors, null, 2));
  }

  await page.waitForTimeout(3000);
  await browser.close();
}

testSubmit().catch(console.error);
