import http from 'http';
import fs from 'fs';
import path from 'path';
import { generateReport, listTasks } from './api.js';

const PORT = process.env.PORT || 3000;
const publicDir = path.join(process.cwd(), 'public');

const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

function getContentType(filePath: string): string {
    const ext = path.extname(filePath);
    return mimeTypes[ext] || 'application/octet-stream';
}

async function handleApiTasks(req: http.IncomingMessage, res: http.ServerResponse) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const tasks = listTasks();
    res.end(JSON.stringify({ success: true, data: tasks }));
}

async function handleApiGenerate(req: http.IncomingMessage, res: http.ServerResponse) {
    let body = '';
    req.on('data', chunk => {
        body += chunk.toString();
    });

    req.on('end', async () => {
        try {
            const { taskId, jobTitle, jobCategory } = JSON.parse(body);

            if (!jobTitle) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: 'jobTitle is required' }));
                return;
            }

            const resolvedTaskId = taskId || 'custom';
            const resolvedCategory = typeof jobCategory === 'string' && jobCategory.trim()
                ? jobCategory.trim()
                : '实习';

            const report = await generateReport(
                resolvedTaskId,
                jobTitle,
                resolvedCategory
            );
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, content: report }));
        } catch (error) {
            console.error('Generate report error:', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Failed to generate report' }));
        }
    });
}

function handleStatic(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = req.url || '/';
    let filePath = path.join(publicDir, url === '/' ? 'index.html' : url);
    
    fs.stat(filePath, (err, stats) => {
        if (err || !stats?.isFile()) {
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
}

const server = http.createServer(async (req, res) => {
    const url = req.url || '/';
    const method = req.method || 'GET';

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (url === '/api/tasks' && method === 'GET') {
        await handleApiTasks(req, res);
    } else if (url === '/api/generate' && method === 'POST') {
        await handleApiGenerate(req, res);
    } else {
        handleStatic(req, res);
    }
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
