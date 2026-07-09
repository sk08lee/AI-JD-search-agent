import type { CareerJobListing, CareerJobType } from './careerJobSearch.js';
import type { JobListingValidationOptions } from './careerJobValidation.js';
import { isValidDetailUrl } from './careerJobValidation.js';

const REQUIREMENT_SECTION_PATTERNS = [
    /职位要求[\s:：]*([\s\S]*?)(?=岗位职责|工作职责|职位描述|投递|相关职位|工作地点|展开地图|点击申请|立即申请|职位 ID|职位ID|$)/i,
    /任职要求[\s:：]*([\s\S]*?)(?=岗位职责|工作职责|职位描述|投递|相关职位|工作地点|职位 ID|职位ID|$)/i,
    /岗位要求[\s:：]*([\s\S]*?)(?=岗位职责|工作职责|职位描述|投递|相关职位|工作地点|职位 ID|职位ID|$)/i,
    /招聘条件[\s:：]*([\s\S]*?)(?=岗位职责|工作职责|职位描述|投递|相关职位|工作地点|职位 ID|职位ID|$)/i,
    /招聘要求[\s:：]*([\s\S]*?)(?=岗位职责|工作职责|职位描述|投递|相关职位|工作地点|职位 ID|职位ID|$)/i,
    /基本要求[\s:：]*([\s\S]*?)(?=投递|优先条件|工作地点|职位 ID|职位ID|$)/i,
    /优先条件[\s:：]*([\s\S]*?)(?=投递|工作地点|职位 ID|职位ID|$)/i,
    /(?:^|\s)(1[、\.．]\s*(?:本科|硕士|博士|学历|英语|熟悉|了解|具备|有).{10,800})/i
];

const RESPONSIBILITY_SECTION_PATTERNS = [
    /岗位职责[\s:：]*([\s\S]*?)(?=职位要求|任职要求|岗位要求|招聘条件|招聘要求|基本要求|投递|工作地点|职位 ID|职位ID|$)/i,
    /工作职责[\s:：]*([\s\S]*?)(?=职位要求|任职要求|岗位要求|招聘条件|招聘要求|基本要求|投递|工作地点|职位 ID|职位ID|$)/i,
    /职位描述[\s:：]*([\s\S]*?)(?=职位要求|任职要求|岗位要求|招聘条件|招聘要求|基本要求|投递|工作地点|职位 ID|职位ID|$)/i,
    /岗位描述[\s:：]*([\s\S]*?)(?=职位要求|任职要求|岗位要求|招聘条件|招聘要求|基本要求|投递|工作地点|职位 ID|职位ID|$)/i,
    /工作内容[\s:：]*([\s\S]*?)(?=职位要求|任职要求|岗位要求|招聘条件|招聘要求|基本要求|投递|工作地点|职位 ID|职位ID|$)/i
];

export function cleanJobTitle(raw: string): string {
    let title = raw
        .split(/职位 ID|职位ID|更新于|岗位职责|职位要求/i)[0]
        ?.replace(/\s+/g, ' ')
        .trim() || raw;

    const withIntern = title.match(/(.{2,70}(?:日常实习|实习生))/);
    if (withIntern) {
        return withIntern[1].trim().slice(0, 80);
    }

    const named = raw.match(/((?:AI|Java|Python|前端|后端|数据|产品)[^\s-]{0,40}(?:实习生|工程师|经理|产品|运营|分析师)[^\s]{0,20})/i);
    if (named?.[1]) {
        title = named[1].trim();
    }

    return title.slice(0, 80).trim();
}

export function extractRequirements(text: string): string | undefined {
    const normalized = text.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').trim();
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

export function extractResponsibilities(text: string): string | undefined {
    const normalized = text.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').trim();
    if (!normalized) return undefined;

    for (const pattern of RESPONSIBILITY_SECTION_PATTERNS) {
        const match = normalized.match(pattern);
        if (!match?.[1]) continue;

        const cleaned = cleanRequirementText(match[1]);
        if (cleaned.length >= 8) {
            return cleaned;
        }
    }

    return undefined;
}

export function extractLocation(text: string): string | undefined {
    const normalized = text.replace(/\s+/g, ' ').trim();
    const match = normalized.match(/(?:工作地点|办公地点|地点|城市)[\s:：]*([^\s，,。；;|/]{2,30})/i);
    return match?.[1]?.trim();
}

export function inferJobType(title: string, text = ''): CareerJobType | undefined {
    const source = `${title} ${text}`;
    if (/实习|intern/i.test(source)) return 'internship';
    if (/校招|校园招聘|应届|campus|graduate/i.test(source)) return 'campus';
    if (/社招|社会招聘|全职|工作经验|年经验|experienced/i.test(source)) return 'experienced';
    return undefined;
}

export function attachStructuredJobFields(job: CareerJobListing): CareerJobListing {
    const sourceText = [job.detailExcerpt, job.summary, job.title].filter(Boolean).join('\n');
    let title = cleanJobTitle(job.title);
    if (!title || title === '岗位详情') {
        const titleFromText = cleanJobTitle(sourceText);
        if (titleFromText && titleFromText !== '岗位详情') {
            title = titleFromText;
        }
    }
    const requirements = job.requirements?.trim() || extractRequirements(sourceText);
    const responsibilities = job.responsibilities?.trim() || extractResponsibilities(sourceText);
    const location = job.location?.trim() || extractLocation(sourceText);
    const jobType = job.jobType || inferJobType(title, sourceText);

    return {
        ...job,
        title,
        location,
        responsibilities,
        requirements,
        jobType
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

export function passesJobTypeFilter(job: CareerJobListing, requestedType: CareerJobType = 'internship'): boolean {
    if (requestedType === 'all') {
        return true;
    }
    if (requestedType === 'internship') {
        return passesInternshipFilter(job);
    }
    return job.jobType === requestedType || inferJobType(job.title, `${job.summary} ${job.detailExcerpt || ''}`) === requestedType;
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
        enriched.location ? `- 地点：${enriched.location}` : '',
        enriched.jobType ? `- 岗位类型：${formatJobType(enriched.jobType)}` : '',
        enriched.responsibilities ? `- 岗位职责：${enriched.responsibilities}` : '',
        `- 招聘条件：${enriched.requirements}`,
        `- 来源：${enriched.detailUrl}`
    ].filter(Boolean).join('\n');
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

function formatJobType(jobType: CareerJobType): string {
    switch (jobType) {
        case 'internship':
            return '实习';
        case 'campus':
            return '校招';
        case 'experienced':
            return '社招';
        case 'all':
            return '不限';
    }
}
