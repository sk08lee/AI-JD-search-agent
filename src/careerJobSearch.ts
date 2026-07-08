import type { Page } from 'playwright';
import { attachStructuredJobFields, formatStructuredJobListing } from './careerJobFields.js';
import { fetchPageWithPlaywright, isPlaywrightFetchEnabled, withPlaywrightPage } from './playwrightFetcher.js';

export interface PortalSearchConfig {
    inputSelector?: string;
    submitSelector?: string;
    resultsSelector?: string;
    detailLinkPatterns?: string[];
    maxResults?: number;
    maxDetailPages?: number;
}

export interface CareerJobListing {
    title: string;
    detailUrl: string;
    summary: string;
    detailExcerpt?: string;
    location?: string;
    schedule?: string;
    requirements?: string;
    responsibilities?: string;
}

export interface PortalJobSearchResult {
    searchUrl: string;
    jobs: CareerJobListing[];
    pageSummary?: string;
    error?: string;
}

const DEFAULT_DETAIL_PATTERNS = [
    'position',
    'job',
    'post',
    'recruit',
    'career',
    'detail',
    'opening',
    'campus'
];

export async function searchPortalJobs(options: {
    searchUrl: string;
    landingUrl: string;
    keyword: string;
    fetchMode: 'html' | 'playwright';
    waitMs?: number;
    search?: PortalSearchConfig;
}): Promise<PortalJobSearchResult> {
    const config = normalizeSearchConfig(options.search);

    if (options.fetchMode === 'playwright' && isPlaywrightFetchEnabled()) {
        return searchJobsWithPlaywright(options.searchUrl, options.landingUrl, options.keyword, config, options.waitMs || 5000);
    }

    return searchJobsWithHtml(options.searchUrl, options.keyword, config);
}

export function formatJobListings(jobs: CareerJobListing[]): string {
    if (jobs.length === 0) {
        return '';
    }

    return jobs
        .map((job, index) => formatStructuredJobListing(job, index))
        .join('\n\n');
}

function normalizeSearchConfig(search?: PortalSearchConfig): Required<PortalSearchConfig> {
    return {
        inputSelector: search?.inputSelector || '',
        submitSelector: search?.submitSelector || '',
        resultsSelector: search?.resultsSelector || '',
        detailLinkPatterns: search?.detailLinkPatterns?.length ? search.detailLinkPatterns : DEFAULT_DETAIL_PATTERNS,
        maxResults: search?.maxResults || Number(process.env.CAREER_JOB_MAX_RESULTS || 3),
        maxDetailPages: search?.maxDetailPages || Number(process.env.CAREER_JOB_MAX_DETAIL_PAGES || 2)
    };
}

async function searchJobsWithPlaywright(
    searchUrl: string,
    landingUrl: string,
    keyword: string,
    config: Required<PortalSearchConfig>,
    waitMs: number
): Promise<PortalJobSearchResult> {
    return withPlaywrightPage(async (page) => {
        const hasKeywordInSearchUrl = searchUrl.includes(encodeURIComponent(keyword)) || searchUrl.includes(keyword);
        const startUrl = hasKeywordInSearchUrl ? searchUrl : landingUrl;

        await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(waitMs);

        if (!hasKeywordInSearchUrl) {
            const searched = await tryInteractiveSearch(page, keyword, config);
            if (!searched && searchUrl !== landingUrl) {
                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await page.waitForTimeout(waitMs);
            }
        }

        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined);

        const candidates = await collectJobCandidatesFromPage(page, page.url(), keyword, config);
        const jobs = await enrichJobsWithDetailPages(page, candidates, config, waitMs);
        const pageSummary = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim().slice(0, 1200);

        return {
            searchUrl: page.url(),
            jobs,
            pageSummary
        };
    });
}

async function searchJobsWithHtml(
    searchUrl: string,
    keyword: string,
    config: Required<PortalSearchConfig>
): Promise<PortalJobSearchResult> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(searchUrl, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'zh-CN,zh;q=0.9'
            },
            redirect: 'follow'
        });
        clearTimeout(timeout);

        if (!response.ok) {
            return { searchUrl, jobs: [], error: `HTTP ${response.status}` };
        }

        const html = await response.text();
        const candidates = extractJobCandidatesFromHtml(html, searchUrl, keyword, config);
        const jobs = await fetchHtmlJobDetails(candidates.slice(0, config.maxDetailPages), keyword);

        return {
            searchUrl,
            jobs: (jobs.length > 0 ? jobs : candidates.slice(0, config.maxResults)).map(attachStructuredJobFields),
            pageSummary: htmlToText(html).slice(0, 1200)
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { searchUrl, jobs: [], error: message.includes('abort') ? '请求超时' : message };
    }
}

async function tryInteractiveSearch(page: Page, keyword: string, config: Required<PortalSearchConfig>): Promise<boolean> {
    if (config.inputSelector) {
        const input = page.locator(config.inputSelector).first();
        if (await input.count()) {
            await input.fill(keyword);
            if (config.submitSelector) {
                await page.locator(config.submitSelector).first().click();
            } else {
                await input.press('Enter');
            }
            await page.waitForTimeout(3000);
            return true;
        }
    }

    const genericInput = page.locator(
        'input[type="search"], input[placeholder*="搜索"], input[placeholder*="关键词"], input[name*="keyword"], input[name*="query"], input[name*="search"]'
    ).first();

    if (await genericInput.count()) {
        await genericInput.fill(keyword);
        await genericInput.press('Enter');
        await page.waitForTimeout(3000);
        return true;
    }

    return false;
}

