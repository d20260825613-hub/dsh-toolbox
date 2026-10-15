(() => {
  const inputs = [...document.querySelectorAll('input')].map((i) => ({
    id: i.id,
    name: i.name,
    type: i.type,
    value: i.value,
    visible: !!(i.offsetWidth || i.offsetHeight),
    placeholder: i.placeholder || null,
  }));
  const buttons = [...document.querySelectorAll('button, input[type=submit]')]
    .map((b) => ({ text: (b.textContent || b.value || '').trim(), type: b.type, disabled: b.disabled }))
    .filter((b) => b.text);
  return JSON.stringify(
    {
      url: location.href,
      title: document.title,
      inputs,
      buttons: buttons.slice(0, 10),
      bodyText: document.body ? document.body.innerText.replace(/\s+/g, ' ').slice(0, 260) : null,
    },
    null,
    1,
  );
})();
