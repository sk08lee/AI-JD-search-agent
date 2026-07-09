import type { CareerFetchResult } from './careerPortalFetcher.js';
import { formatCareerFetchContext } from './careerPortalFetcher.js';

export interface MergeContextOptions {
    ragContext: string;
    careerResults: CareerFetchResult[];
    keyword: string;
    jobCategory?: string;
}

export function buildMergedReportContext(options: MergeContextOptions): string {
    const webSection = formatCareerFetchContext(options.careerResults, options.keyword, options.jobCategory);
    const ragSection = formatRagKnowledgeSection(options.ragContext);

    const sections: string[] = [
        '## 结构化检索上下文（供报告生成使用）',
        '以下内容分为两部分：',
        '- **官网实时岗位**：仅保留招聘条件，必须标注来源 URL，不得编造。',
        '- **本地岗位知识库**：与第一章官网招聘条件一并作为归纳素材，用于生成第二章「能力要求与求职洞察」；不得单独原样堆砌，也不得改写为某公司具体在招岗位。'
    ];

    if (webSection) {
        sections.push(webSection);
    }

    if (ragSection) {
        sections.push(ragSection);
    }

    if (!webSection && !ragSection) {
        return '';
    }

    return sections.join('\n\n');
}

export function formatRagKnowledgeSection(ragContext: string): string {
    const trimmed = ragContext.trim();
    if (!trimmed) {
        return '';
    }

    return [
        '## 本地岗位知识库召回（归纳素材）',
        trimmed,
        '说明：以上内容来自本地岗位知识库 embedding 召回，须与第一章官网招聘条件一并归纳，用于生成「能力要求 / 技术栈 / 项目经历 / 简历优化」；不要将其表述为某家公司当前正在招聘的具体岗位事实。'
    ].join('\n\n');
}

export function extractMergedSections(context: string): { webSection: string; ragSection: string } {
    const webMarker = '## 自动检索的公开招聘官网岗位信息';
    const ragMarker = '## 本地岗位知识库召回（归纳素材）';

    const webSection = extractBetween(context, webMarker, ragMarker);
    const ragSection = extractBetween(context, ragMarker, null);

    return { webSection, ragSection };
}

function extractBetween(text: string, startMarker: string, endMarker: string | null): string {
    if (!text.includes(startMarker)) {
        return '';
    }

    const start = text.indexOf(startMarker);
    let end = text.length;

    if (endMarker && text.indexOf(endMarker, start + startMarker.length) >= 0) {
        end = text.indexOf(endMarker, start + startMarker.length);
    } else {
        const divider = text.indexOf('\n\n---\n\n', start);
        if (divider >= 0) {
            end = divider;
        }
    }

    return text.slice(start, end).trim();
}
