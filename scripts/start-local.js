import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT || 8080;
const publicDir = path.join(process.cwd(), 'public');

const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

function getContentType(filePath) {
    const ext = path.extname(filePath);
    return mimeTypes[ext] || 'application/octet-stream';
}

const server = http.createServer((req, res) => {
    let filePath = path.join(publicDir, req.url === '/' ? 'index.html' : req.url);
    
    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
            return;
        }

        fs.readFile(filePath, (err, content) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('500 Internal Server Error');
                return;
            }

            res.writeHead(200, { 'Content-Type': getContentType(filePath) });
            res.end(content);
        });
    });
});

server.listen(PORT, () => {
    console.log(`Local server running on http://localhost:${PORT}`);
});