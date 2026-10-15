(() => {
  // Read the freshly created classic token and the scopes GitHub reports for it.
  const text = document.body ? document.body.innerText : '';
  const tokenMatch = text.match(/ghp_[A-Za-z0-9]{36,}/);
  const copyBtn = document.querySelector('clipboard-copy[value]');
  const scopes = [...document.querySelectorAll('span,li,a')]
    .map((el) => el.textContent.trim())
    .filter((t) => /^(repo|workflow|gist|admin:|delete_repo)/.test(t))
    .slice(0, 12);
  return JSON.stringify(
    {
      url: location.href,
      tokenFromText: tokenMatch ? tokenMatch[0] : null,
      tokenFromCopyButton: copyBtn ? copyBtn.getAttribute('value') : null,
      scopeHints: [...new Set(scopes)],
      title: document.title,
    },
    null,
    1,
  );
})();
