import type { Page } from 'playwright';
import type { CareerJobListing } from './careerJobSearch.js';

const INTERN_TITLE_HINT = /实习|产品|经理|工程师|开发|算法|运营|设计/i;

export function extractCompanyCandidates(
    company: string,
    html: string,
    baseUrl: string,
    maxResults: number
): CareerJobListing[] {
    switch (company) {
        case '腾讯':
            return extractTencentCandidates(html, maxResults);
        case '美团':
            return extractMeituanCandidates(html, maxResults);
        case '京东':
            return extractJdCandidates(html, baseUrl, maxResults);
        case '阿里巴巴':
            return extractAlibabaCandidates(html, maxResults);
        case '百度':
            return extractBaiduCandidates(html, maxResults);
        case '字节跳动':
            return extractByteDanceCandidates(html, maxResults);
        case '华为':
            return extractHuaweiCandidates(html, baseUrl, maxResults);
        case '网易':
            return extractNeteaseCandidates(html, baseUrl, maxResults);
        case '小米':
            return extractXiaomiCandidates(html, maxResults);
        case '商汤科技':
            return extractSensetimeCandidates(html, baseUrl, maxResults);
        case '科大讯飞':
            return extractIflytekCandidates(html, baseUrl, maxResults);
        default:
            return [];
    }
}

export async function extractVisibleListTitles(page: Page, maxResults: number): Promise<CareerJobListing[]> {
    return page.evaluate(({ limit, titleHintSource }) => {
        const titleHint = new RegExp(titleHintSource, 'i');
        const results: Array<{ title: string; detailUrl: string; summary: string }> = [];
        const seen = new Set<string>();

        const blocks = Array.from(document.querySelectorAll(
            '[class*="job"], [class*="position"], [class*="post"], [class*="list"] li, [class*="list"] tr, [class*="card"]'
        ));

        for (const block of blocks) {
            const text = (block.textContent || '').replace(/\s+/g, ' ').trim();
            if (!text || text.length < 6 || text.length > 200) continue;
            if (!titleHint.test(text)) continue;

            const anchor = block.querySelector('a[href]') as HTMLAnchorElement | null;
            const href = anchor?.href || '';
            const key = `${text.slice(0, 80)}::${href}`;
            if (seen.has(key)) continue;
            seen.add(key);

            results.push({
                title: text.slice(0, 120),
                detailUrl: href || window.location.href,
                summary: text.slice(0, 300)
            });
            if (results.length >= limit) break;
        }

        return results;
    }, { limit: maxResults * 4, titleHintSource: INTERN_TITLE_HINT.source });
}

function pushUnique(
    bucket: CareerJobListing[],
    seen: Set<string>,
    item: CareerJobListing,
    maxResults: number
): void {
    const key = item.detailUrl.toLowerCase();
    if (!item.detailUrl || seen.has(key)) return;
    seen.add(key);
    bucket.push(item);
    if (bucket.length >= maxResults * 4) {
        return;
    }
}

function extractTencentCandidates(html: string, maxResults: number): CareerJobListing[] {
    const results: CareerJobListing[] = [];
    const seen = new Set<string>();
    const patterns = [
        /post_detail\.html\?postid=(\d+)/gi,
        /postId["']?\s*[:=]\s*["']?(\d+)/gi,
        /postid["']?\s*[:=]\s*["']?(\d+)/gi,
        /data-postid=["'](\d+)["']/gi
    ];

    for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(html)) !== null) {
            const id = match[1];
            if (!id) continue;
            pushUnique(results, seen, {
                title: '岗位详情',
                detailUrl: `https://join.qq.com/post_detail.html?postid=${id}`,
                summary: `腾讯岗位 postid=${id}`
            }, maxResults);
        }
    }

    return results;
}

