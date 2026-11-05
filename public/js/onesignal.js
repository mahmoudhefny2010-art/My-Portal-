(() => {
  const appId = document.body.dataset.onesignalAppId;
  const userId = document.body.dataset.onesignalUserId;
  if (!appId || !userId) return;

  const status = document.querySelector('[data-onesignal-status]');
  const toggle = document.querySelector('[data-onesignal-toggle]');
  const testButton = document.querySelector('[data-onesignal-test]');
  const testStatus = document.querySelector('[data-onesignal-test-status]');
  let oneSignal = null;
  let connectionFailed = false;
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const readyTimeout = window.setTimeout(() => {
    if (oneSignal) return;
    setUnavailable('The OneSignal SDK did not finish loading. Check your connection and retry.');
  }, 8000);

  function setUnavailable(message) {
    connectionFailed = true;
    if (status) {
      status.textContent = `${message} In OneSignal, set the Web Site URL to ${window.location.origin} (no path) and confirm /push/onesignal/OneSignalSDKWorker.js loads.`;
    }
    if (toggle) {
      toggle.textContent = 'Retry connection';
      toggle.disabled = false;
    }
  }

  function updateStatus() {
    if (!oneSignal || !toggle || !status) return;
    connectionFailed = false;
    if (!oneSignal.Notifications.isPushSupported()) {
      status.textContent = 'This browser does not support push notifications.';
      toggle.textContent = 'Notifications unavailable';
      toggle.disabled = true;
      return;
    }

    const optedIn = oneSignal.User.PushSubscription.optedIn === true;
    const permission = 'Notification' in window ? window.Notification.permission : 'default';
    status.textContent = optedIn
      ? 'Browser notifications are enabled on this device.'
      : permission === 'denied'
        ? 'Notifications are blocked in browser settings. Allow them for this site to enable push.'
        : 'Enable browser notifications for project and security alerts.';
    toggle.textContent = optedIn ? 'Turn off browser notifications' : 'Enable browser notifications';
    toggle.disabled = permission === 'denied' && !optedIn;
    if (testButton) testButton.disabled = !optedIn;
  }

  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async (sdk) => {
    try {
      const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
      await sdk.init({
        appId,
        serviceWorkerPath: '/push/onesignal/OneSignalSDKWorker.js',
        serviceWorkerParam: { scope: '/push/onesignal/' },
        ...(isLocalhost ? { allowLocalhostAsSecureOrigin: true } : {}),
      });
      await sdk.login(userId);
      oneSignal = sdk;
      window.clearTimeout(readyTimeout);
      resolveReady(sdk);
      updateStatus();
      sdk.User.PushSubscription.addEventListener('change', updateStatus);
    } catch {
      window.clearTimeout(readyTimeout);
      resolveReady(null);
      setUnavailable('Browser notifications could not connect.');
    }
  });

  toggle?.addEventListener('click', async () => {
    if (!oneSignal) {
      if (connectionFailed) window.location.reload();
      return;
    }
    toggle.disabled = true;
    try {
      if (oneSignal.User.PushSubscription.optedIn) {
        await oneSignal.User.PushSubscription.optOut();
      } else {
        await oneSignal.User.PushSubscription.optIn();
      }
      updateStatus();
      window.setTimeout(updateStatus, 1200);
    } catch {
      if (status) status.textContent = 'The browser notification setting could not be updated. Try again.';
    } finally {
      updateStatus();
    }
  });

  testButton?.addEventListener('click', async () => {
    if (!oneSignal?.User?.PushSubscription?.optedIn) {
      if (testStatus) testStatus.textContent = 'Enable browser notifications on this device first.';
      return;
    }
    testButton.disabled = true;
    testButton.textContent = 'Sending…';
    if (testStatus) testStatus.textContent = 'Sending a test notification to this account…';
    try {
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
      const response = await fetch('/settings/notifications/test', {
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken, Accept: 'application/json' },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        if (testStatus) testStatus.textContent = result.error || 'The test notification could not be sent. Try again.';
      } else if (testStatus) {
        const recipients = Number.isInteger(result.recipients) ? ` OneSignal reports ${result.recipients} recipient(s).` : '';
        testStatus.textContent = `OneSignal accepted the test request.${recipients} Delivery to this device is not guaranteed.`;
      }
    } catch {
      if (testStatus) testStatus.textContent = 'Could not reach the portal to send the test notification.';
    } finally {
      testButton.textContent = 'Send test notification';
      updateStatus();
    }
  });

  const logoutForm = document.querySelector('form[action="/logout"]');
  logoutForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const submit = () => HTMLFormElement.prototype.submit.call(logoutForm);
    const timeout = new Promise((resolve) => window.setTimeout(resolve, 1800));
    void Promise.race([
      ready.then(async (sdk) => { if (sdk) await sdk.logout(); }),
      timeout,
    ]).catch(() => {}).finally(submit);
  });
})();
