(() => {
  const inputs = [...document.querySelectorAll('input')].slice(0, 12).map((i) => ({
    name: i.name,
    type: i.type,
    id: i.id,
    visible: !!(i.offsetWidth || i.offsetHeight),
  }));
  const buttons = [...document.querySelectorAll('button, input[type=submit]')]
    .map((b) => (b.textContent || b.value || '').trim())
    .filter(Boolean)
    .slice(0, 10);
  return JSON.stringify(
    {
      url: location.href,
      title: document.title,
      hasSessionForm: !!document.querySelector('form[action*="/session"]'),
      inputs,
      buttons,
      bodyHead: document.body ? document.body.innerText.slice(0, 300) : null,
    },
    null,
    1,
  );
})();