function extractMeituanCandidates(html: string, maxResults: number): CareerJobListing[] {
    const results: CareerJobListing[] = [];
    const seen = new Set<string>();
    const patterns = [
        /https:\/\/zhaopin\.meituan\.com\/web\/position\/detail[^"'\s<]+/gi,
        /\/web\/position\/detail\?[^"'\s<]+/gi,
        /jobUnionId=[^"'&\s<]+/gi
    ];

    for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(html)) !== null) {
            let detailUrl = match[0];
            if (detailUrl.startsWith('/')) {
                detailUrl = `https://zhaopin.meituan.com${detailUrl}`;
            } else if (detailUrl.startsWith('jobUnionId=')) {
                detailUrl = `https://zhaopin.meituan.com/web/position/detail?${detailUrl}`;
            }
            pushUnique(results, seen, {
                title: '岗位详情',
                detailUrl,
                summary: detailUrl
            }, maxResults);
        }
    }

    return results;
}

function extractJdCandidates(html: string, baseUrl: string, maxResults: number): CareerJobListing[] {
    const results: CareerJobListing[] = [];
    const seen = new Set<string>();
    const hashPatterns = [
        /#\/jobDetail\/[^"'\s<]+/gi,
        /#\/job\/detail\/[^"'\s<]+/gi
    ];

    for (const pattern of hashPatterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(html)) !== null) {
            const detailUrl = `https://campus.jd.com/${match[0]}`;
            pushUnique(results, seen, {
                title: '岗位详情',
                detailUrl,
                summary: detailUrl
            }, maxResults);
        }
    }

    const reqIdPattern = /reqId=(\d+)/gi;
    let reqMatch: RegExpExecArray | null;
    while ((reqMatch = reqIdPattern.exec(html)) !== null) {
        const id = reqMatch[1];
        if (!id) continue;
        pushUnique(results, seen, {
            title: '岗位详情',
            detailUrl: `https://campus.jd.com/#/jobDetail?reqId=${id}`,
            summary: `京东岗位 reqId=${id}`
        }, maxResults);
    }

    return results;
}

function extractAlibabaCandidates(html: string, maxResults: number): CareerJobListing[] {
    const results: CareerJobListing[] = [];
    const seen = new Set<string>();
    const pattern = /https:\/\/campus-talent\.alibaba\.com\/campus\/position\/\d+[^"'\s<]*/gi;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(html)) !== null) {
        pushUnique(results, seen, {
            title: '岗位详情',
            detailUrl: match[0],
            summary: match[0]
        }, maxResults);
    }

    return results;
}

function extractBaiduCandidates(html: string, maxResults: number): CareerJobListing[] {
    const results: CareerJobListing[] = [];
    const seen = new Set<string>();
    const patterns = [
        /https:\/\/talent\.baidu\.com\/jobs\/detail\/[^"'\s<]+/gi,
        /\/jobs\/detail\/[^"'\s<]+/gi
    ];

    for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(html)) !== null) {
            let detailUrl = match[0];
            if (detailUrl.startsWith('/')) {
                detailUrl = `https://talent.baidu.com${detailUrl}`;
            }
            pushUnique(results, seen, {
                title: '岗位详情',
                detailUrl,
                summary: detailUrl
            }, maxResults);
        }
    }

    return results;
}

function extractByteDanceCandidates(html: string, maxResults: number): CareerJobListing[] {
    const results: CareerJobListing[] = [];
    const seen = new Set<string>();
    const patterns = [
        /https:\/\/jobs\.bytedance\.com\/campus\/position\/\d+\/detail[^"'\s<]*/gi,
        /\/campus\/position\/\d+\/detail[^"'\s<]*/gi
    ];

    for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(html)) !== null) {
            let detailUrl = match[0];
            if (detailUrl.startsWith('/')) {
                detailUrl = `https://jobs.bytedance.com${detailUrl}`;
            }
            pushUnique(results, seen, {
                title: '岗位详情',
                detailUrl,
                summary: detailUrl
            }, maxResults);
        }
    }

    return results;
}

