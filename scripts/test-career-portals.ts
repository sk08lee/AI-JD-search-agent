import 'dotenv/config';
import {
    aggregateCareerResults,
    loadCareerPortals,
    selectOnePortalPerCompany
} from '../src/careerPortalFetcher.js';
import { searchPortalJobs } from '../src/careerJobSearch.js';

const KEYWORD = process.env.TEST_KEYWORD || 'AI产品经理';

async function testCompany(portal: ReturnType<typeof selectOnePortalPerCompany>[number]) {
    const listKeyword = portal.search?.listSearchKeyword?.trim() || KEYWORD;
    const encoded = encodeURIComponent(listKeyword);
    const targetUrl = (portal.searchUrl || portal.url).replace(/\{keyword\}/g, encoded);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`公司: ${portal.company}`);
    console.log(`URL: ${targetUrl}`);

    const started = Date.now();
    const searchResult = await searchPortalJobs({
        searchUrl: targetUrl,
        landingUrl: portal.url,
        keyword: KEYWORD,
        fetchMode: portal.fetchMode || 'playwright',
        waitMs: portal.waitMs || 8000,
        search: portal.search,
        company: portal.company,
        sourceLabel: portal.label
    });

    const aggregated = aggregateCareerResults([{
        company: portal.company,
        label: portal.label,
        url: searchResult.searchUrl,
        status: searchResult.error ? 'failed' : 'success',
        fetchMode: portal.fetchMode || 'playwright',
        jobs: searchResult.jobs,
        search: portal.search,
        error: searchResult.error
    }], KEYWORD);

    const valid = aggregated.reduce((sum, item) => sum + item.jobs.length, 0);
    console.log(`耗时: ${((Date.now() - started) / 1000).toFixed(1)}s | 候选: ${searchResult.jobs.length} | 有效: ${valid}`);
    if (searchResult.error) {
        console.log(`错误: ${searchResult.error}`);
    }

    for (const item of aggregated) {
        for (const job of item.jobs.slice(0, 2)) {
            console.log(`  ✓ ${job.title}`);
            console.log(`    ${job.detailUrl}`);
        }
    }

    return { company: portal.company, candidates: searchResult.jobs.length, valid, error: searchResult.error };
}

async function main() {
    process.env.ENABLE_PLAYWRIGHT_FETCH = '1';
    process.env.CAREER_INTERNSHIP_ONLY = '1';
    process.env.PLAYWRIGHT_CHANNEL = process.env.PLAYWRIGHT_CHANNEL || 'msedge';

    const portals = selectOnePortalPerCompany(loadCareerPortals());
    console.log(`测试关键词: ${KEYWORD} | 公司数: ${portals.length}`);

    const summaries = [];
    for (const portal of portals) {
        try {
            summaries.push(await testCompany(portal));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[FAIL] ${portal.company}: ${message}`);
            summaries.push({ company: portal.company, candidates: 0, valid: 0, error: message });
        }
    }

    console.log(`\n${'='.repeat(60)}`);
    for (const item of summaries) {
        const status = item.valid > 0 ? 'OK' : item.candidates > 0 ? 'PARTIAL' : 'FAIL';
        console.log(`[${status}] ${item.company}: 有效 ${item.valid} / 候选 ${item.candidates}`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
