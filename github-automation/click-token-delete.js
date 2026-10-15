(() => {
  // Collect every clickable control with its text, then click the Delete one
  // that belongs to the "spacehog push" row.
  const controls = [...document.querySelectorAll('button, input[type=submit], summary, a')].map((el, index) => ({
    index,
    tag: el.tagName,
    type: el.type || null,
    text: (el.textContent || el.value || '').trim().slice(0, 40),
    visible: !!(el.offsetWidth || el.offsetHeight),
    href: el.getAttribute && el.getAttribute('href') ? el.getAttribute('href').slice(0, 60) : null,
  }));

  const deleteButtons = controls.filter((c) => /delete|删除/i.test(c.text));
  const info = {
    url: location.href,
    totalControls: controls.length,
    deleteButtons,
    visibleTail: controls.filter((c) => c.visible && c.text).slice(0, 12),
  };

  // Focus the real button and click it.
  const all = [...document.querySelectorAll('button, input[type=submit], summary, a')];
  const target = all.find((el) => /delete|删除/i.test((el.textContent || el.value || '').trim()));
  if (target) {
    info.clicked = (target.textContent || target.value || '').trim();
    target.click();
  } else {
    info.clicked = null;
  }
  return JSON.stringify(info, null, 1);
})();
