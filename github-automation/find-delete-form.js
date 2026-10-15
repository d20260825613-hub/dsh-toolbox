(() => {
  const all = [...document.querySelectorAll('button, input[type=submit], summary, a')];
  const dels = all
    .map((el, i) => ({
      i,
      tag: el.tagName,
      text: (el.textContent || el.value || '').trim().slice(0, 40),
      visible: !!(el.offsetWidth || el.offsetHeight),
      action: el.form ? el.form.getAttribute('action') : null,
      method: el.form ? el.form.getAttribute('method') : null,
    }))
    .filter((x) => /删除|delete/i.test(x.text));

  const forms = [...document.querySelectorAll('form')].map((f) => ({
    action: f.getAttribute('action'),
    method: f.getAttribute('method'),
    hidden: [...f.querySelectorAll('input[type=hidden]')].map((h) => h.name),
    hasDeleteControl: [...f.querySelectorAll('button, input')].some((b) =>
      /delete|删除/i.test((b.textContent || b.value || '').trim()),
    ),
    action2: f.getAttribute('action'),
  }));

  return JSON.stringify({ url: location.href, deleteControls: dels, forms }, null, 1);
})();
