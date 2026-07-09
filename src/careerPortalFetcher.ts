import fs from 'fs';
import path from 'path';
import { attachStructuredJobFields, isValidJobListing, passesJobTypeFilter } from './careerJobFields.js';
import { buildValidationOptions } from './careerJobValidation.js';
import { matchesPortalJobKeyword } from './careerKeywordMatch.js';
import {
    dedupeJobsGlobally,
    formatJobListings,
    searchPortalJobs,
    type CareerJobType,
    type CareerJobListing,
    type PortalAdapterKind,
    type PortalSourceStatus,
    type PortalSearchConfig
} from './careerJobSearch.js';
import { isPlaywrightFetchEnabled } from './playwrightFetcher.js';
import { fetchJobsWithAgentFallback, isAgentFallbackEnabled } from './careerAgentFallback.js';

export interface CareerPortal {
    company: string;
    label?: string;
    channel?: 'internship' | 'campus' | 'unified' | 'experienced' | 'social';
    jobType?: CareerJobType;
    adapter?: PortalAdapterKind;
    url: string;
    searchUrl?: string;
    fetchMode?: 'html' | 'playwright';
    waitMs?: number;
    search?: PortalSearchConfig;
}

export interface CareerFetchOptions {
    jobTitle: string;
    jobCategory?: string;
    jobType?: CareerJobType;
    companies?: string[];
}

export interface CareerFetchResult {
    company: string;
    label?: string;
    url: string;
    status: 'success' | 'failed';
    sourceStatus?: PortalSourceStatus;
    fetchMode: 'html' | 'playwright' | 'agent-fallback';
    jobs: CareerJobListing[];
    excerpt?: string;
    error?: string;
    durationMs?: number;
    search?: PortalSearchConfig;
}

export interface PortalTargetFilters {
    companies?: string[];
    jobType?: CareerJobType;
}

const DEFAULT_MAX_SOURCES = 11;

