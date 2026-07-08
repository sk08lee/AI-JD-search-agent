import 'dotenv/config';
import readline from 'readline';
import MCPClient from "./MCPClient.js";
import Agent from "./Agent.js";
import path from "path";
import EmbeddingRetriever from "./EmbeddingRetriever.js";
import fs from "fs";
import { logTitle } from "./utils.js";
import { commandExists, resolveUvxCommand } from "./commandUtils.js";
import { fetchCareerPortalPages, formatCareerFetchContext } from "./careerPortalFetcher.js";
import { loadConfig } from "./config/index.js";
import { taskTemplates, listTasks, TaskTemplate } from "./tasks/index.js";
import { getReportTemplate } from "./reports/templates.js";

const config = loadConfig();
const outPath = path.join(process.cwd(), config.output.directory);
const knowledgeDir = path.join(process.cwd(), config.knowledge.directory);

const uvxCommand = resolveUvxCommand();
const fetchMCP = new MCPClient("mcp-server-fetch", uvxCommand, ['mcp-server-fetch']);
const fileMCP = new MCPClient("mcp-server-file", "npx", ['-y', '@modelcontextprotocol/server-filesystem', outPath]);

async function main() {
    fs.mkdirSync(outPath, { recursive: true });

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log('\n========================================');
    console.log('         通用岗位搜索助手');
    console.log('========================================\n');

    const tasks = listTasks();
    console.log('请选择任务类型：');
    tasks.forEach((task, index) => {
        console.log(`${index + 1}. [${task.id}] ${task.name} - ${task.description}`);
    });
    console.log(`${tasks.length + 1}. 自定义任务`);

    const choice = await question(rl, '\n请输入序号：');
    const choiceIndex = parseInt(choice) - 1;

    let template: TaskTemplate;
    if (choiceIndex >= 0 && choiceIndex < tasks.length) {
        template = taskTemplates[tasks[choiceIndex].id];
    } else {
        const customName = await question(rl, '请输入自定义岗位名称：');
        template = {
            id: 'custom',
            name: `${customName}岗位搜索`,
            description: `搜索 ${customName} 岗位需求`,
            systemPrompt: `你是一个严谨的求职研究助手。你需要区分事实、推断和建议。
涉及岗位信息时，优先引用公开来源或本地知识库内容；如果信息不足，明确提醒用户补充来源。`,
            userPrompt: `你是一个 AI Agent 岗位搜索助手，目标用户是一名计算机专业在读研究生，正在准备投递 {jobTitle} 相关岗位。

请优先结合我提供的本地 context，并在 fetch 工具可用时读取公开可访问的公司招聘官网或公开招聘页面，整理"{jobTitle}"相关岗位需求。

请把岗位按三类组织：
1. 实习 internship
2. 校招 campus
3. 社招 experienced

请输出一份中文 Markdown 岗位需求报告，保存到 {reportPath}。

报告必须包含：
- 岗位搜索概览
- 实习 / 校招 / 社招岗位差异
- 高频能力要求
- 高频技术关键词
- 常见项目经历要求
- 对计算机研究生的简历优化建议
- 可作为简历包装的匹配点
- 信息来源或待补充来源

不要编造具体公司正在招聘的岗位。如果无法读取某个来源，请明确标注"来源不可访问 / 需要人工补充"。`,
            reportTemplate: 'job-demand-report',
            knowledgeBaseDir: 'knowledge/jobs/general'
        };
    }

    const jobTitle = await question(rl, '\n请输入具体岗位名称（默认使用任务名称）：') || template.name.replace('岗位搜索', '');
    
    rl.close();

    console.log(`\n开始搜索 "${jobTitle}" 岗位需求...\n`);

    const reportFileName = `${template.id}-job-demand-report.md`;
    const reportPath = path.join(outPath, reportFileName);

    const ragContext = await retrieveContext(template.knowledgeBaseDir);
    const careerResults = await fetchCareerPortalPages(jobTitle);
    const webContext = formatCareerFetchContext(careerResults);
    const context = [ragContext, webContext].filter(Boolean).join('\n\n---\n\n');

    if (careerResults.length > 0) {
        const successCount = careerResults.filter((item) => item.status === 'success').length;
        console.log(`[CareerFetch] fetched ${successCount}/${careerResults.length} career portal pages for "${jobTitle}"`);
    }

    const model = config.llm.model;
    const systemPrompt = template.systemPrompt;

    const enableFetchMCP = config.tools.enableFetch;
    const canUseFetchMCP = enableFetchMCP && commandExists(uvxCommand);
    const mcpClients = canUseFetchMCP ? [fetchMCP, fileMCP] : [fileMCP];

    if (!enableFetchMCP) {
        console.warn('[MCP degraded] Fetch MCP is disabled. Set ENABLE_FETCH_MCP=1 to enable public webpage fetching.');
    } else if (!canUseFetchMCP) {
        console.warn(`[MCP degraded] uvx command not found (${uvxCommand}), skipping Fetch MCP. The report will use local RAG context.`);
    }

    const agent = new Agent(model, mcpClients, systemPrompt, context);
    let response = '';

    try {
        await agent.init();
        const userPrompt = template.userPrompt
            .replace('{jobTitle}', jobTitle)
            .replace('{reportPath}', reportPath);
        response = await agent.invoke(userPrompt);
    } catch (e: any) {
        console.warn(`[LLM degraded] ${sanitizeErrorMessage(e)}`);
        const reportTemplate = getReportTemplate(template.reportTemplate);
        response = reportTemplate?.fallback(context, e, jobTitle) || buildGenericFallbackReport(context, e, jobTitle);
    } finally {
        await agent.close();
    }

    if (!fs.existsSync(reportPath) && response) {
        fs.writeFileSync(reportPath, response, 'utf-8');
        console.warn(`\n[Fallback write] Report saved directly to ${reportPath}`);
    }

    console.log(`\n========================================`);
    console.log(`报告已生成：${reportFileName}`);
    console.log(`路径：${reportPath}`);
    console.log('========================================');
}

