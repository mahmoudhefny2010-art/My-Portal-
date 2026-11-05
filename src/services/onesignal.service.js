const APP_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ALIASES_PER_REQUEST = 20000;

function getPortalNotificationUrl() {
  try {
    const origin = new URL(process.env.PORTAL_ORIGIN || '');
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) return undefined;
    return new URL('/notifications', origin.origin).toString();
  } catch {
    return undefined;
  }
}

export function isOneSignalConfigured() {
  return APP_ID_PATTERN.test((process.env.ONESIGNAL_APP_ID || '').trim())
    && Boolean((process.env.ONESIGNAL_REST_API_KEY || '').trim());
}

export async function sendOneSignalPush({ userIds, title, message }) {
  const appId = (process.env.ONESIGNAL_APP_ID || '').trim();
  const apiKey = (process.env.ONESIGNAL_REST_API_KEY || '').trim();
  if (!APP_ID_PATTERN.test(appId) || !apiKey) return { ok: false, reason: 'not_configured' };
  if (!Array.isArray(userIds) || !userIds.length) return { ok: false, reason: 'no_recipients' };

  const notificationUrl = getPortalNotificationUrl();
  let acceptedRecipients = 0;
  let recipientCountKnown = true;
  let failure = null;
  for (let offset = 0; offset < userIds.length; offset += MAX_ALIASES_PER_REQUEST) {
    const payload = {
      app_id: appId,
      include_aliases: { external_id: userIds.slice(offset, offset + MAX_ALIASES_PER_REQUEST) },
      target_channel: 'push',
      headings: { en: title },
      contents: { en: message },
      ...(notificationUrl ? { url: notificationUrl } : {}),
    };

    try {
      const response = await fetch('https://api.onesignal.com/notifications', {
        method: 'POST',
        headers: {
          Authorization: 'Key ' + apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        console.warn('OneSignal push request failed with HTTP ' + response.status + '.');
        failure ||= { ok: false, reason: 'http_error', status: response.status };
        continue;
      }
      let result;
      try {
        result = await response.json();
      } catch {
        result = null;
      }
      if (Number.isInteger(result?.recipients) && result.recipients >= 0) {
        acceptedRecipients += result.recipients;
      } else {
        recipientCountKnown = false;
      }
    } catch {
      console.warn('OneSignal push request could not be completed.');
      failure ||= { ok: false, reason: 'network_error' };
    }
  }
  if (failure) return failure;
  return {
    ok: true,
    recipients: recipientCountKnown ? acceptedRecipients : null,
  };
}
