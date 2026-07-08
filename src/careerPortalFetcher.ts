import fs from 'fs';
import path from 'path';
import iconv from 'iconv-lite';
import { fetchPageWithPlaywright, isPlaywrightFetchEnabled } from './playwrightFetcher.js';

export interface CareerPortal {
    company: string;
    label?: string;
    channel?: 'unified' | 'campus' | 'experienced' | 'social';
    url: string;
    searchUrl?: string;
    fetchMode?: 'html' | 'playwright';
    waitMs?: number;
}

export interface CareerFetchOptions {
    jobTitle: string;
    jobCategory?: string;
}

export interface CareerFetchResult {
    company: string;
    label?: string;
    url: string;
    status: 'success' | 'failed';
    fetchMode: 'html' | 'playwright';
    excerpt?: string;
    error?: string;
}

const DEFAULT_MAX_SOURCES = 16;
const FETCH_TIMEOUT_MS = 15000;
const MAX_EXCERPT_CHARS = 6000;

export function loadCareerPortals(): CareerPortal[] {
    const filePath = path.join(process.cwd(), 'knowledge', 'sources', 'career_portals.json');
    if (!fs.existsSync(filePath)) {
        return [];
    }

    try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CareerPortal[];
        return Array.isArray(raw) ? raw : [];
    } catch {
        console.warn('[CareerFetch] Failed to parse career_portals.json');
        return [];
    }
}

export function selectPortalTargets(portals: CareerPortal[], maxSources: number): CareerPortal[] {
    const channelOrder = ['campus', 'unified', 'social', 'experienced'];
    const selected: CareerPortal[] = [];
    const used = new Set<string>();

    for (const channel of channelOrder) {
        for (const portal of portals) {
            if (selected.length >= maxSources) {
                return selected;
            }

            const key = `${portal.company}:${portal.url}`;
            const portalChannel = portal.channel || 'unified';
            if (portalChannel === channel && !used.has(key)) {
                selected.push(portal);
                used.add(key);
            }
        }
    }

    for (const portal of portals) {
        if (selected.length >= maxSources) {
            break;
        }

        const key = `${portal.company}:${portal.url}`;
        if (!used.has(key)) {
            selected.push(portal);
            used.add(key);
        }
    }

    return selected;
}

export function buildPortalTargets(portals: CareerPortal[], keyword: string, maxSources: number): Array<CareerPortal & { targetUrl: string }> {
    const encoded = encodeURIComponent(keyword.trim());
    return selectPortalTargets(portals, maxSources).map((portal) => ({
        ...portal,
        targetUrl: (portal.searchUrl || portal.url).replace(/\{keyword\}/g, encoded)
    }));
}

export async function fetchCareerPortalPages(options: CareerFetchOptions): Promise<CareerFetchResult[]> {
    if (process.env.ENABLE_AUTO_CAREER_FETCH === '0') {
        return [];
    }

    const keyword = options.jobTitle.trim();
    if (!keyword) {
        return [];
    }

    const maxSources = Number(process.env.CAREER_FETCH_MAX_SOURCES || DEFAULT_MAX_SOURCES);
    const portals = loadCareerPortals();
    if (portals.length === 0) {
        return [];
    }

    const targets = buildPortalTargets(portals, keyword, maxSources);
    const htmlTargets = targets.filter((target) => target.fetchMode !== 'playwright');
    const playwrightTargets = targets.filter((target) => target.fetchMode === 'playwright');

    const htmlResults = await Promise.all(
        htmlTargets.map((target) => fetchHtmlPortal(target.company, target.targetUrl, target.label))
    );

    const playwrightResults: CareerFetchResult[] = [];
    if (playwrightTargets.length > 0 && isPlaywrightFetchEnabled()) {
        for (const target of playwrightTargets) {
            playwrightResults.push(
                await fetchPlaywrightPortal(target.company, target.targetUrl, target.waitMs || 5000, target.label)
            );
        }
    } else if (playwrightTargets.length > 0) {
        for (const target of playwrightTargets) {
            playwrightResults.push({
                company: target.company,
                label: target.label,
                url: target.targetUrl,
                status: 'failed',
                fetchMode: 'playwright',
                error: 'Playwright 抓取已关闭，无法渲染动态页面'
            });
        }
    }

    return [...htmlResults, ...playwrightResults];
}

