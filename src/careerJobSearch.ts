import type { Page } from 'playwright';
import { attachStructuredJobFields, formatStructuredJobListing, isInternshipJobTitle, isValidJobListing } from './careerJobFields.js';
import {
    extractCompanyCandidates,
    extractVisibleListTitles,
    pickDetailTitle
} from './careerPortalCollectors.js';
import {
    buildJobDedupeKey,
    buildValidationOptions,
    isLikelyJobLink,
    type JobListingValidationOptions
} from './careerJobValidation.js';
import {
    getListSearchKeyword,
    matchesJobKeyword,
    matchesJobKeywordAtListStage,
    matchesPortalJobKeyword,
    scoreJobKeywordMatch
} from './careerKeywordMatch.js';
import { isPlaywrightFetchEnabled, withPlaywrightPage } from './playwrightFetcher.js';

export interface PortalSearchConfig {
    inputSelector?: string;
    submitSelector?: string;
    resultsSelector?: string;
    listLinkSelector?: string;
    waitForSelector?: string;
    detailContentSelector?: string;
    detailLinkPatterns?: string[];
    validDetailUrlPatterns?: string[];
    noiseUrlParts?: string[];
    noiseTitles?: string[];
    listSearchKeyword?: string;
    matchKeywordOnDetailOnly?: boolean;
    htmlUrlPatterns?: string[];
    maxResults?: number;
    maxDetailPages?: number;
    requireInternship?: boolean;
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
    company?: string;
    sourceLabel?: string;
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
    'campus',
    'jobDetail',
    'post_detail',
    'jobUnionId'
];

export async function searchPortalJobs(options: {
    searchUrl: string;
    landingUrl: string;
    keyword: string;
    fetchMode: 'html' | 'playwright';
    waitMs?: number;
    search?: PortalSearchConfig;
    company?: string;
    sourceLabel?: string;
}): Promise<PortalJobSearchResult> {
    const config = normalizeSearchConfig(options.search);

    if (options.fetchMode === 'playwright' && isPlaywrightFetchEnabled()) {
        return searchJobsWithPlaywright(
            options.searchUrl,
            options.landingUrl,
            options.keyword,
            config,
            options.waitMs || 5000,
            options.company,
            options.sourceLabel
        );
    }

    return searchJobsWithHtml(
        options.searchUrl,
        options.keyword,
        config,
        options.company,
        options.sourceLabel
    );
}

export function formatJobListings(
    jobs: CareerJobListing[],
    validation?: JobListingValidationOptions
): string {
    const validJobs = jobs
        .map(attachStructuredJobFields)
        .filter((job) => isValidJobListing(job, validation));

    const lines: string[] = [];
    let index = 0;
    for (const job of validJobs) {
        const formatted = formatStructuredJobListing(job, index);
        if (formatted) {
            lines.push(formatted);
            index += 1;
        }
    }

    return lines.join('\n\n');
}

export function scoreKeywordMatchText(text: string, keyword: string): number {
    return scoreJobKeywordMatch(text, keyword);
}

export function dedupeJobsGlobally(
    jobs: CareerJobListing[],
    keyword: string,
    maxTotal: number
): CareerJobListing[] {
    const seen = new Set<string>();
    const ranked = [...jobs].sort((a, b) => {
        const scoreA = scoreKeywordMatchText(`${a.title} ${a.summary} ${a.requirements || ''}`, keyword);
        const scoreB = scoreKeywordMatchText(`${b.title} ${b.summary} ${b.requirements || ''}`, keyword);
        return scoreB - scoreA;
    });

    const deduped: CareerJobListing[] = [];
    for (const job of ranked) {
        const key = buildJobDedupeKey(job);
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(job);
        if (deduped.length >= maxTotal) break;
    }

    return deduped;
}

