const https = require('https');
const { URL } = require('url');

module.exports = function handler(req, res) {
  // Handle preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');
  res.setHeader('Accept-Ranges', 'bytes');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const targetUrl = req.query.url;

  if (!targetUrl || (!targetUrl.startsWith('https://files.th3scr1b3.art/') && !targetUrl.startsWith('https://pznmptudgicrmljjafex.supabase.co/'))) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Invalid target audio URL');
    return;
  }

  function proxyStream(url) {
    try {
      const parsedUrl = new URL(url);
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
          return proxyStream(proxyRes.headers.location);
        }

        const responseHeaders = {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Range, Content-Type, Accept',
          'Accept-Ranges': 'bytes',
          'Content-Type': proxyRes.headers['content-type'] || 'audio/mpeg',
          'Cache-Control': 'public, max-age=86400, s-maxage=604800'
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
        console.warn(`Proxy stream error for ${url}:`, err.message);
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

  proxyStream(targetUrl);
};