export function formatCareerFetchContext(results: CareerFetchResult[], keyword: string, jobCategory?: string): string {
    if (results.length === 0) {
        return '';
    }

    const categoryLine = jobCategory?.trim()
        ? `岗位类型：${jobCategory.trim()}；搜索关键词：${keyword}`
        : `搜索关键词：${keyword}`;

    const successes = results.filter((item) => item.status === 'success' && item.excerpt);
    const failures = results.filter((item) => item.status === 'failed');

    const sections: string[] = [
        '## 自动抓取的公开招聘官网内容',
        categoryLine,
        '说明：搜索关键词仅使用“具体岗位名称”，不包含岗位类型前缀。'
    ];

    if (successes.length > 0) {
        sections.push('以下内容为系统自动从公开招聘官网预抓取，请优先引用这些来源：');
        for (const item of successes) {
            const title = item.label ? `${item.company} - ${item.label}` : item.company;
            sections.push(`### ${title}\n- 来源：${item.url}\n- 抓取方式：${item.fetchMode}\n\n${item.excerpt}`);
        }
    }

    if (failures.length > 0) {
        sections.push('### 未能抓取的来源');
        for (const item of failures) {
            const title = item.label ? `${item.company} - ${item.label}` : item.company;
            sections.push(`- ${title}（${item.url}，${item.fetchMode}）：${item.error || '来源不可访问'}`);
        }
    }

    return sections.join('\n\n');
}

async function fetchHtmlPortal(company: string, url: string, label?: string): Promise<CareerFetchResult> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9'
            },
            redirect: 'follow'
        });

        clearTimeout(timeout);

        if (!response.ok) {
            return {
                company,
                label,
                url,
                status: 'failed',
                fetchMode: 'html',
                error: `HTTP ${response.status}`
            };
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const html = decodeHtmlBuffer(buffer, response.headers.get('content-type') || '');
        const excerpt = htmlToText(html).slice(0, MAX_EXCERPT_CHARS);

        if (!excerpt || excerpt.length < 80) {
            return {
                company,
                label,
                url,
                status: 'failed',
                fetchMode: 'html',
                error: '页面内容过少，可能为动态渲染页面'
            };
        }

        return {
            company,
            label,
            url,
            status: 'success',
            fetchMode: 'html',
            excerpt
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            company,
            label,
            url,
            status: 'failed',
            fetchMode: 'html',
            error: message.includes('abort') ? '请求超时' : message
        };
    }
}

async function fetchPlaywrightPortal(company: string, url: string, waitMs: number, label?: string): Promise<CareerFetchResult> {
    try {
        const text = await fetchPageWithPlaywright(url, waitMs);
        const excerpt = text.slice(0, MAX_EXCERPT_CHARS);

        if (!excerpt || excerpt.length < 80) {
            return {
                company,
                label,
                url,
                status: 'failed',
                fetchMode: 'playwright',
                error: '渲染后页面内容过少'
            };
        }

        return {
            company,
            label,
            url,
            status: 'success',
            fetchMode: 'playwright',
            excerpt
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            company,
            label,
            url,
            status: 'failed',
            fetchMode: 'playwright',
            error: message
        };
    }
}

function decodeHtmlBuffer(buffer: Buffer, contentType: string): string {
    const headerCharset = contentType.match(/charset=([^;]+)/i)?.[1]?.trim().toLowerCase();
    const htmlHead = buffer.toString('utf8', 0, Math.min(buffer.length, 4096));
    const metaCharset = htmlHead.match(/<meta[^>]+charset=["']?([^"'\s>]+)/i)?.[1]?.toLowerCase();
    const charset = normalizeCharset(headerCharset || metaCharset || 'utf-8');

    if (charset === 'utf-8' || charset === 'utf8') {
        return buffer.toString('utf8');
    }

    try {
        return iconv.decode(buffer, charset);
    } catch {
        return buffer.toString('utf8');
    }
}

function normalizeCharset(charset: string): string {
    if (charset.includes('gbk') || charset.includes('gb2312') || charset.includes('gb18030')) {
        return 'gbk';
    }
    return charset.replace(/"/g, '');
}

function htmlToText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
}
