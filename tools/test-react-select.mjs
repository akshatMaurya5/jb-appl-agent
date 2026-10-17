#!/usr/bin/env node
/**
 * Quick test: verify the CORRECT way to interact with Greenhouse React-Select.
 * Tests one dropdown, dumps what happened.
 */
import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto('https://job-boards.greenhouse.io/canonical/jobs/5146709', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Test: select "Top 5% at school" for #question_40998748 (math performance)
  const selector = '#question_40998748';
  const searchText = 'Top 5%';

  console.log(`\n--- Testing React-Select for ${selector} with "${searchText}" ---`);

  // Step 1: Click the combobox input
  const input = page.locator(selector).first();
  console.log('Input visible:', await input.isVisible());
  console.log('Input role:', await input.getAttribute('role'));

  // Step 2: Click to open menu
  await input.click();
  await page.waitForTimeout(500);

  // Check if menu opened
  const menuBefore = await page.locator('.select__menu').count();
  console.log('Menu elements visible after click:', menuBefore);

  // Step 3: Type search text
  await page.keyboard.type(searchText);
  await page.waitForTimeout(600);

  // Check options
  const options = await page.locator('.select__option').allInnerTexts();
  console.log('Options after typing:', options);

  // Step 4: Try CLICKING the option (not Enter)
  const matchingOption = page.locator('.select__option').filter({ hasText: searchText }).first();
  const optVisible = await matchingOption.isVisible().catch(() => false);
  console.log('Matching option visible:', optVisible);

  if (optVisible) {
    await matchingOption.click();
    console.log('CLICKED the option element directly');
  } else {
    console.log('Option not visible, trying Enter...');
    await page.keyboard.press('Enter');
  }

  await page.waitForTimeout(500);

  // Step 5: Verify the selection
  // Check the hidden required input
  const hiddenInputs = await page.locator('.remix-css-1a0ro4n-requiredInput').all();
  for (let i = 0; i < hiddenInputs.length; i++) {
    const val = await hiddenInputs[i].getAttribute('aria-invalid');
    if (val) {
      const inputVal = await hiddenInputs[i].inputValue().catch(() => '');
      console.log(`Hidden input [${i}] aria-invalid=${val} value="${inputVal}"`);
    }
  }

  // Check if a select__single-value appeared
  const singleVal = await page.locator(`${selector}`).evaluate(el => {
    const container = el.closest('.select__control')?.parentElement;
    const sv = container?.querySelector('.select__single-value');
    return sv ? sv.innerText : 'NOT FOUND';
  }).catch(() => 'ERROR');
  console.log('Single value text:', singleVal);

  // Also check via the input's aria
  const ariaInvalid = await input.getAttribute('aria-invalid');
  console.log('Input aria-invalid after selection:', ariaInvalid);

  await page.waitForTimeout(2000);
  await browser.close();
}

test().catch(console.error);
