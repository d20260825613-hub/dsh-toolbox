(() => {
  const controls = [...document.querySelectorAll('button, a, input[type=submit]')]
    .map((el) => ({
      tag: el.tagName,
      text: (el.textContent || el.value || '').trim().slice(0, 60),
      href: el.getAttribute && el.getAttribute('href') ? el.getAttribute('href').slice(0, 60) : null,
      visible: !!(el.offsetWidth || el.offsetHeight),
      type: el.type || null,
    }))
    .filter((c) => c.text || c.href);

  // Prefer a control that names the account, else the first visible submit.
  const target =
    [...document.querySelectorAll('button, a, input[type=submit]')].find(
      (el) => /d20260825613-hub/i.test((el.textContent || el.value || '').trim()) && (el.offsetWidth || el.offsetHeight),
    ) ??
    [...document.querySelectorAll('button[type=submit], input[type=submit]')].find((el) => el.offsetWidth || el.offsetHeight);

  const info = { url: location.href, controls: controls.slice(0, 12), clicked: null };
  if (target) {
    info.clicked = (target.textContent || target.value || '').trim().slice(0, 40);
    target.click();
  }
  return JSON.stringify(info, null, 1);
})();
