import type { CareerJobListing } from './careerJobSearch.js';

const NOISE_TITLES = /^(首页|隐私政策|招聘动态|校园招聘|社会招聘|加入我们|关于我们|招聘职位|相关职位|投递)$/i;
const NOISE_URL_PARTS = [/privacy/i, /rules-center/i, /#\/$/, /#\/news/i, /#\/jobs$/i, /javascript:/i];
const VALID_DETAIL_URL = /\/detail|\/job\/|position\/\d+/i;

const REQUIREMENT_SECTION_PATTERNS = [
    /职位要求[\s:：]*([\s\S]*?)(?=投递|相关职位|工作地点|展开地图|点击申请|立即申请|$)/i,
    /任职要求[\s:：]*([\s\S]*?)(?=投递|相关职位|工作地点|$)/i,
    /岗位要求[\s:：]*([\s\S]*?)(?=投递|相关职位|工作地点|$)/i,
    /招聘条件[\s:：]*([\s\S]*?)(?=投递|相关职位|工作地点|$)/i,
    /招聘要求[\s:：]*([\s\S]*?)(?=投递|相关职位|工作地点|$)/i
];

export function cleanJobTitle(raw: string): string {
    let title = raw
        .split(/日常实习|职位 ID|职位ID|更新于|岗位职责|职位要求/i)[0]
        ?.replace(/\s+/g, ' ')
        .trim() || raw;

    const named = raw.match(/((?:AI|Java|Python|前端|后端|数据|产品)[^\s-]{0,30}(?:实习生|工程师|经理|产品|运营|分析师)[^\s]{0,20})/i);
    if (named?.[1]) {
        title = named[1].trim();
    }

    return title.slice(0, 80).trim();
}

export function extractRequirements(text: string): string | undefined {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) return undefined;

    for (const pattern of REQUIREMENT_SECTION_PATTERNS) {
        const match = normalized.match(pattern);
        if (!match?.[1]) continue;

        const cleaned = cleanRequirementText(match[1]);
        if (cleaned.length >= 20) {
            return cleaned;
        }
    }

    return undefined;
}

export function attachStructuredJobFields(job: CareerJobListing): CareerJobListing {
    const sourceText = [job.detailExcerpt, job.summary, job.title].filter(Boolean).join('\n');
    const title = cleanJobTitle(job.title);
    const requirements = extractRequirements(sourceText);

    return {
        ...job,
        title,
        requirements
    };
}

export function isValidJobListing(job: CareerJobListing): boolean {
    const title = cleanJobTitle(job.title);
    if (!title || NOISE_TITLES.test(title)) {
        return false;
    }

    if (NOISE_URL_PARTS.some((pattern) => pattern.test(job.detailUrl))) {
        return false;
    }

    if (!VALID_DETAIL_URL.test(job.detailUrl)) {
        return false;
    }

    const requirements = job.requirements || extractRequirements([job.detailExcerpt, job.summary, job.title].join('\n'));
    return !!requirements && requirements.length >= 20;
}

export function formatStructuredJobListing(job: CareerJobListing, index: number): string | null {
    const enriched = attachStructuredJobFields(job);
    if (!enriched.requirements) {
        return null;
    }

    return [
        `${index + 1}. **${enriched.title}**`,
        `- 招聘条件：${enriched.requirements}`,
        `- 来源：${enriched.detailUrl}`
    ].join('\n');
}

function cleanRequirementText(raw: string): string {
    return raw
        .replace(/^[\s\d、\.．)）]+/, '')
        .replace(/团队介绍[:：][\s\S]*?(?=1、|1\.|一、|$)/i, '')
        .replace(/岗位职责[:：][\s\S]*?(?=职位要求|任职要求|岗位要求|$)/i, '')
        .replace(/\s+/g, ' ')
        .slice(0, 800)
        .trim();
}