function normalizeSearchConfig(search?: PortalSearchConfig): Required<PortalSearchConfig> & { validation: JobListingValidationOptions } {
    const maxResults = search?.maxResults || Number(process.env.CAREER_JOB_MAX_RESULTS || 5);
    const maxDetailPages = search?.maxDetailPages
        || Number(process.env.CAREER_JOB_MAX_DETAIL_PAGES || maxResults);

    return {
        inputSelector: search?.inputSelector || '',
        submitSelector: search?.submitSelector || '',
        resultsSelector: search?.resultsSelector || '',
        listLinkSelector: search?.listLinkSelector || '',
        waitForSelector: search?.waitForSelector || '',
        detailContentSelector: search?.detailContentSelector || '',
        detailLinkPatterns: search?.detailLinkPatterns?.length ? search.detailLinkPatterns : DEFAULT_DETAIL_PATTERNS,
        validDetailUrlPatterns: search?.validDetailUrlPatterns || [],
        noiseUrlParts: search?.noiseUrlParts || [],
        noiseTitles: search?.noiseTitles || [],
        listSearchKeyword: search?.listSearchKeyword || '',
        matchKeywordOnDetailOnly: search?.matchKeywordOnDetailOnly === true,
        htmlUrlPatterns: search?.htmlUrlPatterns || [],
        maxResults,
        maxDetailPages: Math.max(maxDetailPages, maxResults),
        requireInternship: search?.requireInternship === true,
        validation: buildValidationOptions(search)
    };
}

async function searchJobsWithPlaywright(
    searchUrl: string,
    landingUrl: string,
    keyword: string,
    config: ReturnType<typeof normalizeSearchConfig>,
    waitMs: number,
    company?: string,
    sourceLabel?: string
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

        if (config.waitForSelector) {
            await page.locator(config.waitForSelector).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);
            await page.waitForTimeout(1000);
        }

        if (config.resultsSelector) {
            await page.locator(config.resultsSelector).first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined);
        }

        const candidates = await collectJobCandidatesFromPage(page, keyword, config, company);
        const jobs = await enrichJobsWithDetailPages(page, candidates, config, waitMs, keyword, company, sourceLabel);
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
    config: ReturnType<typeof normalizeSearchConfig>,
    company?: string,
    sourceLabel?: string
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
        const jobs = await fetchHtmlJobDetails(candidates.slice(0, config.maxResults), keyword, company, sourceLabel);

        return {
            searchUrl,
            jobs: (jobs.length > 0 ? jobs : candidates.slice(0, config.maxResults)).map((job) =>
                attachStructuredJobFields({
                    ...job,
                    company: job.company || company,
                    sourceLabel: job.sourceLabel || sourceLabel
                })
            ),
            pageSummary: htmlToText(html).slice(0, 1200)
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { searchUrl, jobs: [], error: message.includes('abort') ? '请求超时' : message };
    }
}

