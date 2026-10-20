async function readInputs(inputs) {
  return Promise.all(inputs.map(input => input.inputValue().catch(() => '')));
}

async function clearInputs(inputs) {
  for (const input of inputs) {
    await input.fill('').catch(() => {});
  }
}

export async function enterVerificationCode(inputs, code) {
  const value = String(code || '').trim();
  if (!value || !inputs.length) return false;
  if (inputs.length > 1 && inputs.length !== value.length) return false;

  if (inputs.length === 1) {
    const input = inputs[0];
    await input.fill(value).catch(() => {});
    if ((await readInputs(inputs)).join('') === value) return true;
    await input.click().catch(() => {});
    await input.pressSequentially(value, { delay: 35 }).catch(() => {});
    return (await readInputs(inputs)).join('') === value;
  }

  // Some OTP widgets distribute a full code typed in the first box; others
  // require a keyboard event in each box. Try both strategies and verify all
  // box values after each, since a successful Playwright call is not proof.
  await clearInputs(inputs);
  await inputs[0].click().catch(() => {});
  await inputs[0].pressSequentially(value, { delay: 35 }).catch(() => {});
  if ((await readInputs(inputs)).join('') === value) return true;

  await clearInputs(inputs);
  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index];
    await input.click().catch(() => {});
    await input.fill(value[index]).catch(() => {});
    if ((await input.inputValue().catch(() => '')) !== value[index]) {
      await input.pressSequentially(value[index], { delay: 35 }).catch(() => {});
    }
  }
  return (await readInputs(inputs)).join('') === value;
}
