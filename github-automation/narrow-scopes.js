(() => {
  const boxes = [...document.querySelectorAll('input[name="oauth_access[scopes][]"]')];
  const desc = document.querySelector('#oauth_access_description');

  // Keep the token as narrow as possible: only the umbrella `repo` scope.
  let unchecked = 0;
  for (const box of boxes) {
    const keep = box.value === 'repo';
    if (box.checked !== keep) {
      box.click();
      unchecked += 1;
    }
  }

  if (desc) {
    desc.value = 'spacehog push';
    desc.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const checkedNow = boxes.filter((b) => b.checked).map((b) => b.value);
  return JSON.stringify(
    {
      toggled: unchecked,
      stillChecked: checkedNow,
      description: desc ? desc.value : null,
    },
    null,
    1,
  );
})();