async function tryInteractiveSearch(page: Page, keyword: string, config: ReturnType<typeof normalizeSearchConfig>): Promise<boolean> {
    const searchText = config.matchKeywordOnDetailOnly || config.listSearchKeyword
        ? getListSearchKeyword(keyword, config.listSearchKeyword)
        : keyword;

    if (config.inputSelector) {
        const input = page.locator(config.inputSelector).first();
        if (await input.count()) {
            await input.fill(searchText);
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
        'input[type="search"], input[placeholder*="搜索"], input[placeholder*="关键词"], input[placeholder*="岗位"], input[name*="keyword"], input[name*="query"], input[name*="search"]'
    ).first();

    if (await genericInput.count()) {
        await genericInput.fill(searchText);
        await genericInput.press('Enter');
        await page.waitForTimeout(3000);
        return true;
    }

    return false;
}

async function collectJobCandidatesFromPage(
    page: Page,
    keyword: string,
    config: ReturnType<typeof normalizeSearchConfig>,
    company?: string
): Promise<CareerJobListing[]> {
    const collected: CareerJobListing[] = [];

    if (config.listLinkSelector) {
        collected.push(...await collectLinksBySelector(page, config.listLinkSelector, config.maxResults));
    }

    if (collected.length === 0) {
        const rawLinks = await page.evaluate(({ patterns, limit }) => {
            const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
            const results: Array<{ href: string; text: string }> = [];

            for (const anchor of anchors) {
                const href = anchor.href;
                const text = (anchor.innerText || anchor.textContent || '').replace(/\s+/g, ' ').trim();
                if (!href || !text || text.length < 2) continue;
                if (href.startsWith('javascript:')) continue;
                if (!patterns.some((pattern) => href.toLowerCase().includes(pattern.toLowerCase()))) continue;
                results.push({ href, text });
                if (results.length >= limit * 4) break;
            }

            return results;
        }, { patterns: config.detailLinkPatterns, limit: config.maxResults });

        collected.push(...rawLinks.map((item) => ({
            title: item.text.slice(0, 120),
            detailUrl: item.href,
            summary: item.text.slice(0, 300)
        })));
    }

    const html = await page.content();
    if (config.htmlUrlPatterns.length > 0) {
        collected.push(...extractCandidatesFromHtmlContent(html, page.url(), config.htmlUrlPatterns, config.maxResults));
    }

    if (company) {
        collected.push(...extractCompanyCandidates(company, html, page.url(), config.maxResults));
        if (['腾讯', '美团', '京东'].includes(company)) {
            collected.push(...await extractVisibleListTitles(page, config.maxResults));
        }
    }

    return dedupeJobCandidates(collected, keyword, config);
}

function extractCandidatesFromHtmlContent(
    html: string,
    baseUrl: string,
    patterns: string[],
    maxResults: number
): CareerJobListing[] {
    const candidates: CareerJobListing[] = [];
    const seen = new Set<string>();

    for (const patternSource of patterns) {
        const regex = new RegExp(patternSource, 'gi');
        let match: RegExpExecArray | null;
        while ((match = regex.exec(html)) !== null) {
            let detailUrl = '';
            const raw = match[0];

            if (/^https?:\/\//i.test(raw) || raw.startsWith('#/')) {
                detailUrl = resolveUrl(raw, baseUrl);
            } else if (/postid/i.test(raw)) {
                const id = raw.match(/\d+/)?.[0];
                if (id) {
                    detailUrl = `https://join.qq.com/post_detail.html?postid=${id}`;
                }
            } else if (match[1]) {
                detailUrl = resolveUrl(match[1], baseUrl);
            }

            if (!detailUrl || seen.has(detailUrl)) continue;
            seen.add(detailUrl);
            candidates.push({
                title: '岗位详情',
                detailUrl,
                summary: raw.slice(0, 300)
            });
            if (candidates.length >= maxResults * 4) break;
        }
    }

    return candidates;
}

async function collectLinksBySelector(
    page: Page,
    selector: string,
    maxResults: number
): Promise<CareerJobListing[]> {
    const locators = page.locator(selector);
    const count = await locators.count();
    const limit = Math.min(count, maxResults * 4);
    const results: CareerJobListing[] = [];

    for (let i = 0; i < limit; i++) {
        const item = locators.nth(i);
        let href = await item.getAttribute('href');
        if (!href) {
            href = await item.locator('a[href]').first().getAttribute('href');
        }
        if (!href) continue;

        const detailUrl = new URL(href, page.url()).toString();
        const text = ((await item.innerText()) || '').replace(/\s+/g, ' ').trim();
        if (!text || text.length < 2) continue;

        results.push({
            title: text.slice(0, 120),
            detailUrl,
            summary: text.slice(0, 300)
        });
    }

    return results;
}

async function enrichJobsWithDetailPages(
    page: Page,
    candidates: CareerJobListing[],
    config: ReturnType<typeof normalizeSearchConfig>,
    waitMs: number,
    keyword: string,
    company?: string,
    sourceLabel?: string
): Promise<CareerJobListing[]> {
    const enriched: CareerJobListing[] = [];

    for (const candidate of candidates.slice(0, config.maxDetailPages)) {
        try {
            await page.goto(candidate.detailUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(Math.min(waitMs, 3000));

            if (config.detailContentSelector) {
                await page.locator(config.detailContentSelector).first()
                    .waitFor({ state: 'visible', timeout: 10000 })
                    .catch(() => undefined);
            }

            const detailLocator = config.detailContentSelector
                ? page.locator(config.detailContentSelector).first()
                : page.locator('body');
            const detailText = ((await detailLocator.innerText().catch(() => '')) || '')
                .replace(/\s+/g, ' ')
                .trim();

            const mergedText = `${candidate.title} ${detailText}`;
            if (config.matchKeywordOnDetailOnly && !matchesPortalJobKeyword(mergedText, keyword, config)) {
                continue;
            }

            const detailTitle = pickDetailTitle(detailText, candidate.title);

            enriched.push(attachStructuredJobFields({
                ...candidate,
                title: detailTitle,
                company: candidate.company || company,
                sourceLabel: candidate.sourceLabel || sourceLabel,
                detailExcerpt: detailText.slice(0, 2400)
            }));
        } catch {
            if (!config.matchKeywordOnDetailOnly) {
                enriched.push(attachStructuredJobFields({
                    ...candidate,
                    company: candidate.company || company,
                    sourceLabel: candidate.sourceLabel || sourceLabel
                }));
            }
        }
    }

    return enriched;
}

function extractJobCandidatesFromHtml(
    html: string,
    baseUrl: string,
    keyword: string,
    config: ReturnType<typeof normalizeSearchConfig>
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

    return dedupeJobCandidates(candidates, keyword, config);
}

async function fetchHtmlJobDetails(
    candidates: CareerJobListing[],
    keyword: string,
    company?: string,
    sourceLabel?: string
): Promise<CareerJobListing[]> {
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
                company: candidate.company || company,
                sourceLabel: candidate.sourceLabel || sourceLabel,
                detailExcerpt: detailText.slice(0, 2400)
            }));
        } catch {
            enriched.push(attachStructuredJobFields({
                ...candidate,
                company: candidate.company || company,
                sourceLabel: candidate.sourceLabel || sourceLabel
            }));
        }
    }

    return enriched;
}

