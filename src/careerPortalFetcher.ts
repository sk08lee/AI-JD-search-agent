import fs from 'fs';
import path from 'path';

export interface CareerPortal {
    company: string;
    url: string;
    searchUrl?: string;
}

export interface CareerFetchResult {
    company: string;
    url: string;
    status: 'success' | 'failed';
    excerpt?: string;
    error?: string;
}

const DEFAULT_MAX_SOURCES = 8;
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

export function buildPortalUrls(portals: CareerPortal[], keyword: string, maxSources: number): { company: string; url: string }[] {
    const encoded = encodeURIComponent(keyword.trim());
    return portals.slice(0, maxSources).map((portal) => ({
        company: portal.company,
        url: (portal.searchUrl || portal.url).replace(/\{keyword\}/g, encoded)
    }));
}

export async function fetchCareerPortalPages(keyword: string): Promise<CareerFetchResult[]> {
    if (process.env.ENABLE_AUTO_CAREER_FETCH === '0') {
        return [];
    }

    const maxSources = Number(process.env.CAREER_FETCH_MAX_SOURCES || DEFAULT_MAX_SOURCES);
    const portals = loadCareerPortals();
    if (portals.length === 0 || !keyword.trim()) {
        return [];
    }

    const targets = buildPortalUrls(portals, keyword, maxSources);
    const results = await Promise.all(targets.map((target) => fetchSinglePortal(target.company, target.url)));
    return results;
}

export function formatCareerFetchContext(results: CareerFetchResult[]): string {
    const successes = results.filter((item) => item.status === 'success' && item.excerpt);
    const failures = results.filter((item) => item.status === 'failed');

    if (results.length === 0) {
        return '';
    }

    const sections: string[] = ['## 自动抓取的公开招聘官网内容'];

    if (successes.length > 0) {
        sections.push('以下内容为系统自动从公开招聘官网预抓取，请优先引用这些来源：');
        for (const item of successes) {
            sections.push(`### ${item.company}\n- 来源：${item.url}\n\n${item.excerpt}`);
        }
    }

    if (failures.length > 0) {
        sections.push('### 未能抓取的来源');
        for (const item of failures) {
            sections.push(`- ${item.company}（${item.url}）：${item.error || '来源不可访问'}`);
        }
    }

    return sections.join('\n\n');
}

async function fetchSinglePortal(company: string, url: string): Promise<CareerFetchResult> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; AI-Job-Agent/1.0; +https://github.com/sk08lee/AI-JD-search-agent)',
                'Accept': 'text/html,application/xhtml+xml'
            },
            redirect: 'follow'
        });

        clearTimeout(timeout);

        if (!response.ok) {
            return {
                company,
                url,
                status: 'failed',
                error: `HTTP ${response.status}`
            };
        }

        const html = await response.text();
        const excerpt = htmlToText(html).slice(0, MAX_EXCERPT_CHARS);

        if (!excerpt) {
            return {
                company,
                url,
                status: 'failed',
                error: '页面内容为空'
            };
        }

        return {
            company,
            url,
            status: 'success',
            excerpt
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            company,
            url,
            status: 'failed',
            error: message.includes('abort') ? '请求超时' : message
        };
    }
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
