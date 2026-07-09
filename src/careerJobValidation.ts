import type { PortalSearchConfig } from './careerJobSearch.js';

export interface JobListingValidationOptions {
    validDetailUrlPatterns: RegExp[];
    noiseUrlParts: RegExp[];
    noiseTitles: RegExp;
}

const DEFAULT_VALID_DETAIL_URL = [
    /\/detail/i,
    /\/job\//i,
    /position\/\d+/i,
    /post_detail/i,
    /postid=/i,
    /jobUnionId=/i,
    /jobDetail/i,
    /positionId=/i,
    /recruit\/post/i
];

const DEFAULT_NOISE_URL_PARTS = [
    /privacy/i,
    /rules-center/i,
    /#\/news/i,
    /javascript:/i
];

const DEFAULT_NOISE_TITLES = /^(首页|隐私政策|招聘动态|校园招聘|社会招聘|加入我们|关于我们|招聘职位|相关职位|投递)$/i;

export function buildValidationOptions(search?: PortalSearchConfig): JobListingValidationOptions {
    const validPatterns = (search?.validDetailUrlPatterns?.length
        ? search.validDetailUrlPatterns
        : DEFAULT_VALID_DETAIL_URL.map((pattern) => pattern.source))
        .map((pattern) => new RegExp(pattern, 'i'));

    const noiseUrlParts = (search?.noiseUrlParts?.length
        ? search.noiseUrlParts
        : DEFAULT_NOISE_URL_PARTS.map((pattern) => pattern.source))
        .map((pattern) => new RegExp(pattern, 'i'));

    const noiseTitleSource = search?.noiseTitles?.length
        ? `^(${search.noiseTitles.join('|')})$`
        : DEFAULT_NOISE_TITLES.source;

    return {
        validDetailUrlPatterns: validPatterns,
        noiseUrlParts,
        noiseTitles: new RegExp(noiseTitleSource, 'i')
    };
}

export function isLikelyJobLink(
    title: string,
    detailUrl: string,
    options: JobListingValidationOptions
): boolean {
    const normalizedTitle = title.trim();
    if (!normalizedTitle || options.noiseTitles.test(normalizedTitle)) {
        return false;
    }

    if (options.noiseUrlParts.some((pattern) => pattern.test(detailUrl))) {
        return false;
    }

    if (/privacy|rules-center|javascript:/i.test(detailUrl)) {
        return false;
    }

    if (/#\/$/.test(detailUrl) || /#\/jobs$/i.test(detailUrl)) {
        return false;
    }

    return options.validDetailUrlPatterns.some((pattern) => pattern.test(detailUrl));
}

export function isValidDetailUrl(detailUrl: string, options: JobListingValidationOptions): boolean {
    if (options.noiseUrlParts.some((pattern) => pattern.test(detailUrl))) {
        return false;
    }

    return options.validDetailUrlPatterns.some((pattern) => pattern.test(detailUrl));
}

export function normalizeJobUrl(url: string): string {
    try {
        const parsed = new URL(url);
        parsed.hash = parsed.hash.replace(/\/$/, '');
        return `${parsed.origin}${parsed.pathname}${parsed.search}`.replace(/\/$/, '');
    } catch {
        return url.split('#')[0].split('?')[0];
    }
}

export function buildJobDedupeKey(job: { title: string; detailUrl: string; company?: string }): string {
    const urlKey = normalizeJobUrl(job.detailUrl);
    if (urlKey) {
        return urlKey.toLowerCase();
    }

    return `${job.company || ''}:${job.title}`.toLowerCase();
}
