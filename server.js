const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3365;
const PUBLIC_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.webm': 'audio/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.glsl': 'text/plain; charset=utf-8'
};

// Load cached PIM Catalog
let pimCatalog = [];
try {
  const catalogPath = path.join(PUBLIC_DIR, 'data/pim_song_catalog.json');
  if (fs.existsSync(catalogPath)) {
    pimCatalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    console.log(`Loaded ${pimCatalog.length} songs from PIM database.`);
  }
} catch (e) {
  console.warn('PIM catalog preload note:', e);
}

// Streaming proxy helper with redirect and Range support
function proxyStream(targetUrl, req, res) {
  try {
    const parsedUrl = new URL(targetUrl);
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
      'Accept': '*/*'
    };

    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const proxyReq = https.get(parsedUrl, { headers }, (proxyRes) => {
      // Handle HTTP redirects (301, 302, 307, 308)
      if ([301, 302, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location) {
        return proxyStream(proxyRes.headers.location, req, res);
      }

      const responseHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Content-Type, Accept',
        'Accept-Ranges': 'bytes',
        'Content-Type': proxyRes.headers['content-type'] || 'audio/mpeg'
      };

      if (proxyRes.headers['content-length']) {
        responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
      }
      if (proxyRes.headers['content-range']) {
        responseHeaders['Content-Range'] = proxyRes.headers['content-range'];
      }

      res.writeHead(proxyRes.statusCode, responseHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.warn(`Proxy stream error for ${targetUrl}:`, err.message);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
        res.end('Proxy Error: ' + err.message);
      }
    });

    req.on('close', () => {
      proxyReq.destroy();
    });
  } catch (e) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('Proxy Exception: ' + e.message);
    }
  }
}

const server = http.createServer((req, res) => {
  // Global CORS & Security headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');
  res.setHeader('Accept-Ranges', 'bytes');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let [pathname, queryString] = req.url.split('?');

  // API Endpoint: /api/pim/songs
  if (pathname === '/api/pim/songs') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, totalSongs: pimCatalog.length, songs: pimCatalog }));
    return;
  }

  // API Endpoint: /api/pim/song/:day
  if (pathname.startsWith('/api/pim/song/')) {
    const dayStr = pathname.replace('/api/pim/song/', '');
    const dayNum = parseInt(dayStr, 10);
    const song = pimCatalog.find(s => s.day === dayNum);

    if (song) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, song }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: 'Song not found for day ' + dayNum }));
    }
    return;
  }

  // API Endpoint: /api/audio-proxy (High-Performance Audio Streamer)
  if (pathname === '/api/audio-proxy') {
    const params = new URLSearchParams(queryString || '');
    const targetUrl = params.get('url');

    if (!targetUrl || (!targetUrl.startsWith('https://files.th3scr1b3.art/') && !targetUrl.startsWith('https://pznmptudgicrmljjafex.supabase.co/'))) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid target audio URL');
      return;
    }

    proxyStream(targetUrl, req, res);
    return;
  }

  if (pathname === '/') {
    pathname = '/index.html';
  }

  const safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`404 Not Found: ${pathname}`);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const totalSize = stats.size;
    const range = req.headers.range;

    // Handle HTTP Range Requests for smooth audio scrubbing/seeking
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;

      if (start >= totalSize || end >= totalSize || start > end) {
        res.writeHead(416, {
          'Content-Range': `bytes */${totalSize}`,
          'Content-Type': contentType
        });
        res.end();
        return;
      }

      const chunkSize = (end - start) + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType
      });

      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': totalSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
      });

      fs.createReadStream(filePath).pipe(res);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`  🎵 WINAMP 365 Server running at http://localhost:${PORT}`);
  console.log(`  📻 365-Day PIM Audio Player with MilkDrop & Geiss`);
  console.log(`  ⚡ PIM 365 Songs Database: ${pimCatalog.length} tracks seeded`);
  console.log(`  📡 Streaming Proxy Active for files.th3scr1b3.art`);
  console.log(`=======================================================`);
});
