import Agent from './Agent.js';
import MCPClient from './MCPClient.js';
import { loadConfig } from './config/index.js';
import { commandExists, resolveUvxCommand } from './commandUtils.js';
import { attachStructuredJobFields } from './careerJobFields.js';
import { getListSearchKeyword } from './careerKeywordMatch.js';
import type { CareerJobListing, PortalSearchConfig } from './careerJobSearch.js';

export interface AgentFallbackOptions {
    company: string;
    label?: string;
    keyword: string;
    searchUrl: string;
    landingUrl: string;
    pageSummary?: string;
    pageHtml?: string;
    search?: PortalSearchConfig;
    sourceLabel?: string;
    playwrightError?: string;
}

const AGENT_FALLBACK_SYSTEM_PROMPT = `你是一个严谨的招聘网页解析助手。你的任务是从公司实习招聘页面中提取真实岗位信息。

规则（必须遵守）：
1. 只能使用 fetch 工具读取用户提供的公开 URL，不得编造未访问过的链接。
2. 只保留岗位名称含「实习」的实习岗位（如日常实习、实习生）。
3. 每条岗位必须包含：title（岗位名称）、detailUrl（详情页完整 URL）、requirements（招聘条件原文，≥20字）。
4. 最终回复必须是纯 JSON 数组，不要 Markdown 说明，格式：
[{"title":"...","detailUrl":"https://...","requirements":"..."}]
5. 若页面是 SPA 或 fetch 内容不完整，可结合用户提供的 Playwright 页面摘要/HTML 片段中的链接继续 fetch 详情页。
6. 不要输出社招/校招全职岗位；不要猜测不存在的 postid 或 jobId。`;

export function isAgentFallbackEnabled(): boolean {
    if (process.env.ENABLE_FETCH_MCP !== '1') {
        return false;
    }
    if (process.env.CAREER_AGENT_FALLBACK === '0') {
        return false;
    }
    return commandExists(resolveUvxCommand());
}

export async function fetchJobsWithAgentFallback(options: AgentFallbackOptions): Promise<CareerJobListing[]> {
    if (!isAgentFallbackEnabled()) {
        return [];
    }

    const config = loadConfig();
    const uvxCommand = resolveUvxCommand();
    const fetchMCP = new MCPClient('mcp-server-fetch', uvxCommand, ['mcp-server-fetch']);
    const listKeyword = getListSearchKeyword(options.keyword, options.search?.listSearchKeyword);
    const maxJobs = Number(process.env.CAREER_JOB_MAX_RESULTS || 5);
    const htmlMaxChars = Number(process.env.CAREER_AGENT_HTML_MAX_CHARS || 12000);
    const pageHtmlSnippet = options.pageHtml?.slice(0, htmlMaxChars) || '';

    const userPrompt = buildAgentFallbackPrompt({
        ...options,
        listKeyword,
        maxJobs,
        pageHtmlSnippet
    });

    const agent = new Agent(
        config.llm.model,
        [fetchMCP],
        AGENT_FALLBACK_SYSTEM_PROMPT
    );

    try {
        await agent.init();
        const response = await runAgentWithToolLoop(agent, userPrompt);
        const parsed = parseAgentJobListings(response);
        return normalizeAgentJobs(parsed, options, maxJobs);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[CareerFetch][AgentFallback] ${options.company} failed: ${message}`);
        return [];
    } finally {
        await agent.close();
    }
}

function buildAgentFallbackPrompt(input: AgentFallbackOptions & {
    listKeyword: string;
    maxJobs: number;
    pageHtmlSnippet: string;
}): string {
    const lines = [
        `公司：${input.company}`,
        `搜索关键词：${input.keyword}`,
        `列表搜索词：${input.listKeyword}`,
        `实习入口：${input.landingUrl}`,
        `搜索页：${input.searchUrl}`,
        `最多返回 ${input.maxJobs} 条有效实习岗位。`,
        '',
        '请先用 fetch 打开「搜索页」，必要时再 fetch 「实习入口」。从页面中找到含「实习」且与搜索词相关的岗位详情链接，再 fetch 详情页提取招聘条件。',
        '若 fetch 到的 HTML 不完整，请结合下方 Playwright 已渲染内容中的链接与标题。'
    ];

    if (input.playwrightError) {
        lines.push('', `Playwright 失败原因：${input.playwrightError}`);
    }
    if (input.pageSummary) {
        lines.push('', 'Playwright 页面可见文本摘要：', input.pageSummary.slice(0, 2000));
    }
    if (input.pageHtmlSnippet) {
        lines.push('', 'Playwright 页面 HTML 片段（供提取链接）：', input.pageHtmlSnippet);
    }

    lines.push('', '完成后只输出 JSON 数组，不要其他文字。');
    return lines.join('\n');
}

async function runAgentWithToolLoop(agent: Agent, prompt: string): Promise<string> {
    const maxRounds = Number(process.env.CAREER_AGENT_FALLBACK_MAX_ROUNDS || 6);
    let response = await agent.invokeWithoutClose(prompt);

    for (let round = 0; round < maxRounds && response.toolCalls.length > 0; round++) {
        response = await agent.continueAfterTools(response);
    }

    return response.content;
}

function parseAgentJobListings(text: string): Array<Partial<CareerJobListing>> {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = (fenced?.[1] || text).trim();
    const arrayMatch = candidate.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
        return [];
    }

    try {
        const parsed = JSON.parse(arrayMatch[0]);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function normalizeAgentJobs(
    rawJobs: Array<Partial<CareerJobListing>>,
    options: AgentFallbackOptions,
    maxJobs: number
): CareerJobListing[] {
    const results: CareerJobListing[] = [];
    const seen = new Set<string>();

    for (const raw of rawJobs) {
        const title = typeof raw.title === 'string' ? raw.title.trim() : '';
        const detailUrl = typeof raw.detailUrl === 'string' ? raw.detailUrl.trim() : '';
        const requirements = typeof raw.requirements === 'string' ? raw.requirements.trim() : '';

        if (!title || !detailUrl || !requirements || requirements.length < 20) {
            continue;
        }
        if (!/^https?:\/\//i.test(detailUrl)) {
            continue;
        }
        if (!/实习/.test(title)) {
            continue;
        }
        if (seen.has(detailUrl)) {
            continue;
        }
        seen.add(detailUrl);

        results.push(attachStructuredJobFields({
            title,
            detailUrl,
            summary: requirements.slice(0, 300),
            requirements,
            detailExcerpt: requirements,
            company: options.company,
            sourceLabel: options.sourceLabel || options.label
        }));

        if (results.length >= maxJobs) {
            break;
        }
    }

    return results;
}
