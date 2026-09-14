// Development-only static preview. Never serves account data or project files.
import http from 'node:http';
import {readFile} from 'node:fs/promises';

const root = new URL('../pages/', import.meta.url);
const files = new Map(['index.html', 'overlay.mjs', 'overlay.css', 'model.mjs'].map(file => [`/${file}`, file]));
files.set('/preview', 'index.html');
const types = {html: 'text/html', mjs: 'text/javascript', css: 'text/css'};
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1:18767');
    if (req.method === 'GET' && url.pathname === '/') { res.writeHead(302, {Location: '/preview?demo=1'}); return res.end(); }
    const file = files.get(url.pathname);
    if (req.method !== 'GET' || !file) { res.writeHead(404); return res.end('Not found'); }
    try {
        const data = await readFile(new URL(file, root));
        res.writeHead(200, {'Content-Type': types[file.split('.').at(-1)], 'Cache-Control': 'no-store'}); res.end(data);
    } catch { res.writeHead(500); res.end('Preview unavailable'); }
});
server.listen(18767, '127.0.0.1', () => console.log('Sample overlay: http://127.0.0.1:18767/preview?demo=1'));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
