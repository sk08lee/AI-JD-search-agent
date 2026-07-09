import 'dotenv/config';
import {
    loadCareerPortals,
    selectOnePortalPerCompany
} from '../src/careerPortalFetcher.js';
import { attachStructuredJobFields, isValidJobListing } from '../src/careerJobFields.js';
import { buildValidationOptions } from '../src/careerJobValidation.js';
import { searchPortalJobs } from '../src/careerJobSearch.js';

const TARGET_COMPANIES = ['腾讯', '美团', '京东', '阿里巴巴'];
const KEYWORD = 'AI产品经理';

async function testCompany(portal: ReturnType<typeof selectOnePortalPerCompany>[number]) {
    const listKeyword = portal.search?.listSearchKeyword?.trim() || KEYWORD;
    const encoded = encodeURIComponent(listKeyword);
    const targetUrl = (portal.searchUrl || portal.url).replace(/\{keyword\}/g, encoded);
    const fetchMode = portal.fetchMode || 'html';

    console.log(`\n${'='.repeat(60)}`);
    console.log(`公司: ${portal.company} | 入口: ${portal.label}`);
    console.log(`搜索URL: ${targetUrl}`);
    console.log(`模式: ${fetchMode} | 列表关键词: ${listKeyword} | 完整关键词: ${KEYWORD}`);

    const started = Date.now();
    const result = await searchPortalJobs({
        searchUrl: targetUrl,
        landingUrl: portal.url,
        keyword: KEYWORD,
        fetchMode,
        waitMs: portal.waitMs || 7000,
        search: portal.search,
        company: portal.company,
        sourceLabel: portal.label
    });

    const validation = buildValidationOptions(portal.search);
    const validJobs = result.jobs
        .map(attachStructuredJobFields)
        .filter((job) => isValidJobListing(job, validation));

    console.log(`耗时: ${((Date.now() - started) / 1000).toFixed(1)}s`);
    console.log(`候选: ${result.jobs.length} | 有效(含招聘条件): ${validJobs.length}`);
    if (result.error) {
        console.log(`错误: ${result.error}`);
    }

    for (const job of validJobs.slice(0, 3)) {
        console.log(`  ✓ ${job.title}`);
        console.log(`    来源: ${job.detailUrl}`);
        console.log(`    条件: ${(job.requirements || '').slice(0, 100)}...`);
    }

    if (validJobs.length === 0 && result.jobs.length > 0) {
        console.log('  (有候选但未通过有效岗位校验，前 2 条候选:)');
        for (const job of result.jobs.slice(0, 2)) {
            const enriched = attachStructuredJobFields(job);
            console.log(`  · ${enriched.title} | requirements=${!!enriched.requirements}`);
            console.log(`    ${job.detailUrl}`);
        }
    }

    return {
        company: portal.company,
        candidates: result.jobs.length,
        valid: validJobs.length,
        error: result.error
    };
}

async function main() {
    process.env.ENABLE_PLAYWRIGHT_FETCH = '1';
    process.env.PLAYWRIGHT_CHANNEL = process.env.PLAYWRIGHT_CHANNEL || 'msedge';

    const portals = selectOnePortalPerCompany(loadCareerPortals())
        .filter((portal) => TARGET_COMPANIES.includes(portal.company));

    console.log(`测试关键词: ${KEYWORD}`);
    console.log(`目标公司: ${TARGET_COMPANIES.join('、')} (共 ${portals.length} 个入口)`);

    const summaries = [];
    for (const portal of portals) {
        try {
            summaries.push(await testCompany(portal));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`\n[FAIL] ${portal.company}: ${message}`);
            summaries.push({ company: portal.company, candidates: 0, valid: 0, error: message });
        }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log('汇总:');
    for (const item of summaries) {
        const status = item.valid > 0 ? 'OK' : item.candidates > 0 ? 'PARTIAL' : 'FAIL';
        console.log(`  [${status}] ${item.company}: 有效 ${item.valid} / 候选 ${item.candidates}${item.error ? ` (${item.error})` : ''}`);
    }

    const totalValid = summaries.reduce((sum, item) => sum + item.valid, 0);
    console.log(`\n合计有效岗位: ${totalValid}`);
    process.exit(totalValid > 0 ? 0 : 1);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