export function loadCareerPortals(includeAllJobTypes = false): CareerPortal[] {
    const filePath = path.join(process.cwd(), 'knowledge', 'sources', 'career_portals.json');
    if (!fs.existsSync(filePath)) {
        return [];
    }

    try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CareerPortal[];
        if (!Array.isArray(raw)) {
            return [];
        }

        const internshipOnly = !includeAllJobTypes && process.env.CAREER_INTERNSHIP_ONLY !== '0';
        if (!internshipOnly) {
            return raw;
        }

        return raw.filter((portal) => getPortalJobType(portal) === 'internship');
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

export function selectPortalTargets(
    portals: CareerPortal[],
    maxSources: number,
    filters: PortalTargetFilters = {}
): CareerPortal[] {
    const filtered = filterPortals(portals, filters);
    const onePerCompany = selectOnePortalPerCompany(filtered);
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
    maxSources: number,
    filters: PortalTargetFilters = {}
): Array<CareerPortal & { targetUrl: string }> {
    return selectPortalTargets(portals, maxSources, filters).map((portal) => {
        const searchKeyword = portal.search?.listSearchKeyword?.trim() || keyword.trim();
        const encoded = encodeURIComponent(searchKeyword);
        const adapter = portal.adapter || portal.search?.adapter;
        return {
            ...portal,
            jobType: getPortalJobType(portal),
            search: {
                ...portal.search,
                adapter
            },
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
    const jobType = normalizeRequestedJobType(options.jobType);
    const portals = loadCareerPortals(jobType !== 'internship');
    if (portals.length === 0) {
        return [];
    }

    const targets = buildPortalTargets(portals, keyword, maxSources, {
        companies: options.companies,
        jobType
    });
    console.log(`[CareerFetch] keyword="${keyword}" searching ${targets.length} companies: ${targets.map((t) => t.company).join('、')}`);
    const results = await runWithConcurrency(
        targets,
        Number(process.env.CAREER_FETCH_CONCURRENCY || 3),
        (target) => searchPortal(target, keyword)
    );

    return aggregateCareerResults(results, keyword, jobType);
}

export function aggregateCareerResults(
    results: CareerFetchResult[],
    keyword: string,
    jobType: CareerJobType = normalizeRequestedJobType()
): CareerFetchResult[] {
    const maxTotal = Number(process.env.CAREER_JOB_MAX_TOTAL_RESULTS || 20);
    const includeFailedSources = process.env.CAREER_FETCH_INCLUDE_FAILED_SOURCES !== '0';
    const pool: CareerJobListing[] = [];

    for (const result of results) {
        const validation = buildValidationOptions(result.search);
        const validJobs = result.jobs
            .map(attachStructuredJobFields)
            .filter((job) => isValidJobListing(job, validation))
            .filter((job) => passesJobTypeFilter(job, jobType))
            .filter((job) => matchesPortalJobKeyword(
                `${job.title} ${job.summary} ${job.requirements || ''}`,
                keyword,
                result.search
            ))
            .map((job) => ({
                ...job,
                jobType: job.jobType || jobType,
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
                sourceStatus: 'success',
                fetchMode: matchedSource?.fetchMode || 'playwright',
                jobs: [],
                durationMs: matchedSource?.durationMs,
                search: matchedSource?.search
            });
        }

        grouped.get(groupKey)!.jobs.push(job);
    }

    const groupedResults = Array.from(grouped.values());
    if (!includeFailedSources) {
        return groupedResults;
    }

    const successfulCompanies = new Set(groupedResults.map((item) => `${item.company}::${item.label || ''}`));
    const failedSources = results
        .filter((item) => item.jobs.length === 0 || item.status === 'failed')
        .filter((item) => !successfulCompanies.has(`${item.company}::${item.label || ''}`))
        .map((item) => ({
            ...item,
            status: item.status === 'success' ? 'failed' as const : item.status,
            sourceStatus: item.sourceStatus || 'no_jobs' as PortalSourceStatus,
            jobs: []
        }));

    return [...groupedResults, ...failedSources];
}

export function formatCareerFetchContext(
    results: CareerFetchResult[],
    keyword: string,
    jobCategory?: string,
    jobType: CareerJobType = normalizeRequestedJobType()
): string {
    const matchedSources = results.filter((item) => item.jobs.length > 0);
    const failedSources = results.filter((item) => item.jobs.length === 0);
    if (matchedSources.length === 0 && failedSources.length === 0) {
        return '';
    }

    const jobTypeLabel = formatJobType(jobType);
    const categoryLine = jobCategory?.trim()
        ? `岗位类型：${jobTypeLabel}；方向：${jobCategory.trim()}；搜索关键词：${keyword}`
        : `岗位类型：${jobTypeLabel}；搜索关键词：${keyword}`;

    const totalJobs = matchedSources.reduce((count, item) => count + item.jobs.length, 0);

    const sections: string[] = [
        jobType === 'internship'
            ? '## 自动检索的公开招聘官网实习岗位信息'
            : '## 自动检索的公开招聘官网岗位信息',
        categoryLine,
        `共检索到 ${totalJobs} 条${jobTypeLabel}岗位信息（全源去重后）。`,
        '每个岗位仅保留：公司、岗位名、地点、岗位类型、岗位职责、招聘条件和来源 URL。'
    ];

    for (const item of matchedSources) {
        const title = item.label ? `${item.company} - ${item.label}` : item.company;
        const validation = buildValidationOptions(item.search);
        const listings = formatJobListings(item.jobs, validation);
        if (listings) {
            sections.push(`### ${title}\n\n${listings}`);
        }
    }

    if (failedSources.length > 0 && process.env.CAREER_FETCH_INCLUDE_FAILED_SOURCES !== '0') {
        const failedLines = failedSources.map((item) => {
            const label = item.label ? `${item.company} - ${item.label}` : item.company;
            const reason = item.error || formatSourceStatus(item.sourceStatus || 'no_jobs');
            return `- ${label}：${reason}（${item.url}）`;
        });
        sections.push(`## 未抓取到有效岗位的官方来源\n\n${failedLines.join('\n')}`);
    }

    return sections.join('\n\n');
}

async function searchPortal(target: CareerPortal & { targetUrl: string }, keyword: string): Promise<CareerFetchResult> {
    const startTime = Date.now();
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
            sourceStatus: 'blocked',
            fetchMode: 'playwright',
            jobs: [],
            search: target.search,
            error: 'Playwright 抓取已关闭，无法进入动态招聘页搜索岗位',
            durationMs: Date.now() - startTime
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
            sourceLabel: target.label,
            jobType: target.jobType
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
                sourceStatus: searchResult.sourceStatus || classifyFetchError(searchResult.error),
                fetchMode,
                jobs: [],
                search: target.search,
                error: searchResult.error,
                durationMs: Date.now() - startTime
            };
        }

        return {
            company: target.company,
            label: target.label,
            url: searchResult.searchUrl,
            status: searchResult.jobs.length > 0 ? 'success' : 'failed',
            sourceStatus: searchResult.sourceStatus || (searchResult.jobs.length > 0 ? 'success' : 'no_jobs'),
            fetchMode,
            jobs: searchResult.jobs,
            search: target.search,
            excerpt: searchResult.pageSummary,
            durationMs: Date.now() - startTime
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
            sourceStatus: classifyFetchError(message),
            fetchMode,
            jobs: [],
            search: target.search,
            error: message,
            durationMs: Date.now() - startTime
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
        sourceStatus: 'success',
        fetchMode: 'agent-fallback',
        jobs: fallbackJobs,
        search: target.search,
        excerpt: 'Agent fallback via Fetch MCP'
    };
}

function filterPortals(portals: CareerPortal[], filters: PortalTargetFilters): CareerPortal[] {
    const companySet = new Set((filters.companies || []).map((item) => item.trim()).filter(Boolean));
    const jobType = normalizeRequestedJobType(filters.jobType);

    return portals.filter((portal) => {
        if (companySet.size > 0 && !companySet.has(portal.company)) {
            return false;
        }
        if (jobType !== 'all' && getPortalJobType(portal) !== jobType) {
            return false;
        }
        return true;
    });
}

function getPortalJobType(portal: CareerPortal): CareerJobType {
    if (portal.jobType) {
        return portal.jobType;
    }
    if (portal.channel === 'campus') return 'campus';
    if (portal.channel === 'experienced' || portal.channel === 'social') return 'experienced';
    return 'internship';
}

function normalizeRequestedJobType(jobType?: CareerJobType): CareerJobType {
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

function formatSourceStatus(status: PortalSourceStatus): string {
    switch (status) {
        case 'success':
            return '抓取成功';
        case 'no_jobs':
            return '未匹配到有效岗位';
        case 'timeout':
            return '请求超时';
        case 'blocked':
            return '公开页面不可访问或抓取被限制';
        case 'parser_error':
            return '页面结构无法解析';
        case 'login_required':
            return '需要登录或验证码';
        case 'network_error':
            return '网络请求失败';
    }
}

function classifyFetchError(message: string): PortalSourceStatus {
    if (/timeout|超时|abort/i.test(message)) return 'timeout';
    if (/login|登录|captcha|验证码/i.test(message)) return 'login_required';
    if (/403|forbidden|blocked|拒绝/i.test(message)) return 'blocked';
    return 'network_error';
}

async function runWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<R>
): Promise<R[]> {
    const limit = Math.max(1, Math.floor(concurrency || 1));
    const results: R[] = new Array(items.length);
    let cursor = 0;

    async function runNext(): Promise<void> {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await worker(items[index]!);
        }
    }

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
    return results;
}
