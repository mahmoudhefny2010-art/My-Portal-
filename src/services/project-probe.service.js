import { safeHttpsRequest } from '../security/safe-fetch.js';

function decodeEntities(value) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_match, code) => {
      const point = Number(code);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => {
      const point = Number.parseInt(code, 16);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
    });
}

function pageTitle(html) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  if (!match) return null;
  const text = decodeEntities(match[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
  return text.slice(0, 120) || null;
}

function favicon(html, origin) {
  const tags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!/\brel\s*=\s*['"][^'"]*(?:icon|shortcut icon)[^'"]*['"]/i.test(tag)) continue;
    const href = tag.match(/\bhref\s*=\s*(['"])(.*?)\1/i)?.[2];
    if (!href) continue;
    try {
      const candidate = new URL(decodeEntities(href), origin);
      if (candidate.protocol === 'https:' && candidate.origin === origin && !candidate.username && !candidate.password) {
        return candidate.toString();
      }
    } catch {
      continue;
    }
  }
  return new URL('/favicon.ico', origin).toString();
}

function framePolicy(headers, projectOrigin, portalOrigin) {
  const xFrame = String(headers['x-frame-options'] || '').trim().toLowerCase();
  const csp = String(headers['content-security-policy'] || '');
  const directive = csp.split(';').map((part) => part.trim()).find((part) => /^frame-ancestors\b/i.test(part));

  if (xFrame === 'deny' || (xFrame === 'sameorigin' && portalOrigin !== projectOrigin)) {
    return { code: 'BLOCKED', message: 'The response sends an X-Frame-Options policy that prevents portal embedding.' };
  }
  if (xFrame && !['deny', 'sameorigin'].includes(xFrame)) {
    return { code: 'BLOCKED', message: 'The response uses an unsupported X-Frame-Options policy.' };
  }
  if (!directive) {
    return { code: 'NOT_EXPLICIT', message: 'The response does not explicitly allow this portal to frame the dashboard.' };
  }

  const sources = directive.split(/\s+/).slice(1).map((part) => part.replace(/^['"]|['"]$/g, ''));
  if (sources.includes('none')) {
    return { code: 'BLOCKED', message: 'The Content-Security-Policy frame-ancestors directive blocks embedding.' };
  }
  if (sources.includes('*') || (sources.includes('self') && portalOrigin === projectOrigin)
    || sources.includes(portalOrigin)) {
    return { code: 'POLICY_ALLOWS', message: 'The response policy permits framing, but authentication and admin workflows still need verification.' };
  }
  return { code: 'BLOCKED', message: 'The Content-Security-Policy frame-ancestors directive does not allow this portal origin.' };
}

export async function inspectAdminUrl(adminUrl, portalOrigin = process.env.PORTAL_ORIGIN || 'http://localhost:3000') {
  const response = await safeHttpsRequest(adminUrl);
  const contentType = String(response.headers['content-type'] || '').toLowerCase();
  const html = contentType.includes('text/html') ? response.body : '';
  const origin = new URL(response.finalUrl).origin;
  const requestedOrigin = new URL(adminUrl).origin;
  let policy = framePolicy(response.headers, origin, new URL(portalOrigin).origin);
  if (requestedOrigin !== origin) {
    policy = { code: 'BLOCKED', message: 'The Admin URL redirects to a different origin. Register a direct dashboard URL before verifying embedding.' };
  } else if (response.status >= 500) {
    policy = { code: 'NOT_EXPLICIT', message: 'The Admin URL returned a server error; embedding is not verified.' };
  }
  return {
    httpStatus: response.status,
    durationMs: response.durationMs,
    title: pageTitle(html),
    faviconUrl: html ? favicon(html, origin) : null,
    finalUrl: response.finalUrl,
    framePolicy: policy,
    reachable: response.status >= 200 && response.status < 500,
  };
}
