import MCPClient from "./MCPClient.js";
import Agent from "./Agent.js";
import EmbeddingRetriever from "./EmbeddingRetriever.js";
import { loadConfig } from "./config/index.js";
import { taskTemplates, TaskTemplate } from "./tasks/index.js";
import { requirementsOnlyUserPrompt } from "./tasks/requirementsOnlyPrompt.js";
import { getReportTemplate } from "./reports/templates.js";
import { commandExists, resolveUvxCommand } from "./commandUtils.js";
import { fetchCareerPortalPages, formatCareerFetchContext } from "./careerPortalFetcher.js";
import fs from "fs";
import path from "path";

const config = loadConfig();
const outPath = path.join(process.cwd(), config.output.directory);
const knowledgeDir = path.join(process.cwd(), config.knowledge.directory);

export async function generateReport(taskId: string, jobTitle: string, jobCategory?: string): Promise<string> {
    fs.mkdirSync(outPath, { recursive: true });

    const category = jobCategory?.trim() || jobTitle;
    const searchTarget = jobCategory ? `${jobCategory} · ${jobTitle}` : jobTitle;

    const template = taskTemplates[taskId] || {
        id: 'custom',
        name: `${searchTarget}岗位搜索`,
        description: `搜索 ${searchTarget} 岗位需求`,
        systemPrompt: `你是一个严谨的求职研究助手。你需要区分事实、推断和建议。
涉及岗位信息时，优先引用公开来源或本地知识库内容；如果信息不足，明确提醒用户补充来源。`,
        userPrompt: requirementsOnlyUserPrompt,
        reportTemplate: 'job-demand-report',
        knowledgeBaseDir: 'knowledge/jobs/general'
    };

    const reportFileName = `${taskId}-job-demand-report.md`;
    const reportPath = path.join(outPath, reportFileName);

    const ragContext = await retrieveContext(template.knowledgeBaseDir);
    const careerResults = await fetchCareerPortalPages({ jobTitle, jobCategory: category });
    const webContext = formatCareerFetchContext(careerResults, jobTitle, category);
    const context = truncateContext([ragContext, webContext].filter(Boolean).join('\n\n---\n\n'));

    if (careerResults.length > 0) {
        const successCount = careerResults.filter((item) => item.status === 'success').length;
        const jobCount = careerResults.reduce((total, item) => total + item.jobs.length, 0);
        console.log(`[CareerFetch] keyword="${jobTitle}" matched ${jobCount} jobs from ${successCount}/${careerResults.length} sources`);
    }

    const model = config.llm.model;
    const systemPrompt = template.systemPrompt;

    const uvxCommand = resolveUvxCommand();
    const fetchMCP = new MCPClient("mcp-server-fetch", uvxCommand, ['mcp-server-fetch']);
    const fileMCP = new MCPClient("mcp-server-file", "npx", ['-y', '@modelcontextprotocol/server-filesystem', outPath]);

    const enableFetchMCP = config.tools.enableFetch;
    const canUseFetchMCP = enableFetchMCP && commandExists(uvxCommand);
    const mcpClients = canUseFetchMCP ? [fetchMCP, fileMCP] : [fileMCP];

    const agent = new Agent(model, mcpClients, systemPrompt, context);
    let response = '';

    try {
        await agent.init();
        const userPrompt = template.userPrompt
            .replace(/\{jobCategory\}/g, category)
            .replace(/\{jobTitle\}/g, jobTitle)
            .replace(/\{searchTarget\}/g, searchTarget)
            .replace('{reportPath}', reportPath);
        response = await agent.invoke(userPrompt);
    } catch (e: any) {
        console.warn(`[LLM degraded] ${sanitizeErrorMessage(e)}`);
        const reportTemplate = getReportTemplate(template.reportTemplate);
        response = reportTemplate?.fallback(context, e, searchTarget) || buildGenericFallbackReport(context, e, searchTarget, category);
    } finally {
        await agent.close();
    }

    if (!fs.existsSync(reportPath) && response) {
        fs.writeFileSync(reportPath, response, 'utf-8');
    }

    return response;
}

export function listTasks() {
    return Object.entries(taskTemplates).map(([key, template]) => ({
        id: key,
        name: template.name,
        description: template.description
    }));
}

async function retrieveContext(knowledgeBaseDir: string) {
    const fullPath = path.join(knowledgeDir, knowledgeBaseDir);
    const embeddingRetriever = new EmbeddingRetriever(config.embedding.model);
    const files = collectMarkdownFiles(fullPath);

    if (files.length === 0) {
        const generalPath = path.join(knowledgeDir, 'jobs', 'general');
        const generalFiles = collectMarkdownFiles(generalPath);
        if (generalFiles.length === 0) {
            return '';
        }
        for (const file of generalFiles) {
            const content = fs.readFileSync(file, 'utf-8');
            await embeddingRetriever.embedDocument(content);
        }
    } else {
        for (const file of files) {
            const content = fs.readFileSync(file, 'utf-8');
            await embeddingRetriever.embedDocument(content);
        }
    }

    const context = (await embeddingRetriever.retrieve('岗位需求分析', 3)).join('\n');
    return context;
}

function collectMarkdownFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];

    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) return collectMarkdownFiles(fullPath);
        if (entry.isFile() && entry.name.endsWith('.md')) return [fullPath];
        return [];
    });
}

function buildGenericFallbackReport(context: string, error: unknown, jobTitle: string, jobCategory?: string): string {
    const message = sanitizeErrorMessage(error);
    const careerSection = extractCareerSection(context);

    if (careerSection) {
        return `# ${jobTitle}岗位需求报告

> 说明：LLM 调用失败（${message}），以下内容由系统自动抓取的招聘官网信息直接整理。

${careerSection}`;
    }

    const categoryLine = jobCategory && jobCategory !== jobTitle
        ? `目标岗位类型为 ${jobCategory}，具体岗位为 ${jobTitle}。`
        : `目标岗位为 ${jobTitle}。`;

    return `# ${jobTitle}岗位需求报告

> 生成说明：LLM 调用失败，以下报告由本地岗位知识库降级生成。失败原因：${message}

## 岗位搜索概览

本次搜索面向计算机专业研究生，${categoryLine}由于在线 LLM 接口不可用，本报告仅基于本地 RAG 召回内容生成。

## 附：本地 RAG 召回片段

\`\`\`md
${context.slice(0, 3000)}
\`\`\`
`;
}

function extractCareerSection(context: string): string {
    const marker = '## 自动检索的公开招聘官网岗位信息';
    if (!context.includes(marker)) {
        return '';
    }

    const start = context.indexOf(marker);
    const rest = context.slice(start);
    const end = rest.indexOf('\n\n---\n\n');
    return end >= 0 ? rest.slice(0, end).trim() : rest.trim();
}

function truncateContext(context: string, maxChars = 10000): string {
    if (context.length <= maxChars) {
        return context;
    }

    return `${context.slice(0, maxChars)}\n\n[上下文已截断以适配 LLM 输入长度限制]`;
}

function sanitizeErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/https?:\/\/\S+/g, '[redacted-url]');
}