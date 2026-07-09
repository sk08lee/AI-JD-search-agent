import fs from 'fs';
import path from 'path';
import { attachStructuredJobFields, isValidJobListing } from './careerJobFields.js';
import { formatJobListings, searchPortalJobs, type CareerJobListing, type PortalSearchConfig } from './careerJobSearch.js';
import { isPlaywrightFetchEnabled } from './playwrightFetcher.js';

export interface CareerPortal {
    company: string;
    label?: string;
    channel?: 'unified' | 'campus' | 'experienced' | 'social';
    url: string;
    searchUrl?: string;
    fetchMode?: 'html' | 'playwright';
    waitMs?: number;
    search?: PortalSearchConfig;
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
    jobs: CareerJobListing[];
    excerpt?: string;
    error?: string;
}

const DEFAULT_MAX_SOURCES = 10;

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
    const results: CareerFetchResult[] = [];

    for (const target of targets) {
        results.push(await searchPortal(target, keyword));
    }

    return results;
}

export function formatCareerFetchContext(results: CareerFetchResult[], keyword: string, jobCategory?: string): string {
    const matchedSources = results
        .map((item) => ({
            ...item,
            jobs: item.jobs.map(attachStructuredJobFields).filter(isValidJobListing)
        }))
        .filter((item) => item.jobs.length > 0);

    if (matchedSources.length === 0) {
        return '';
    }

    const categoryLine = jobCategory?.trim()
        ? `岗位类型：${jobCategory.trim()}；搜索关键词：${keyword}`
        : `搜索关键词：${keyword}`;

    const totalJobs = matchedSources.reduce((count, item) => count + item.jobs.length, 0);

    const sections: string[] = [
        '## 自动检索的公开招聘官网岗位信息',
        categoryLine,
        `共检索到 ${totalJobs} 条具体岗位信息（仅展示匹配岗位数大于 0 的公司）。`,
        '每个岗位仅保留：招聘条件 / 招聘要求 / 岗位要求。'
    ];

    for (const item of matchedSources) {
        const title = item.label ? `${item.company} - ${item.label}` : item.company;
        const listings = formatJobListings(item.jobs);
        if (listings) {
            sections.push(`### ${title}\n\n${listings}`);
        }
    }

    return sections.join('\n\n');
}

async function searchPortal(target: CareerPortal & { targetUrl: string }, keyword: string): Promise<CareerFetchResult> {
    const fetchMode = target.fetchMode || 'html';

    if (fetchMode === 'playwright' && !isPlaywrightFetchEnabled()) {
        return {
            company: target.company,
            label: target.label,
            url: target.targetUrl,
            status: 'failed',
            fetchMode: 'playwright',
            jobs: [],
            error: 'Playwright 抓取已关闭，无法进入动态招聘页搜索岗位'
        };
    }

    try {
        const searchResult = await searchPortalJobs({
            searchUrl: target.targetUrl,
            landingUrl: target.url,
            keyword,
            fetchMode,
            waitMs: target.waitMs || 5000,
            search: target.search
        });

        if (searchResult.error && searchResult.jobs.length === 0) {
            return {
                company: target.company,
                label: target.label,
                url: searchResult.searchUrl,
                status: 'failed',
                fetchMode,
                jobs: [],
                error: searchResult.error
            };
        }

        return {
            company: target.company,
            label: target.label,
            url: searchResult.searchUrl,
            status: 'success',
            fetchMode,
            jobs: searchResult.jobs,
            excerpt: searchResult.pageSummary
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            company: target.company,
            label: target.label,
            url: target.targetUrl,
            status: 'failed',
            fetchMode,
            jobs: [],
            error: message
        };
    }
}
