(() => {
  // The delete control is a <details><summary>结删</summary>…</details>; open it,
  // then submit the confirmation button inside its form.
  const summary = [...document.querySelectorAll('summary')].find((s) =>
    /删除|delete/i.test((s.textContent || '').trim()),
  );
  const out = { url: location.href, summaryFound: !!summary, opened: false, submitted: null };

  if (summary) {
    summary.click();
    out.opened = true;
  }

  const confirm = [...document.querySelectorAll('button, input[type=submit]')].find((b) =>
    /i understand|delete this token/i.test((b.textContent || b.value || '').trim()),
  );
  out.confirmVisible = confirm ? !!(confirm.offsetWidth || confirm.offsetHeight) : false;
  out.confirmDisabled = confirm ? !!confirm.disabled : null;

  if (confirm) {
    confirm.click();
    out.submitted = (confirm.textContent || confirm.value || '').trim();
  }
  return JSON.stringify(out, null, 1);
})();
