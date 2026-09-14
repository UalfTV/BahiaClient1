// Servidor local para probar la vista del juego.
// Uso:  node dev-server.js
// Abrir: http://localhost:4321/?roomId=XXXXXX&nick=TuNick

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 4321;
const HOST = '127.0.0.1';
const ROOT = path.resolve(__dirname);

const MIME = {
  '.html':        'text/html; charset=utf-8',
  '.htm':         'text/html; charset=utf-8',
  '.css':         'text/css; charset=utf-8',
  '.js':          'application/javascript; charset=utf-8',
  '.mjs':         'application/javascript; charset=utf-8',
  '.json':        'application/json; charset=utf-8',
  '.map':         'application/json; charset=utf-8',
  '.txt':         'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png':         'image/png',
  '.jpg':         'image/jpeg',
  '.jpeg':        'image/jpeg',
  '.gif':         'image/gif',
  '.webp':        'image/webp',
  '.svg':         'image/svg+xml',
  '.ico':         'image/x-icon',
  '.woff':        'font/woff',
  '.woff2':       'font/woff2',
  '.ttf':         'font/ttf',
  '.otf':         'font/otf',
  '.wav':         'audio/wav',
  '.ogg':         'audio/ogg',
  '.mp3':         'audio/mpeg',
  '.mp4':         'video/mp4',
  '.webm':        'video/webm',
  '.wasm':        'application/wasm',
};

// FIX #1: chequeo robusto — filePath debe estar DENTRO de ROOT
function isInsideRoot(filePath) {
  const rel = path.relative(ROOT, filePath);
  // vacío = es ROOT mismo; no empieza con .. = está adentro
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function send(res, code, contentType, body, isHead) {
  res.writeHead(code, { 'Content-Type': contentType });
  if (isHead) res.end();
  else res.end(body);
}

http.createServer((req, res) => {
  const isHead = req.method === 'HEAD';

  // FIX #2: decodeURIComponent puede tirar URIError con input malformado.
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    return send(res, 400, 'text/plain; charset=utf-8', 'bad request', isHead);
  }

  // Null bytes: Node los rechaza, pero cortamos antes
  if (urlPath.indexOf('\0') !== -1) {
    return send(res, 400, 'text/plain; charset=utf-8', 'bad request', isHead);
  }

  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  // FIX #1: '.' + urlPath fuerza a que sea relativo (path.resolve si no
  // lo trataría como absoluto y se escaparía del ROOT).
  const filePath = path.resolve(ROOT, '.' + urlPath);

  if (!isInsideRoot(filePath)) {
    return send(res, 403, 'text/plain; charset=utf-8', 'forbidden', isHead);
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      return send(res, 404, 'text/plain; charset=utf-8', 'not found: ' + urlPath, isHead);
    }
    const ext = path.extname(filePath).toLowerCase();
    const ct  = MIME[ext] || 'application/octet-stream';
    // FIX #3: saqué `Access-Control-Allow-Origin: *`. Si necesitás CORS,
    // restringilo a un origen concreto.
    res.writeHead(200, {
      'Content-Type':  ct,
      'Cache-Control': 'no-store',
      // 'Access-Control-Allow-Origin': 'http://127.0.0.1:4321', // descomentar si hace falta
    });
    if (isHead) res.end();
    else res.end(data);
  });
}).listen(PORT, HOST, () => {
  console.log('');
  console.log('  BahiaClient — dev server');
  console.log('  http://localhost:' + PORT + '/?roomId=XXXXXX&nick=TuNick');
  console.log('');
});