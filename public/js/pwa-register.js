(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => {});
  }

  let installPrompt;
  const button = document.querySelector('[data-install-app]');
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    if (button) button.hidden = false;
  });

  button?.addEventListener('click', async () => {
    if (!installPrompt) return;
    button.disabled = true;
    try {
      await installPrompt.prompt();
      await installPrompt.userChoice;
    } catch {
      // The browser may dismiss the install prompt or disallow it on this device.
    } finally {
      installPrompt = null;
      button.hidden = true;
      button.disabled = false;
    }
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    if (button) button.hidden = true;
  });
})();
