import http from 'node:http';
export function callUi(socketPath, input) {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath, path: '/ui', method: 'POST', timeout: 15000, headers: { 'Content-Type': 'application/json' } }, response => {
      let data = ''; response.on('data', chunk => { data += chunk; if (data.length > 2_000_000) request.destroy(new Error('UI response too large')); });
      response.on('end', () => { try { const result = JSON.parse(data); if (response.statusCode !== 200) reject(new Error(result.error ?? 'UI request failed')); else resolve(result); } catch (e) { reject(e); } });
    });
    request.on('error', reject); request.on('timeout', () => request.destroy(new Error('UI did not answer. Open the browser editor and trust the workspace.')));
    request.end(JSON.stringify(input));
  });
}
