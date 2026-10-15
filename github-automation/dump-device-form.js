(() => {
  const form = document.querySelector('form');
  const inputs = [...document.querySelectorAll('input')].map((i) => ({
    id: i.id,
    name: i.name,
    type: i.type,
    maxlength: i.maxLength,
    visible: !!(i.offsetWidth || i.offsetHeight),
    value: i.value,
  }));
  // The separator element between the two halves of the code is often a plain
  // span; capture what sits between the inputs so the layout is unambiguous.
  const wrap = document.querySelector('form') || document.body;
  const between = wrap ? wrap.innerHTML.replace(/\s+/g, ' ').slice(0, 1200) : null;
  return JSON.stringify({ url: location.href, inputs, formAction: form ? form.getAttribute('action') : null, between }, null, 1);
})();