async function collectJobCandidatesFromPage(
    page: Page,
    baseUrl: string,
    keyword: string,
    config: Required<PortalSearchConfig>
): Promise<CareerJobListing[]> {
    const rawLinks = await page.evaluate(({ patterns, limit }) => {
        const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
        const results: Array<{ href: string; text: string }> = [];

        for (const anchor of anchors) {
            const href = anchor.href;
            const text = (anchor.innerText || anchor.textContent || '').replace(/\s+/g, ' ').trim();
            if (!href || !text || text.length < 2) continue;
            if (!patterns.some((pattern) => href.toLowerCase().includes(pattern.toLowerCase()))) continue;
            results.push({ href, text });
            if (results.length >= limit * 4) break;
        }

        return results;
    }, { patterns: config.detailLinkPatterns, limit: config.maxResults });

    const deduped = dedupeJobCandidates(
        rawLinks.map((item) => ({
            title: item.text.slice(0, 120),
            detailUrl: item.href,
            summary: item.text.slice(0, 300)
        })),
        keyword,
        config.maxResults
    );

    return deduped;
}

async function enrichJobsWithDetailPages(
    page: Page,
    candidates: CareerJobListing[],
    config: Required<PortalSearchConfig>,
    waitMs: number
): Promise<CareerJobListing[]> {
    const enriched: CareerJobListing[] = [];

    for (const candidate of candidates.slice(0, config.maxDetailPages)) {
        try {
            await page.goto(candidate.detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(Math.min(waitMs, 3000));
            const detailText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
            enriched.push(attachStructuredJobFields({
                ...candidate,
                detailExcerpt: detailText.slice(0, 1800)
            }));
        } catch {
            enriched.push(attachStructuredJobFields(candidate));
        }
    }

    const remaining = candidates.slice(config.maxDetailPages).map(attachStructuredJobFields);
    return [...enriched, ...remaining];
}

function extractJobCandidatesFromHtml(
    html: string,
    baseUrl: string,
    keyword: string,
    config: Required<PortalSearchConfig>
): CareerJobListing[] {
    const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const candidates: CareerJobListing[] = [];
    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(html)) !== null) {
        const href = resolveUrl(match[1], baseUrl);
        const text = htmlToText(match[2]);
        if (!href || !text) continue;
        if (!config.detailLinkPatterns.some((pattern) => href.toLowerCase().includes(pattern.toLowerCase()))) continue;

        candidates.push({
            title: text.slice(0, 120),
            detailUrl: href,
            summary: text.slice(0, 300)
        });
    }

    return dedupeJobCandidates(candidates, keyword, config.maxResults);
}

async function fetchHtmlJobDetails(candidates: CareerJobListing[], keyword: string): Promise<CareerJobListing[]> {
    const enriched: CareerJobListing[] = [];

    for (const candidate of candidates) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 12000);
            const response = await fetch(candidate.detailUrl, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            clearTimeout(timeout);

            if (!response.ok) {
                enriched.push(candidate);
                continue;
            }

            const html = await response.text();
            const detailText = htmlToText(html);
            if (!matchesKeyword(`${candidate.title} ${detailText}`, keyword)) {
                continue;
            }

            enriched.push(attachStructuredJobFields({
                ...candidate,
                detailExcerpt: detailText.slice(0, 1800)
            }));
        } catch {
            enriched.push(attachStructuredJobFields(candidate));
        }
    }

    return enriched;
}

function dedupeJobCandidates(candidates: CareerJobListing[], keyword: string, maxResults = 5): CareerJobListing[] {
    const seen = new Set<string>();
    const filtered: CareerJobListing[] = [];

    for (const candidate of candidates) {
        const key = candidate.detailUrl.split('?')[0];
        if (seen.has(key)) continue;
        if (!matchesKeyword(`${candidate.title} ${candidate.summary}`, keyword)) continue;
        seen.add(key);
        filtered.push(candidate);
    }

    const ranked = filtered.sort((a, b) => scoreKeywordMatch(b, keyword) - scoreKeywordMatch(a, keyword));
    if (ranked.length > 0) {
        return ranked.slice(0, maxResults);
    }

    const fallback: CareerJobListing[] = [];
    for (const candidate of candidates) {
        const key = candidate.detailUrl.split('?')[0];
        if (seen.has(key)) continue;
        seen.add(key);
        fallback.push(candidate);
        if (fallback.length >= maxResults) break;
    }

    return fallback;
}

function matchesKeyword(text: string, keyword: string): boolean {
    const normalized = text.toLowerCase();
    const target = keyword.toLowerCase();
    if (normalized.includes(target)) return true;

    const tokens = keywordTokens(keyword);
    if (tokens.length === 0) return false;

    const hits = tokens.filter((token) => normalized.includes(token.toLowerCase())).length;
    return hits >= Math.max(1, Math.ceil(tokens.length * 0.5));
}

function scoreKeywordMatch(candidate: CareerJobListing, keyword: string): number {
    return keywordTokens(keyword).reduce((score, token) => {
        const text = `${candidate.title} ${candidate.summary}`.toLowerCase();
        return score + (text.includes(token.toLowerCase()) ? 1 : 0);
    }, 0);
}

function keywordTokens(keyword: string): string[] {
    const split = keyword.split(/[\s·\-_/|+]+/).map((part) => part.trim()).filter(Boolean);
    if (split.length > 0) return split;

    const chineseParts = keyword.match(/[\u4e00-\u9fa5]{2,}|[a-zA-Z0-9]+/g) || [];
    return chineseParts.length > 0 ? chineseParts : [keyword];
}

function resolveUrl(href: string, baseUrl: string): string {
    try {
        return new URL(href, baseUrl).toString();
    } catch {
        return '';
    }
}

function htmlToText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
}
