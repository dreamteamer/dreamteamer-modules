import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const equals = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function gateway({ socketPath, workspace, port = 0, token = randomBytes(32).toString('base64url') }) {
  const cookieName = `dt_editor_${randomBytes(8).toString('hex')}`;
  let origin;
  const sockets = new Set();
  const cookies = (req) => (req.headers.cookie ?? '').split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  const authenticated = (req) => equals(cookies(req), token) || equals(req.headers.authorization, `Bearer ${token}`);
  const allowed = (req) => req.headers.host === new URL(origin).host && (!req.headers.origin || req.headers.origin === origin);
  const headers = (req) => {
    const h = { ...req.headers, host: new URL(origin).host };
    delete h.authorization;
    for (const k of Object.keys(h)) if (k.startsWith('x-forwarded-') || k === 'forwarded') delete h[k];
    h.cookie = (h.cookie ?? '').split(';').filter(v => !v.trim().startsWith(cookieName + '=')).join(';');
    return h;
  };
  const server = http.createServer(async (req, res) => {
    const end = (status, text) => { res.writeHead(status, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end(text); };
    if (!allowed(req)) return end(403, 'Forbidden origin');
    const url = new URL(req.url, origin);
    // A login URL exchanges the secret for a session cookie and immediately removes it from the URL.
    if (url.pathname === '/_dt/open') {
      if (req.method !== 'GET') return end(405, 'GET required');
      if (!authenticated(req) && !equals(url.searchParams.get('token'), token)) return end(401, 'Authentication required');
      res.writeHead(303, { Location: '/?' + new URLSearchParams({ folder: workspace }), 'Set-Cookie': `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      return res.end();
    }
    if (!authenticated(req)) return end(401, 'Open the authenticated URL printed by dt-editor.');
    if (url.pathname.startsWith('/_dt/')) return end(404, 'Not found');
    const upstream = http.request({ socketPath, method: req.method, path: req.url, headers: headers(req) }, response => {
      res.writeHead(response.statusCode, { ...response.headers, 'Referrer-Policy': 'no-referrer' }); response.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) end(502, 'Editor unavailable'); else res.destroy(); });
    req.on('aborted', () => upstream.destroy());
    req.pipe(upstream);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (req, socket, head) => {
    if (!allowed(req) || !authenticated(req) || req.url.startsWith('/_dt/')) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    const upstream = http.request({ socketPath, path: req.url, headers: headers(req) });
    upstream.on('upgrade', (response, peer, peerHead) => {
      socket.write(`HTTP/1.1 ${response.statusCode} Switching Protocols\r\n` + Object.entries(response.headers).map(([k,v]) => `${k}: ${v}\r\n`).join('') + '\r\n');
      if (peerHead.length) socket.write(peerHead);
      if (head.length) peer.write(head);
      peer.pipe(socket); socket.pipe(peer);
      peer.on('error', () => socket.destroy()); socket.on('error', () => peer.destroy());
      socket.on('close', () => peer.destroy()); peer.on('close', () => socket.destroy());
    });
    upstream.on('response', () => socket.destroy());
    upstream.on('error', () => socket.destroy()); upstream.end();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, token, link: () => `${origin}/_dt/open?${new URLSearchParams({ token })}`, close: () => new Promise(resolve => { for (const socket of sockets) socket.destroy(); server.close(resolve); }) };
}