function dedupeJobCandidates(
    candidates: CareerJobListing[],
    keyword: string,
    config: ReturnType<typeof normalizeSearchConfig>
): CareerJobListing[] {
    const seen = new Set<string>();
    const filtered: CareerJobListing[] = [];

    const listMatchOptions = {
        listSearchKeyword: config.listSearchKeyword,
        matchKeywordOnDetailOnly: config.matchKeywordOnDetailOnly
    };

    for (const candidate of candidates) {
        const key = buildJobDedupeKey(candidate);
        if (seen.has(key)) continue;
        if (!isLikelyJobLink(candidate.title, candidate.detailUrl, config.validation)) continue;
        if (!matchesJobKeywordAtListStage(`${candidate.title} ${candidate.summary}`, keyword, listMatchOptions)) continue;
        if (
            process.env.CAREER_INTERNSHIP_ONLY !== '0'
            && candidate.title !== '岗位详情'
            && !isInternshipJobTitle(candidate.title)
        ) {
            continue;
        }
        seen.add(key);
        filtered.push(candidate);
    }

    const ranked = filtered.sort((a, b) => scoreKeywordMatch(b, keyword) - scoreKeywordMatch(a, keyword));
    return ranked.slice(0, config.maxResults);
}

function matchesKeyword(text: string, keyword: string): boolean {
    return matchesJobKeyword(text, keyword);
}

function scoreKeywordMatch(candidate: CareerJobListing, keyword: string): number {
    return scoreJobKeywordMatch(`${candidate.title} ${candidate.summary}`, keyword);
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
