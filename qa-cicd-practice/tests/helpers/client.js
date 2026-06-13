/**
 * Minimal test HTTP client — replaces supertest with zero npm dependencies.
 * Usage:  const api = require('../helpers/client'); const res = await api(app).get('/health');
 */
'use strict';

const http = require('http');

function client(app) {
  let server;
  let port;

  function ensureServer() {
    if (server) return Promise.resolve();
    return new Promise(resolve => {
      server = app.listen(0, () => {             // OS picks a free port
        port = server.address().port;
        resolve();
      });
    });
  }

  function request(method, path, body) {
    return ensureServer().then(() => {
      return new Promise((resolve, reject) => {
        const bodyStr = body ? JSON.stringify(body) : null;
        const options = {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
          },
        };

        const req = http.request(options, res => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            let body = null;
            try { body = JSON.parse(data); } catch { body = data; }
            resolve({ status: res.statusCode, body });
          });
        });

        req.on('error', reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
      });
    });
  }

  const api = {
    get:    path        => request('GET',    path),
    post:   (path, b)  => request('POST',   path, b),
    put:    (path, b)  => request('PUT',    path, b),
    delete: path        => request('DELETE', path),
    close:  ()         => new Promise(resolve => server ? server.close(resolve) : resolve()),
  };

  return api;
}

module.exports = client;
