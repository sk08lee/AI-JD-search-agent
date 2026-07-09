import { attachStructuredJobFields } from './careerJobFields.js';
import type { CareerJobListing, CareerJobType } from './careerJobSearch.js';

export interface PortalJsonFieldMapping {
    title: string;
    detailUrl: string;
    summary?: string;
    location?: string;
    responsibilities?: string;
    requirements?: string;
    jobType?: string;
}

export interface PortalJsonPathConfig {
    root: string;
    fields: PortalJsonFieldMapping;
}

export interface PortalJsonExtractionConfig {
    paths: PortalJsonPathConfig[];
}

export interface PortalAdapterDefaults {
    company?: string;
    sourceLabel?: string;
    jobType?: CareerJobType;
}

export function extractJobsFromEmbeddedJson(
    html: string,
    baseUrl: string,
    config: PortalJsonExtractionConfig | undefined,
    defaults: PortalAdapterDefaults = {}
): CareerJobListing[] {
    if (!config?.paths?.length) {
        return [];
    }

    const payloads = extractJsonPayloads(html);
    const jobs: CareerJobListing[] = [];

    for (const payload of payloads) {
        jobs.push(...extractJobsFromApiJson(payload, baseUrl, config, defaults));
    }

    return dedupeAdapterJobs(jobs);
}

export function extractJobsFromApiJson(
    payload: unknown,
    baseUrl: string,
    config: PortalJsonExtractionConfig | undefined,
    defaults: PortalAdapterDefaults = {}
): CareerJobListing[] {
    if (!config?.paths?.length) {
        return [];
    }

    const jobs: CareerJobListing[] = [];
    for (const pathConfig of config.paths) {
        const rootValue = readPath(payload, pathConfig.root);
        const items = Array.isArray(rootValue)
            ? rootValue
            : rootValue && typeof rootValue === 'object'
                ? [rootValue]
                : [];

        for (const item of items) {
            const listing = normalizeJsonJob(item, baseUrl, pathConfig.fields, defaults);
            if (listing) {
                jobs.push(listing);
            }
        }
    }

    return dedupeAdapterJobs(jobs);
}

function normalizeJsonJob(
    item: unknown,
    baseUrl: string,
    fields: PortalJsonFieldMapping,
    defaults: PortalAdapterDefaults
): CareerJobListing | null {
    const title = readString(item, fields.title);
    const rawUrl = readString(item, fields.detailUrl);
    if (!title || !rawUrl) {
        return null;
    }

    const responsibilities = fields.responsibilities ? readString(item, fields.responsibilities) : undefined;
    const requirements = fields.requirements ? readString(item, fields.requirements) : undefined;
    const summary = fields.summary
        ? readString(item, fields.summary)
        : [responsibilities, requirements].filter(Boolean).join(' ');

    return attachStructuredJobFields({
        title,
        detailUrl: resolveUrl(rawUrl, baseUrl),
        summary: summary || title,
        location: fields.location ? readString(item, fields.location) : undefined,
        responsibilities,
        requirements,
        jobType: normalizeJobType(fields.jobType ? readString(item, fields.jobType) : undefined) || defaults.jobType,
        company: defaults.company,
        sourceLabel: defaults.sourceLabel
    });
}

function extractJsonPayloads(html: string): unknown[] {
    const payloads: unknown[] = [];
    const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match: RegExpExecArray | null;

    while ((match = scriptPattern.exec(html)) !== null) {
        const script = decodeHtmlEntities((match[1] || '').trim());
        if (!script) continue;

        const direct = parseJson(script);
        if (direct !== undefined) {
            payloads.push(direct);
            continue;
        }

        for (const variable of ['__INITIAL_STATE__', '__NUXT__', '__APOLLO_STATE__']) {
            const extracted = extractAssignedObject(script, variable);
            if (extracted !== undefined) {
                payloads.push(extracted);
            }
        }
    }

    return payloads;
}

function extractAssignedObject(script: string, variableName: string): unknown {
    const marker = script.indexOf(variableName);
    if (marker < 0) return undefined;

    const objectStart = script.indexOf('{', marker);
    if (objectStart < 0) return undefined;

    let depth = 0;
    let inString = false;
    let stringQuote = '';
    let escaped = false;

    for (let i = objectStart; i < script.length; i++) {
        const char = script[i]!;
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === stringQuote) {
                inString = false;
            }
            continue;
        }

        if (char === '"' || char === "'") {
            inString = true;
            stringQuote = char;
            continue;
        }
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) {
            return parseJson(script.slice(objectStart, i + 1));
        }
    }

    return undefined;
}

function readString(source: unknown, path: string): string | undefined {
    const value = readPath(source, path);
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return undefined;
}

function readPath(source: unknown, path: string): unknown {
    if (!path) return source;
    const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let current = source as Record<string, unknown> | unknown[];

    for (const part of parts) {
        if (Array.isArray(current)) {
            const index = Number(part);
            if (!Number.isInteger(index)) return undefined;
            current = current[index] as Record<string, unknown> | unknown[];
            continue;
        }

        if (!current || typeof current !== 'object') {
            return undefined;
        }
        current = (current as Record<string, unknown>)[part] as Record<string, unknown> | unknown[];
    }

    return current;
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

function resolveUrl(url: string, baseUrl: string): string {
    try {
        return new URL(url, baseUrl).toString();
    } catch {
        return url;
    }
}

function normalizeJobType(value: string | undefined): CareerJobType | undefined {
    if (!value) return undefined;
    if (/实习|intern/i.test(value)) return 'internship';
    if (/校招|校园|应届|campus|graduate/i.test(value)) return 'campus';
    if (/社招|社会|experienced|full/i.test(value)) return 'experienced';
    return undefined;
}

function dedupeAdapterJobs(jobs: CareerJobListing[]): CareerJobListing[] {
    const seen = new Set<string>();
    const deduped: CareerJobListing[] = [];

    for (const job of jobs) {
        const key = `${job.detailUrl}::${job.title}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(job);
    }

    return deduped;
}

function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&quot;/g, '"')
        .replace(/&#34;/g, '"')
        .replace(/&#x22;/gi, '"')
        .replace(/&amp;/g, '&');
}
