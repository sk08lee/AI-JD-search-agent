import fs from 'fs';
import path from 'path';
import { attachStructuredJobFields, isValidJobListing, passesInternshipFilter } from './careerJobFields.js';
import { buildValidationOptions } from './careerJobValidation.js';
import { matchesPortalJobKeyword } from './careerKeywordMatch.js';
import {
    dedupeJobsGlobally,
    formatJobListings,
    searchPortalJobs,
    type CareerJobListing,
    type PortalSearchConfig
} from './careerJobSearch.js';
import { isPlaywrightFetchEnabled } from './playwrightFetcher.js';
import { fetchJobsWithAgentFallback, isAgentFallbackEnabled } from './careerAgentFallback.js';

export interface CareerPortal {
    company: string;
    label?: string;
    channel?: 'internship' | 'campus' | 'unified' | 'experienced' | 'social';
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
    fetchMode: 'html' | 'playwright' | 'agent-fallback';
    jobs: CareerJobListing[];
    excerpt?: string;
    error?: string;
    search?: PortalSearchConfig;
}

const DEFAULT_MAX_SOURCES = 11;

export function loadCareerPortals(): CareerPortal[] {
    const filePath = path.join(process.cwd(), 'knowledge', 'sources', 'career_portals.json');
    if (!fs.existsSync(filePath)) {
        return [];
    }

    try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CareerPortal[];
        if (!Array.isArray(raw)) {
            return [];
        }

        const internshipOnly = process.env.CAREER_INTERNSHIP_ONLY !== '0';
        if (!internshipOnly) {
            return raw;
        }

        return raw.filter((portal) => portal.channel === 'internship');
    } catch {
        console.warn('[CareerFetch] Failed to parse career_portals.json');
        return [];
    }
}

export function selectOnePortalPerCompany(portals: CareerPortal[]): CareerPortal[] {
    const byCompany = new Map<string, CareerPortal[]>();

    for (const portal of portals) {
        const list = byCompany.get(portal.company) ?? [];
        list.push(portal);
        byCompany.set(portal.company, list);
    }

    const companyOrder: string[] = [];
    for (const portal of portals) {
        if (!companyOrder.includes(portal.company)) {
            companyOrder.push(portal.company);
        }
    }

    return companyOrder.map((company) => {
        const companyPortals = byCompany.get(company) ?? [];
        const internPortal = companyPortals.find((portal) => portal.channel === 'internship');
        return internPortal || companyPortals[0];
    }).filter((portal): portal is CareerPortal => !!portal);
}

export function selectPortalTargets(portals: CareerPortal[], maxSources: number): CareerPortal[] {
    const onePerCompany = selectOnePortalPerCompany(portals);
    const ensureAllCompanies = process.env.CAREER_FETCH_ENSURE_ALL_COMPANIES !== '0';

    if (ensureAllCompanies) {
        if (maxSources > 0 && maxSources < onePerCompany.length) {
            console.warn(
                `[CareerFetch] CAREER_FETCH_MAX_SOURCES=${maxSources} 小于公司数 ${onePerCompany.length}，已优先保证每家公司至少搜索 1 个入口`
            );
        }
        return onePerCompany;
    }

    return onePerCompany.slice(0, maxSources > 0 ? maxSources : onePerCompany.length);
}

export function buildPortalTargets(
    portals: CareerPortal[],
    keyword: string,
    maxSources: number
): Array<CareerPortal & { targetUrl: string }> {
    return selectPortalTargets(portals, maxSources).map((portal) => {
        const searchKeyword = portal.search?.listSearchKeyword?.trim() || keyword.trim();
        const encoded = encodeURIComponent(searchKeyword);
        return {
            ...portal,
            targetUrl: (portal.searchUrl || portal.url).replace(/\{keyword\}/g, encoded)
        };
    });
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
    console.log(`[CareerFetch] keyword="${keyword}" searching ${targets.length} companies: ${targets.map((t) => t.company).join('、')}`);
    const results: CareerFetchResult[] = [];

    for (const target of targets) {
        results.push(await searchPortal(target, keyword));
    }

    return aggregateCareerResults(results, keyword);
}

export function aggregateCareerResults(results: CareerFetchResult[], keyword: string): CareerFetchResult[] {
    const maxTotal = Number(process.env.CAREER_JOB_MAX_TOTAL_RESULTS || 20);
    const pool: CareerJobListing[] = [];

    for (const result of results) {
        const validation = buildValidationOptions(result.search);
        const validJobs = result.jobs
            .map(attachStructuredJobFields)
            .filter((job) => isValidJobListing(job, validation))
            .filter((job) => passesInternshipFilter(job))
            .filter((job) => matchesPortalJobKeyword(
                `${job.title} ${job.summary} ${job.requirements || ''}`,
                keyword,
                result.search
            ))
            .map((job) => ({
                ...job,
                company: job.company || result.company,
                sourceLabel: job.sourceLabel || result.label
            }));

        for (const job of validJobs) {
            pool.push(job);
        }
    }

    const deduped = dedupeJobsGlobally(pool, keyword, maxTotal);
    const grouped = new Map<string, CareerFetchResult>();

    for (const job of deduped) {
        const matchedSource = results.find((item) =>
            item.company === job.company && (item.label || '') === (job.sourceLabel || '')
        ) || results.find((item) => item.company === job.company);

        const groupKey = matchedSource
            ? `${matchedSource.company}::${matchedSource.label || ''}::${matchedSource.url}`
            : `${job.company || '未知公司'}::::`;

        if (!grouped.has(groupKey)) {
            grouped.set(groupKey, {
                company: matchedSource?.company || job.company || '未知公司',
                label: matchedSource?.label || job.sourceLabel,
                url: matchedSource?.url || job.detailUrl,
                status: 'success',
                fetchMode: matchedSource?.fetchMode || 'playwright',
                jobs: [],
                search: matchedSource?.search
            });
        }

        grouped.get(groupKey)!.jobs.push(job);
    }

    return Array.from(grouped.values());
}

