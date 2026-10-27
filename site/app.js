const copyButton = document.querySelector('[data-copy]');

copyButton?.addEventListener('click', async () => {
  const source = document.getElementById(copyButton.dataset.copy);
  if (!source) return;

  try {
    await navigator.clipboard.writeText(source.innerText);
    copyButton.textContent = 'Copied';
    window.setTimeout(() => { copyButton.textContent = 'Copy'; }, 1600);
  } catch {
    copyButton.textContent = 'Select code';
  }
});