function question(rl: readline.Interface, prompt: string): Promise<string> {
    return new Promise(resolve => rl.question(prompt, resolve));
}

main();

async function retrieveContext(knowledgeBaseDir: string) {
    const fullPath = path.join(knowledgeDir, knowledgeBaseDir);
    const embeddingRetriever = new EmbeddingRetriever(config.embedding.model);
    const files = collectMarkdownFiles(fullPath);

    if (files.length === 0) {
        console.warn(`[RAG] No knowledge base files found in ${fullPath}, searching general knowledge...`);
        const generalPath = path.join(knowledgeDir, 'jobs', 'general');
        const generalFiles = collectMarkdownFiles(generalPath);
        if (generalFiles.length === 0) {
            console.warn(`[RAG] No general knowledge base found either, proceeding without RAG context`);
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
    logTitle('CONTEXT');
    console.log(context);
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

function buildGenericFallbackReport(context: string, error: unknown, jobTitle: string): string {
    const message = sanitizeErrorMessage(error);
    return `# ${jobTitle}岗位需求报告

> 生成说明：LLM 调用失败，以下报告由本地岗位知识库降级生成。失败原因：${message}

## 1. 岗位搜索概览

本次搜索面向计算机专业研究生，目标岗位为${jobTitle}。由于在线 LLM 接口不可用，本报告仅基于本地 RAG 召回内容生成。

## 2. 实习 / 校招 / 社招岗位差异

### 实习 internship

- 更关注学习能力、基础能力、工具使用经验和项目实践。
- 常见任务包括参与项目、文档整理和基础工作。
- 具备相关技术基础或项目经历会加分。

### 校招 campus

- 更关注完整项目经历、技术理解能力和团队协作潜力。
- 需要能独立完成任务、方案设计和问题排查。
- 相关专业背景有优势。

### 社招 experienced

- 更关注业务落地、系统设计和领导力。
- 需要理解复杂系统架构、技术选型和团队管理。
- 通常要求有完整项目经验。

## 3. 高频能力要求

- 专业技能
- 问题解决
- 团队协作
- 学习能力
- 技术文档

## 4. 高频技术关键词

根据岗位类型有所不同，通常包括数据结构、算法、数据库、网络等基础技能。

## 5. 常见项目经历要求

- 有完整项目开发或实践经历。
- 能说明技术方案如何解决实际问题。
- 能输出技术文档和代码。

## 6. 简历优化建议

- 将项目经历转化为具体成果。
- 强调技术深度和广度。
- 突出"问题 - 方案 - 实现 - 优化"的完整思路。

## 7. 信息来源

- 已使用：本地岗位知识库。
- 当前限制：LLM API 调用失败，未执行在线信息抽取。

## 附：本地 RAG 召回片段

\`\`\`md
${context}
\`\`\`
`;
}

function sanitizeErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/https?:\/\/\S+/g, '[redacted-url]');
}