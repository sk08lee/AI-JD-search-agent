import type { CareerJobListing } from './careerJobSearch.js';

export interface JobStructuredFields {
    location?: string;
    schedule?: string;
    requirements?: string;
    responsibilities?: string;
}

const FIELD_PATTERNS: Array<{ key: keyof JobStructuredFields; labels: string[] }> = [
    {
        key: 'location',
        labels: ['工作（实习）地点', '实习地点', '工作地点', '工作地', '办公地点', '地点']
    },
    {
        key: 'schedule',
        labels: ['工作（实习）时间', '实习时间', '工作时间', '到岗时间', '工作周期', '实习周期']
    },
    {
        key: 'requirements',
        labels: ['招聘条件', '任职要求', '岗位要求', '任职资格', '职位要求', '应聘要求', '我们要求']
    },
    {
        key: 'responsibilities',
        labels: ['工作（实习）内容', '实习内容', '工作内容', '岗位职责', '职位描述', '工作职责', '岗位描述', '职责描述']
    }
];

const ALL_LABELS = FIELD_PATTERNS.flatMap((item) => item.labels)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex);

export function attachStructuredJobFields(job: CareerJobListing): CareerJobListing {
    const sourceText = [job.detailExcerpt, job.summary, job.title].filter(Boolean).join('\n');
    const fields = extractJobFields(sourceText);

    return {
        ...job,
        location: fields.location,
        schedule: fields.schedule,
        requirements: fields.requirements,
        responsibilities: fields.responsibilities
    };
}

export function extractJobFields(text: string): JobStructuredFields {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return {};
    }

    const fields: JobStructuredFields = {};
    for (const pattern of FIELD_PATTERNS) {
        const value = extractFieldValue(normalized, pattern.labels);
        if (value) {
            fields[pattern.key] = value;
        }
    }

    return fields;
}

export function formatStructuredJobListing(job: CareerJobListing, index: number): string {
    const enriched = attachStructuredJobFields(job);
    return [
        `${index + 1}. **${enriched.title}**`,
        `- 工作（实习）地点：${enriched.location || '未提取'}`,
        `- 工作（实习）时间：${enriched.schedule || '未提取'}`,
        `- 招聘条件：${enriched.requirements || '未提取'}`,
        `- 工作（实习）内容：${enriched.responsibilities || '未提取'}`,
        `- 来源：${enriched.detailUrl}`
    ].join('\n');
}

function extractFieldValue(text: string, labels: string[]): string | undefined {
    for (const label of labels.sort((a, b) => b.length - a.length)) {
        const regex = new RegExp(`${escapeRegex(label)}\\s*[:：]?\\s*([\\s\\S]{0,800})`, 'i');
        const match = text.match(regex);
        if (!match?.[1]) continue;

        const cleaned = cleanupExtractedValue(match[1]);
        if (cleaned) {
            return cleaned;
        }
    }
    return undefined;
}

function cleanupExtractedValue(raw: string): string {
    const nextLabelRegex = new RegExp(`\\s(?:${ALL_LABELS.join('|')})\\s*[:：]`, 'i');
    const cut = raw.split(nextLabelRegex)[0]?.trim() || raw.trim();
    return cut
        .replace(/^[\-·•\d\.、)\]】\s]+/, '')
        .replace(/\s+/g, ' ')
        .slice(0, 500)
        .trim();
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
