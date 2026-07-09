import MCPClient from "./MCPClient.js";
import Agent from "./Agent.js";
import EmbeddingRetriever from "./EmbeddingRetriever.js";
import { loadConfig } from "./config/index.js";
import { taskTemplates, TaskTemplate } from "./tasks/index.js";
import { requirementsOnlyUserPrompt } from "./tasks/requirementsOnlyPrompt.js";
import { getReportTemplate } from "./reports/templates.js";
import { commandExists, resolveUvxCommand } from "./commandUtils.js";
import { fetchCareerPortalPages } from "./careerPortalFetcher.js";
import { buildMergedReportContext, extractMergedSections } from "./careerContextMerger.js";
import type { CareerJobType } from "./careerJobSearch.js";
import fs from "fs";
import path from "path";

const config = loadConfig();
const knowledgeDir = path.join(process.cwd(), config.knowledge.directory);

export interface GenerateReportOptions {
    jobCategory?: string;
    jobType?: CareerJobType;
    companies?: string[];
}

export async function generateReport(
    taskId: string,
    jobTitle: string,
    jobCategoryOrOptions?: string | GenerateReportOptions,
    options: Omit<GenerateReportOptions, 'jobCategory'> = {}
): Promise<string> {
    const resolvedOptions = typeof jobCategoryOrOptions === 'object'
        ? jobCategoryOrOptions
        : { ...options, jobCategory: jobCategoryOrOptions };
    const hasExplicitCategory = typeof jobCategoryOrOptions === 'object'
        ? !!resolvedOptions.jobCategory
        : typeof jobCategoryOrOptions === 'string' && jobCategoryOrOptions.trim().length > 0;
    const category = resolvedOptions.jobCategory?.trim() || '实习';
    const jobType = normalizeJobType(resolvedOptions.jobType);
    const jobTypeLabel = formatJobType(jobType);
    const searchTarget = hasExplicitCategory ? `${category} · ${jobTitle}` : jobTitle;

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

    const ragQuery = `${category} ${jobTitle} 岗位需求 招聘条件 能力要求 技术栈`;
    const ragContext = await retrieveContext(template.knowledgeBaseDir, ragQuery);
    const careerResults = await fetchCareerPortalPages({
        jobTitle,
        jobCategory: category,
        jobType,
        companies: resolvedOptions.companies
    });
    const mergedContext = buildMergedReportContext({
        ragContext,
        careerResults,
        keyword: jobTitle,
        jobCategory: category,
        jobType,
        jobTypeLabel
    });
    const context = truncateContext(
        mergedContext,
        Number(process.env.CONTEXT_MAX_CHARS || 15000)
    );

    if (careerResults.length > 0) {
        const successCount = careerResults.filter((item) => item.status === 'success').length;
        const jobCount = careerResults.reduce((total, item) => total + item.jobs.length, 0);
        console.log(`[CareerFetch] keyword="${jobTitle}" matched ${jobCount} jobs from ${successCount}/${careerResults.length} sources`);
    }

    const model = config.llm.model;
    const systemPrompt = template.systemPrompt;

    const uvxCommand = resolveUvxCommand();
    const fetchMCP = new MCPClient("mcp-server-fetch", uvxCommand, ['mcp-server-fetch']);

    const enableFetchMCP = config.tools.enableFetch;
    const canUseFetchMCP = enableFetchMCP && commandExists(uvxCommand);
    const mcpClients = canUseFetchMCP ? [fetchMCP] : [];

    const agent = new Agent(model, mcpClients, systemPrompt, context);
    let response = '';

    try {
        await agent.init();
        const userPrompt = template.userPrompt
            .replace(/\{jobCategory\}/g, category)
            .replace(/\{jobTitle\}/g, jobTitle)
            .replace(/\{searchTarget\}/g, searchTarget)
            .replace(/\{jobTypeLabel\}/g, jobTypeLabel);
        response = await agent.invoke(userPrompt);
    } catch (e: any) {
        console.warn(`[LLM degraded] ${sanitizeErrorMessage(e)}`);
        const reportTemplate = getReportTemplate(template.reportTemplate);
        response = reportTemplate?.fallback(context, e, searchTarget) || buildGenericFallbackReport(context, e, searchTarget, category);
    } finally {
        await agent.close();
    }

    return response;
}

function normalizeJobType(jobType: CareerJobType | undefined): CareerJobType {
    if (jobType === 'campus' || jobType === 'experienced' || jobType === 'all') {
        return jobType;
    }
    return 'internship';
}

function formatJobType(jobType: CareerJobType): string {
    switch (jobType) {
        case 'internship':
            return '实习';
        case 'campus':
            return '校招';
        case 'experienced':
            return '社招';
        case 'all':
            return '不限类型';
    }
}

export function listTasks() {
    return Object.entries(taskTemplates).map(([key, template]) => ({
        id: key,
        name: template.name,
        description: template.description
    }));
}

async function retrieveContext(knowledgeBaseDir: string, query: string) {
    const fullPath = path.join(knowledgeDir, knowledgeBaseDir);
    const embeddingRetriever = new EmbeddingRetriever(config.embedding.model);
    const files = collectMarkdownFiles(fullPath);
    const topK = Number(process.env.RAG_TOP_K || 8);

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

    const context = (await embeddingRetriever.retrieve(query, topK)).join('\n\n');
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
    const { webSection, ragSection } = extractMergedSections(context);

    if (webSection || ragSection) {
        const body = [webSection, ragSection].filter(Boolean).join('\n\n');
        return `# ${jobTitle}岗位需求报告

> 说明：LLM 调用失败（${message}），以下内容由系统自动抓取与本地知识库直接整理。

${body}`;
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

function truncateContext(context: string, maxChars = 15000): string {
    if (context.length <= maxChars) {
        return context;
    }

    return `${context.slice(0, maxChars)}\n\n[上下文已截断以适配 LLM 输入长度限制]`;
}

function sanitizeErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/https?:\/\/\S+/g, '[redacted-url]');
}
