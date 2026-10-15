(() => {
  // Fill GitHub's device activation form with the one-time code and submit.
  // The page splits the code across inputs (or uses a single one), so handle both.
  const code = 'D10792BF';
  const visibleInputs = [...document.querySelectorAll('input')].filter(
    (i) => i.offsetWidth || i.offsetHeight,
  );

  const info = { url: location.href, visibleInputs: visibleInputs.length, strategy: null, filled: [], clicked: null };

  if (visibleInputs.length === 0) {
    info.strategy = 'no-input';
    return JSON.stringify(info, null, 1);
  }

  if (visibleInputs.length >= 8) {
    // one input per character
    info.strategy = 'per-character';
    for (let i = 0; i < visibleInputs.length && i < code.length; i += 1) {
      const input = visibleInputs[i];
      input.focus();
      input.value = code[i];
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      info.filled.push(input.value);
    }
  } else {
    info.strategy = 'single-field';
    const input = visibleInputs[0];
    input.focus();
    input.value = code;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    info.filled.push(input.value);
  }

  const submit = [...document.querySelectorAll('button, input[type=submit]')].find((b) =>
    /continue|submit|continue|继续|授权|authorize/i.test((b.textContent || b.value || '').trim()),
  );
  if (submit) {
    info.clicked = (submit.textContent || submit.value).trim();
    submit.click();
  } else {
    info.strategy += '+no-submit';
  }
  return JSON.stringify(info, null, 1);
})();
