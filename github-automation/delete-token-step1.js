(() => {
  // The freshly created token is on the classic-token settings page. Find its
  // row by description ("spacehog push") and click its Delete button.
  const rows = [...document.querySelectorAll('li, div')].filter((el) => {
    const text = el.textContent || '';
    return text.includes('spacehog push') && /ghp_/.test(text);
  });
  const summary = rows.slice(0, 3).map((el) => el.textContent.replace(/\s+/g, ' ').trim().slice(0, 160));

  const target = rows.find((el) => el.querySelector('button, input[type=submit], a[href*="delete"]'));
  let clicked = false;
  let label = null;
  if (target) {
    const button = [...target.querySelectorAll('button, input[type=submit], a')].find((b) =>
      /delete|删除/i.test((b.textContent || b.value || '').trim()),
    );
    if (button) {
      label = (button.textContent || button.value || '').trim();
      button.click();
      clicked = true;
    }
  }

  return JSON.stringify(
    {
      url: location.href,
      matchingRows: rows.length,
      summary,
      clicked,
      label,
      allButtons: [...document.querySelectorAll('button, input[type=submit]')]
        .map((b) => (b.textContent || b.value || '').trim())
        .filter(Boolean)
        .slice(0, 12),
    },
    null,
    1,
  );
})();
