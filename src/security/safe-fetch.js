import https from 'node:https';
import { performance } from 'node:perf_hooks';
import { resolvePublicAddresses } from './network.js';

const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 8000;

function oneRequest(url, address, family, method) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const request = https.request(url, {
      method,
      headers: {
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'user-agent': 'ControlPortal-Monitor/1.0',
      },
      lookup: (_hostname, options, callback) => {
        if (options?.all) callback(null, [{ address, family }]);
        else callback(null, address, family);
      },
      servername: url.hostname,
      rejectUnauthorized: true,
    }, (response) => {
      const status = response.statusCode || 0;
      const headers = response.headers;
      const location = headers.location || null;
      if (location || method === 'HEAD') {
        response.resume();
        response.once('end', () => resolve({
          status, headers, location, body: '', durationMs: Math.round(performance.now() - started),
        }));
        return;
      }

      let body = '';
      let bytes = 0;
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX_BYTES) {
          request.destroy(new Error('Response exceeded the safe metadata limit.'));
          return;
        }
        body += chunk;
      });
      response.on('end', () => resolve({
        status, headers, location, body, durationMs: Math.round(performance.now() - started),
      }));
    });

    request.setTimeout(TIMEOUT_MS, () => request.destroy(new Error('Connection timed out.')));
    request.once('error', (error) => reject(error));
    request.end();
  });
}

export async function safeHttpsRequest(input, { method = 'GET', maxRedirects = 3 } = {}) {
  let url = new URL(input);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443')) {
      throw new Error('Only public HTTPS URLs on the standard port can be checked.');
    }
    const addresses = await resolvePublicAddresses(url.hostname);
    const result = await oneRequest(url, addresses[0].address, addresses[0].family, method);
    if (!result.location) return { ...result, finalUrl: url.toString() };
    if (hop === maxRedirects) throw new Error('The destination redirected too many times.');
    url = new URL(result.location, url);
  }
  throw new Error('The destination could not be checked safely.');
}
