/* 极简静态服务器：node server.js [port] */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  // 音频（music/ 目录里的初始歌单）
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
};

const MUSIC_DIR = path.join(ROOT, 'music');
const PHOTOS_DIR = path.join(ROOT, 'photos');
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.flac', '.webm', '.opus']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']);

/** GET /api/photos → [{name, url}]，按文件名排序（photos/ 目录里的相框照片） */
function listPhotos(res, headOnly) {
  fs.readdir(PHOTOS_DIR, (err, names) => {
    if (err) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(headOnly ? undefined : '[]');
      return;
    }
    const imgs = names
      .filter((n) => IMAGE_EXT.has(path.extname(n).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .map((n) => ({ name: path.parse(n).name, url: '/photos/' + encodeURIComponent(n) }));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(headOnly ? undefined : JSON.stringify(imgs));
  });
}

/** GET /api/music → [{name, url}]，按文件名排序 */
function listMusic(res, headOnly) {
  fs.readdir(MUSIC_DIR, (err, names) => {
    if (err) {
      // 没有 music/ 目录也算正常，返回空列表
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(headOnly ? undefined : '[]');
      return;
    }
    const tracks = names
      .filter((n) => AUDIO_EXT.has(path.extname(n).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .map((n) => ({ name: path.parse(n).name, url: '/music/' + encodeURIComponent(n) }));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(headOnly ? undefined : JSON.stringify(tracks));
  });
}

const server = http.createServer((req, res) => {
  const method = req.method || 'GET';
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/api/music') {
    if (method !== 'GET' && method !== 'HEAD') { res.writeHead(405).end('Method Not Allowed'); return; }
    listMusic(res, method === 'HEAD');
    return;
  }
  if (urlPath === '/api/photos') {
    if (method !== 'GET' && method !== 'HEAD') { res.writeHead(405).end('Method Not Allowed'); return; }
    listPhotos(res, method === 'HEAD');
    return;
  }
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  ✦ 圣诞树已点亮 → http://127.0.0.1:${PORT}/\n`);
  console.log('  按 Ctrl+C 关闭\n');
});
