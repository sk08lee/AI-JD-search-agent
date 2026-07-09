import type { CareerJobListing } from './careerJobSearch.js';
import type { JobListingValidationOptions } from './careerJobValidation.js';
import { isValidDetailUrl } from './careerJobValidation.js';

const REQUIREMENT_SECTION_PATTERNS = [
    /职位要求[\s:：]*([\s\S]*?)(?=投递|相关职位|工作地点|展开地图|点击申请|立即申请|职位 ID|职位ID|$)/i,
    /任职要求[\s:：]*([\s\S]*?)(?=投递|相关职位|工作地点|职位 ID|职位ID|$)/i,
    /岗位要求[\s:：]*([\s\S]*?)(?=投递|相关职位|工作地点|职位 ID|职位ID|$)/i,
    /招聘条件[\s:：]*([\s\S]*?)(?=投递|相关职位|工作地点|职位 ID|职位ID|$)/i,
    /招聘要求[\s:：]*([\s\S]*?)(?=投递|相关职位|工作地点|职位 ID|职位ID|$)/i,
    /基本要求[\s:：]*([\s\S]*?)(?=投递|优先条件|工作地点|职位 ID|职位ID|$)/i,
    /优先条件[\s:：]*([\s\S]*?)(?=投递|工作地点|职位 ID|职位ID|$)/i,
    /(?:^|\s)(1[、\.．]\s*(?:本科|硕士|博士|学历|英语|熟悉|了解|具备|有).{10,800})/i
];

export function cleanJobTitle(raw: string): string {
    let title = raw
        .split(/职位 ID|职位ID|更新于|岗位职责|职位要求/i)[0]
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

export function isInternshipJobTitle(title: string): boolean {
    const raw = title.replace(/\s+/g, ' ').trim();
    if (!raw || raw === '岗位详情') {
        return false;
    }
    if (/实习/.test(raw)) {
        return true;
    }
    return /实习/.test(cleanJobTitle(raw));
}

export function passesInternshipFilter(job: CareerJobListing): boolean {
    if (process.env.CAREER_INTERNSHIP_ONLY === '0') {
        return true;
    }

    return isInternshipJobTitle(job.title);
}

export function isValidJobListing(
    job: CareerJobListing,
    validation?: JobListingValidationOptions
): boolean {
    const title = cleanJobTitle(job.title);
    if (!title) {
        return false;
    }

    if (validation && !isValidDetailUrl(job.detailUrl, validation)) {
        return false;
    } else if (!validation && !/(?:\/detail|\/job\/|position\/\d+|post_detail|jobUnionId|jobDetail|postid=)/i.test(job.detailUrl)) {
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
        .replace(/日常实习[:：][\s\S]*?(?=1、|1\.|职位要求|任职要求|$)/i, '')
        .replace(/团队介绍[:：][\s\S]*?(?=1、|1\.|一、|职位要求|任职要求|$)/i, '')
        .replace(/岗位职责[:：][\s\S]*?(?=职位要求|任职要求|岗位要求|$)/i, '')
        .replace(/的同学提供为期[\s\S]*?(?=1、|1\.|职位要求|任职要求|$)/i, '')
        .replace(/\s+/g, ' ')
        .slice(0, 800)
        .trim();
}
