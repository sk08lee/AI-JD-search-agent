import express from 'express';
import cors from 'cors';
import path from 'path';
import { generateReport, listTasks } from './api.js';
import { loadConfig } from './config/index.js';

const app = express();
const config = loadConfig();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

app.get('/api/tasks', (req, res) => {
    try {
        const tasks = listTasks();
        res.json({ success: true, data: tasks });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to list tasks' });
    }
});

app.post('/api/generate', async (req, res) => {
    const { taskId, jobTitle } = req.body;
    
    if (!taskId || !jobTitle) {
        return res.status(400).json({ success: false, message: 'taskId and jobTitle are required' });
    }

    try {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        const report = await generateReport(taskId, jobTitle);
        
        res.write(`data: ${JSON.stringify({ success: true, content: report })}\n\n`);
        res.end();
    } catch (error) {
        console.error('Generate report error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Failed to generate report' }));
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});