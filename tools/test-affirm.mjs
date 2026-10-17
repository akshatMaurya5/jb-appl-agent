import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://job-boards.greenhouse.io/affirm/jobs/8006329003', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const fields = await page.evaluate(() => {
    const res = [];
    document.querySelectorAll('.field, .form-field').forEach(f => {
      const label = f.innerText.split('\n')[0].trim();
      const input = f.querySelector('input, select, textarea');
      const isSelect = !!f.querySelector('.select__control, select');
      res.push({ label, isSelect, id: input?.id, name: input?.name });
    });
    return res;
  });

  console.log('Affirm Form Fields:', JSON.stringify(fields, null, 2));

  // Now click each combobox and get its options
  const combos = page.locator('[role="combobox"], input[class*="select__input"]');
  const count = await combos.count();
  for (let i = 0; i < count; i++) {
    const c = combos.nth(i);
    const parent = await c.evaluate(el => el.closest('.field, .form-field')?.innerText.split('\n')[0] || '');
    await c.click().catch(() => {});
    await page.waitForTimeout(400);
    const opts = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.select__option, [role="option"]')).map(o => o.innerText.trim());
    });
    console.log(`\nDropdown [${parent}]:`, opts.slice(0, 10));
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(200);
  }

  await browser.close();
}

main().catch(console.error);