function extractHuaweiCandidates(html: string, baseUrl: string, maxResults: number): CareerJobListing[] {
    const results: CareerJobListing[] = [];
    const seen = new Set<string>();
    const patterns = [
        /https:\/\/career\.huawei\.com[^"'\s<]*(?:job|position|detail)[^"'\s<]*/gi,
        /\/reccampportal\/[^"'\s<]+/gi
    ];

    for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(html)) !== null) {
            let detailUrl = match[0];
            if (detailUrl.startsWith('/')) {
                detailUrl = new URL(detailUrl, baseUrl).toString();
            }
            pushUnique(results, seen, {
                title: '岗位详情',
                detailUrl,
                summary: detailUrl
            }, maxResults);
        }
    }

    return results;
}

function extractNeteaseCandidates(html: string, baseUrl: string, maxResults: number): CareerJobListing[] {
    const results: CareerJobListing[] = [];
    const seen = new Set<string>();
    const patterns = [
        /https:\/\/hr\.163\.com[^"'\s<]*(?:job|position|detail)[^"'\s<]*/gi,
        /\/job\/[^"'\s<]+/gi
    ];

    for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(html)) !== null) {
            let detailUrl = match[0];
            if (detailUrl.startsWith('/')) {
                detailUrl = new URL(detailUrl, baseUrl).toString();
            }
            pushUnique(results, seen, {
                title: '岗位详情',
                detailUrl,
                summary: detailUrl
            }, maxResults);
        }
    }

    return results;
}

function extractXiaomiCandidates(html: string, maxResults: number): CareerJobListing[] {
    const results: CareerJobListing[] = [];
    const seen = new Set<string>();
    const pattern = /https:\/\/xiaomi\.jobs\.f\.mioffice\.cn\/internship\/position\/\d+\/detail[^"'\s<]*/gi;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(html)) !== null) {
        pushUnique(results, seen, {
            title: '岗位详情',
            detailUrl: match[0],
            summary: match[0]
        }, maxResults);
    }

    return results;
}

function extractSensetimeCandidates(html: string, baseUrl: string, maxResults: number): CareerJobListing[] {
    const results: CareerJobListing[] = [];
    const seen = new Set<string>();
    const patterns = [
        /https:\/\/hr\.sensetime\.com[^"'\s<]*(?:job|position|campus|detail)[^"'\s<]*/gi,
        /\/edu\/[^"'\s<]+/gi
    ];

    for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(html)) !== null) {
            let detailUrl = match[0];
            if (detailUrl.startsWith('/')) {
                detailUrl = new URL(detailUrl, baseUrl).toString();
            }
            pushUnique(results, seen, {
                title: '岗位详情',
                detailUrl,
                summary: detailUrl
            }, maxResults);
        }
    }

    return results;
}

function extractIflytekCandidates(html: string, baseUrl: string, maxResults: number): CareerJobListing[] {
    const results: CareerJobListing[] = [];
    const seen = new Set<string>();
    const patterns = [
        /https:\/\/iflytek\.zhiye\.com\/intern\/[^"'\s<]+/gi,
        /\/intern\/[^"'\s<]+/gi
    ];

    for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(html)) !== null) {
            let detailUrl = match[0];
            if (detailUrl.startsWith('/')) {
                detailUrl = new URL(detailUrl, baseUrl).toString();
            }
            pushUnique(results, seen, {
                title: '岗位详情',
                detailUrl,
                summary: detailUrl
            }, maxResults);
        }
    }

    return results;
}

export function pickDetailTitle(detailText: string, fallbackTitle: string): string {
    const lines = detailText
        .split(/\n/)
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

    const preferred = lines.find((line) =>
        line.length >= 4
        && line.length <= 80
        && /实习/.test(line)
        && !/^(首页|登录|投递|分享|返回)/.test(line)
    );
    if (preferred) return preferred;

    const generic = lines.find((line) =>
        line.length >= 4
        && line.length <= 80
        && INTERN_TITLE_HINT.test(line)
        && !/^(首页|登录|投递|分享|返回)/.test(line)
    );

    if (generic && (fallbackTitle === '岗位详情' || fallbackTitle.length < 4)) {
        return generic;
    }

    return fallbackTitle;
}
