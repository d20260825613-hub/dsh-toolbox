(() => {
  const boxes = [...document.querySelectorAll('input[name="oauth_access[scopes][]"]')];
  const desc = document.querySelector('#oauth_access_description');
  const info = {
    descValue: desc ? desc.value : null,
    scopes: boxes.map((b) => ({
      id: b.id,
      value: b.value,
      checked: b.checked,
      label: (document.querySelector('label[for="' + b.id + '"]') || {}).textContent?.trim().slice(0, 60) || null,
    })),
  };
  // Fill the description and tick the `repo` scope (offline token for the CLI).
  if (desc && !desc.value) {
    desc.value = 'spacehog push';
    desc.dispatchEvent(new Event('input', { bubbles: true }));
    desc.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const repoBox = boxes.find((b) => b.value === 'repo');
  if (repoBox) {
    if (!repoBox.checked) repoBox.click();
    info.repoCheckedAfterClick = repoBox.checked;
  }
  info.descValueAfter = desc ? desc.value : null;
  info.foundRepoBox = !!repoBox;
  return JSON.stringify(info, null, 1);
})();
