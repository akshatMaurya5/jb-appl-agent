import { chromium } from 'playwright';

async function dumpOptions() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Loading Canonical #5146709...');
  await page.goto('https://job-boards.greenhouse.io/canonical/jobs/5146709', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const questionIds = [
    '#question_40998748',
    '#question_40998749',
    '#question_42808640',
    '#question_40998751',
    '#question_48921430',
    '#question_41964734',
    '#question_40998754',
    '#question_55383216',
    '[id*="65067561"]',
    '#question_65067576',
  ];

  for (const qId of questionIds) {
    try {
      const el = page.locator(qId).first();
      await el.click();
      await page.waitForTimeout(400);

      const options = await page.evaluate(() => {
        const items = [];
        document.querySelectorAll('[id*="-option-"], .select__option, [role="option"]').forEach(o => {
          items.push(o.innerText.trim());
        });
        return items;
      });

      console.log(`\n=== Options for ${qId} ===`);
      console.log(options.slice(0, 15));

      // Close menu by pressing Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    } catch (e) {
      console.log(`Error on ${qId}:`, e.message);
    }
  }

  await browser.close();
}

dumpOptions().catch(console.error);
