import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  console.log('Navigating to Canonical #5146709...');
  await page.goto('https://job-boards.greenhouse.io/canonical/jobs/5146709', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Inspect form fields
  const fields = await page.evaluate(() => {
    const list = [];
    document.querySelectorAll('form input, form textarea, form select, form [class*="select__control"]').forEach(el => {
      const parent = el.closest('.field') || el.closest('.form-field') || el.closest('label') || el.parentElement;
      const label = parent ? parent.innerText.split('\n')[0] : '';
      list.push({
        tag: el.tagName,
        id: el.id,
        name: el.name,
        type: el.type,
        role: el.getAttribute('role'),
        label: label.slice(0, 50),
        className: el.className,
      });
    });
    return list;
  });

  console.log(`Found ${fields.length} form elements.`);
  console.log(JSON.stringify(fields.slice(30), null, 2));

  await browser.close();
}

main().catch(console.error);
