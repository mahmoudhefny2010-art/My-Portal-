(() => {
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const root = document.documentElement;
  const themes = ['DARK', 'LIGHT', 'SYSTEM'];
  const localTheme = () => (root.dataset.userTheme || 'dark').toUpperCase();

  async function setTheme(theme) {
    const normalized = themes.includes(theme) ? theme : 'DARK';
    root.dataset.theme = normalized.toLowerCase();
    root.dataset.userTheme = normalized.toLowerCase();
    document.querySelectorAll('[data-theme-option]').forEach((button) => {
      button.classList.toggle('is-selected', button.dataset.themeOption === normalized);
      button.setAttribute('aria-pressed', String(button.dataset.themeOption === normalized));
    });
    try {
      const response = await fetch('/api/preferences/theme', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ theme: normalized }),
      });
      if (!response.ok) throw new Error('Preference could not be saved.');
    } catch {
      const existing = document.querySelector('[data-theme-error]');
      if (existing) existing.textContent = 'Theme updated for this browser. Sign in again if the account preference did not save.';
    }
  }

  document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
    const index = themes.indexOf(localTheme());
    void setTheme(themes[(index + 1) % themes.length]);
  });
  document.querySelectorAll('[data-theme-option]').forEach((button) => {
    button.addEventListener('click', () => void setTheme(button.dataset.themeOption));
  });

  const menu = document.querySelector('[data-menu-toggle]');
  const scrim = document.querySelector('[data-sidebar-scrim]');
  function closeMenu() {
    document.body.classList.remove('menu-open');
    menu?.setAttribute('aria-expanded', 'false');
  }
  menu?.addEventListener('click', () => {
    const open = document.body.classList.toggle('menu-open');
    menu.setAttribute('aria-expanded', String(open));
  });
  scrim?.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });

  document.querySelectorAll('[data-dismiss]').forEach((button) => {
    button.addEventListener('click', () => button.closest('[data-notice]')?.remove());
  });
  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      if (!window.confirm(form.dataset.confirm || 'Continue with this action?')) event.preventDefault();
    });
  });
  document.querySelectorAll('select[data-autosubmit]').forEach((select) => {
    select.addEventListener('change', () => select.form?.requestSubmit());
  });
  document.querySelectorAll('form[data-busy-form]').forEach((form) => {
    form.addEventListener('submit', () => {
      const button = form.querySelector('button[type="submit"]');
      if (button) {
        button.disabled = true;
        const label = button.querySelector('span');
        if (label) label.textContent = 'Checking URL…';
      }
    });
  });
  document.querySelectorAll('[data-fullscreen]').forEach((button) => {
    button.addEventListener('click', async () => {
      const target = document.getElementById(button.dataset.fullscreen);
      if (!target) return;
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await target.requestFullscreen();
      } catch {
        button.textContent = 'Fullscreen unavailable';
      }
    });
  });
  document.querySelectorAll('[data-rotate-secret]').forEach((button) => {
    button.addEventListener('click', async () => {
      const slug = button.dataset.rotateSecret;
      const output = document.getElementById('secret-output-' + slug);
      if (!output) return;
      button.disabled = true;
      button.textContent = 'Creating…';
      try {
        const response = await fetch('/projects/' + encodeURIComponent(slug) + '/integration/rotate-secret', {
          method: 'POST',
          headers: { 'x-csrf-token': csrf },
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Secret could not be created.');
        output.hidden = false;
        output.replaceChildren();
        const heading = document.createElement('strong');
        heading.textContent = 'Copy this secret now. It will not be shown again.';
        const detail = document.createElement('p');
        detail.textContent = 'Save it as CONTROL_PORTAL_WEBHOOK_SECRET in the original application. Rotating it invalidates the previous value.';
        const code = document.createElement('code');
        code.textContent = result.secret;
        const endpoint = document.createElement('code');
        endpoint.textContent = result.endpoint;
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'button button-secondary button-small';
        copy.textContent = 'Copy secret';
        copy.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(result.secret); copy.textContent = 'Copied'; }
          catch { copy.textContent = 'Select the secret above to copy'; }
        });
        output.append(heading, detail, code, document.createElement('br'), endpoint, copy);
        button.textContent = 'Rotate webhook secret';
      } catch (error) {
        output.hidden = false;
        output.textContent = error.message;
        button.textContent = 'Retry secret setup';
      } finally {
        button.disabled = false;
      }
    });
  });

  const auditFeed = document.querySelector('[data-audit-feed]');
  if (auditFeed) {
    let since = auditFeed.dataset.lastEvent;
    let checking = false;
    const list = auditFeed.querySelector('.audit-event-list');
    const addEvent = (event) => {
      const emptyState = auditFeed.querySelector('.empty-state');
      emptyState?.remove();
      let target = auditFeed.querySelector('.audit-event-list');
      if (!target) {
        target = document.createElement('div');
        target.className = 'audit-event-list';
        auditFeed.append(target);
      }
      const article = document.createElement('article');
      article.className = 'audit-event';
      const icon = document.createElement('div');
      icon.className = 'audit-event-icon severity-' + String(event.severity).toLowerCase();
      icon.textContent = event.severity === 'ERROR' ? '!' : event.severity === 'SUCCESS' ? '✓' : '•';
      const main = document.createElement('div');
      main.className = 'audit-event-main';
      const heading = document.createElement('div');
      heading.className = 'audit-event-head';
      const title = document.createElement('strong');
      title.textContent = event.action;
      const severity = document.createElement('span');
      severity.className = 'severity-label';
      severity.textContent = event.severity;
      const time = document.createElement('time');
      time.dateTime = event.happenedAt;
      time.textContent = new Date(event.happenedAt).toLocaleString();
      heading.append(title, severity, time);
      const description = document.createElement('p');
      description.textContent = (event.actorLabel || 'Connected website administrator') + ' · ' + event.entityType
        + (event.entityId ? ' / ' + event.entityId : '');
      main.append(heading, description);
      if (Array.isArray(event.changes) && event.changes.length) {
        const changes = document.createElement('div');
        changes.className = 'change-list';
        event.changes.forEach((change) => {
          const row = document.createElement('div');
          const field = document.createElement('span');
          field.textContent = change.field;
          const before = document.createElement('code');
          before.textContent = Object.hasOwn(change, 'before') ? JSON.stringify(change.before) : '—';
          const arrow = document.createElement('span');
          arrow.textContent = '→';
          const after = document.createElement('code');
          after.textContent = Object.hasOwn(change, 'after') ? JSON.stringify(change.after) : '—';
          row.append(field, before, arrow, after);
          changes.append(row);
        });
        main.append(changes);
      }
      const eventId = document.createElement('small');
      eventId.textContent = 'Event ID ' + event.eventId + ' · received ' + new Date(event.receivedAt).toLocaleString();
      main.append(eventId);
      article.append(icon, main);
      target.prepend(article);
    };
    const pollAudit = async () => {
      if (checking) return;
      checking = true;
      try {
        const response = await fetch('/api/projects/' + encodeURIComponent(auditFeed.dataset.auditFeed)
          + '/audit-events?since=' + encodeURIComponent(since), { headers: { accept: 'application/json' }, cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        for (const event of data.events || []) {
          addEvent(event);
          if (event.receivedAt > since) since = event.receivedAt;
        }
      } catch {
        // The next interval retries when the portal or network is unavailable.
      } finally {
        checking = false;
      }
    };
    window.setInterval(pollAudit, 15000);
  }
})();
