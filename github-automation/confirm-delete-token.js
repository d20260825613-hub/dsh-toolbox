(() => {
  // Confirm the classic-token deletion dialog and click its submit button.
  const all = [...document.querySelectorAll('button, input[type=submit]')];
  const confirm = all.find((b) => /i understand|delete this token|我理解|删除/i.test((b.textContent || b.value || '').trim()));
  const info = {
    url: location.href,
    title: document.title,
    bodyHead: document.body ? document.body.innerText.replace(/\s+/g, ' ').slice(0, 200) : null,
    buttonFound: confirm ? (confirm.textContent || confirm.value).trim() : null,
    clicked: false,
  };
  if (confirm) {
    confirm.click();
    info.clicked = true;
  }
  return JSON.stringify(info, null, 1);
})();
