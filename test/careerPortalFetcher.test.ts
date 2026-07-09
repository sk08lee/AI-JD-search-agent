import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
    buildPortalTargets,
    loadCareerPortals,
    type CareerPortal
} from "../src/careerPortalFetcher";

describe("career portal fetch target selection", () => {
    it("filters targets by selected companies and job type", () => {
        const portals: CareerPortal[] = [
            {
                company: "腾讯",
                channel: "internship",
                jobType: "internship",
                url: "https://join.qq.com",
                searchUrl: "https://join.qq.com/search?keyword={keyword}"
            },
            {
                company: "腾讯",
                channel: "experienced",
                jobType: "experienced",
                url: "https://careers.tencent.com",
                searchUrl: "https://careers.tencent.com/search?keyword={keyword}"
            },
            {
                company: "字节跳动",
                channel: "internship",
                jobType: "internship",
                url: "https://jobs.bytedance.com",
                searchUrl: "https://jobs.bytedance.com/search?keyword={keyword}"
            }
        ];

        const targets = buildPortalTargets(portals, "AI产品经理", 10, {
            companies: ["腾讯"],
            jobType: "internship"
        });

        assert.equal(targets.length, 1);
        assert.equal(targets[0].company, "腾讯");
        assert.equal(targets[0].targetUrl, "https://join.qq.com/search?keyword=AI%E4%BA%A7%E5%93%81%E7%BB%8F%E7%90%86");
    });

    it("can load non-internship portal definitions when explicitly requested", () => {
        const originalEnv = process.env.CAREER_INTERNSHIP_ONLY;
        const originalCwd = process.cwd();
        process.env.CAREER_INTERNSHIP_ONLY = "1";

        try {
            process.chdir(path.join(originalCwd, "test", "fixtures", "career-loader"));

            const internshipOnly = loadCareerPortals(false);
            const allPortals = loadCareerPortals(true);

            assert.deepEqual(internshipOnly.map((portal) => portal.channel), ["internship"]);
            assert.deepEqual(allPortals.map((portal) => portal.channel), ["internship", "campus"]);
        } finally {
            process.chdir(originalCwd);
            if (originalEnv === undefined) {
                delete process.env.CAREER_INTERNSHIP_ONLY;
            } else {
                process.env.CAREER_INTERNSHIP_ONLY = originalEnv;
            }
        }
    });
});