export function formatCareerFetchContext(results: CareerFetchResult[], keyword: string, jobCategory?: string): string {
    const matchedSources = results.filter((item) => item.jobs.length > 0);
    if (matchedSources.length === 0) {
        return '';
    }

    const categoryLine = jobCategory?.trim()
        ? `岗位类型：实习；方向：${jobCategory.trim()}；搜索关键词：${keyword}`
        : `岗位类型：实习；搜索关键词：${keyword}`;

    const totalJobs = matchedSources.reduce((count, item) => count + item.jobs.length, 0);

    const sections: string[] = [
        '## 自动检索的公开招聘官网实习岗位信息',
        categoryLine,
        `共检索到 ${totalJobs} 条实习岗位信息（全源去重后，仅展示匹配岗位数大于 0 的公司）。`,
        '每个岗位仅保留：招聘条件 / 招聘要求 / 岗位要求；且岗位名称须含「实习」。'
    ];

    for (const item of matchedSources) {
        const title = item.label ? `${item.company} - ${item.label}` : item.company;
        const validation = buildValidationOptions(item.search);
        const listings = formatJobListings(item.jobs, validation);
        if (listings) {
            sections.push(`### ${title}\n\n${listings}`);
        }
    }

    return sections.join('\n\n');
}

async function searchPortal(target: CareerPortal & { targetUrl: string }, keyword: string): Promise<CareerFetchResult> {
    const fetchMode = target.fetchMode === 'html' ? 'html' : 'playwright';

    if (fetchMode === 'playwright' && !isPlaywrightFetchEnabled()) {
        const fallbackOnly = await tryAgentFallback(target, keyword, {
            playwrightError: 'Playwright 抓取已关闭，无法进入动态招聘页搜索岗位'
        });
        if (fallbackOnly) {
            return fallbackOnly;
        }

        return {
            company: target.company,
            label: target.label,
            url: target.targetUrl,
            status: 'failed',
            fetchMode: 'playwright',
            jobs: [],
            search: target.search,
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
            search: target.search,
            company: target.company,
            sourceLabel: target.label
        });

        if (searchResult.jobs.length === 0) {
            const fallbackResult = await tryAgentFallback(target, keyword, {
                searchUrl: searchResult.searchUrl,
                pageSummary: searchResult.pageSummary,
                pageHtml: searchResult.pageHtml,
                playwrightError: searchResult.error
            });
            if (fallbackResult) {
                return fallbackResult;
            }
        }

        if (searchResult.error && searchResult.jobs.length === 0) {
            return {
                company: target.company,
                label: target.label,
                url: searchResult.searchUrl,
                status: 'failed',
                fetchMode,
                jobs: [],
                search: target.search,
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
            search: target.search,
            excerpt: searchResult.pageSummary
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const fallbackResult = await tryAgentFallback(target, keyword, {
            playwrightError: message
        });
        if (fallbackResult) {
            return fallbackResult;
        }

        return {
            company: target.company,
            label: target.label,
            url: target.targetUrl,
            status: 'failed',
            fetchMode,
            jobs: [],
            search: target.search,
            error: message
        };
    }
}

async function tryAgentFallback(
    target: CareerPortal & { targetUrl: string },
    keyword: string,
    context: {
        searchUrl?: string;
        pageSummary?: string;
        pageHtml?: string;
        playwrightError?: string;
    }
): Promise<CareerFetchResult | null> {
    if (!isAgentFallbackEnabled()) {
        return null;
    }

    console.log(`[CareerFetch] ${target.company} Playwright 无结果，尝试 Agent fallback...`);
    const fallbackJobs = await fetchJobsWithAgentFallback({
        company: target.company,
        label: target.label,
        keyword,
        searchUrl: context.searchUrl || target.targetUrl,
        landingUrl: target.url,
        pageSummary: context.pageSummary,
        pageHtml: context.pageHtml,
        search: target.search,
        sourceLabel: target.label,
        playwrightError: context.playwrightError
    });

    if (fallbackJobs.length === 0) {
        console.log(`[CareerFetch] ${target.company} Agent fallback 未找到有效岗位`);
        return null;
    }

    console.log(`[CareerFetch] ${target.company} Agent fallback 找到 ${fallbackJobs.length} 条候选岗位`);
    return {
        company: target.company,
        label: target.label,
        url: context.searchUrl || target.targetUrl,
        status: 'success',
        fetchMode: 'agent-fallback',
        jobs: fallbackJobs,
        search: target.search,
        excerpt: 'Agent fallback via Fetch MCP'
    };
}
