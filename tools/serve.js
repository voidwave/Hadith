#!/usr/bin/env node
/* ===========================================================================
 * serve.js — a tiny static server for working on the app locally.
 *
 *   node tools/serve.js          → http://localhost:8123/
 *   node tools/serve.js 3000     → another port
 *
 * Serves the app folder (the parent of tools/), sends no-cache so an edit is
 * visible on reload, and supports Range requests (the browser asks for ranges
 * on large .bin files).
 * =========================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2]) || 8123;

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.gz': 'application/gzip',
    '.bin': 'application/octet-stream',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf'
};

const server = http.createServer((request, response) => {
    const url = decodeURIComponent(request.url.split('?')[0]);
    const relative = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
    const file = path.join(ROOT, relative);

    if (!file.startsWith(ROOT)) {
        response.writeHead(403).end('forbidden');
        return;
    }

    fs.stat(file, (error, stats) => {
        if (error || !stats.isFile()) {
            response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
                .end('not found: ' + relative);
            return;
        }
        const headers = {
            'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'cache-control': 'no-cache',
            'accept-ranges': 'bytes'
        };
        const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range || '');
        if (range) {
            const start = range[1] ? Number(range[1]) : 0;
            const end = range[2] ? Number(range[2]) : stats.size - 1;
            headers['content-range'] = `bytes ${start}-${end}/${stats.size}`;
            headers['content-length'] = end - start + 1;
            response.writeHead(206, headers);
            fs.createReadStream(file, { start, end }).pipe(response);
            return;
        }
        headers['content-length'] = stats.size;
        response.writeHead(200, headers);
        fs.createReadStream(file).pipe(response);
    });
});

server.listen(PORT, () => {
    console.log(`serving ${ROOT}`);
    console.log(`  http://localhost:${PORT}/`);
});
