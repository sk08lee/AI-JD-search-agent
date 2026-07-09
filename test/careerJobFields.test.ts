import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    attachStructuredJobFields,
    extractLocation,
    extractRequirements,
    extractResponsibilities,
    inferJobType
} from "../src/careerJobFields";

describe("career job field extraction", () => {
    it("extracts core JD fields from a Chinese detail page", () => {
        const detailText = `
AI产品经理实习生
工作地点：北京
岗位职责：
1. 参与大模型产品需求分析和竞品研究；
2. 协助跟进 Agent 原型落地。
任职要求：
1. 计算机或人工智能相关专业，本科及以上学历；
2. 熟悉 LLM、Prompt Engineering，有产品实习或项目经验。
`;

        assert.equal(extractLocation(detailText), "北京");
        assert.equal(inferJobType("AI产品经理实习生", detailText), "internship");
        assert.match(extractResponsibilities(detailText) || "", /大模型产品需求分析/);
        assert.match(extractRequirements(detailText) || "", /Prompt Engineering/);
    });

    it("preserves explicit adapter fields while filling missing fields from text", () => {
        const listing = attachStructuredJobFields({
            title: "岗位详情",
            detailUrl: "https://example.com/jobs/pm-intern",
            summary: "AI产品经理实习生 工作地点：上海 任职要求：熟悉 AI 产品，有项目经验。",
            requirements: "熟悉 AI 产品，有项目经验。",
            responsibilities: "参与 AI 产品需求分析。",
            jobType: "internship",
            company: "示例公司"
        });

        assert.equal(listing.title, "AI产品经理实习生");
        assert.equal(listing.location, "上海");
        assert.equal(listing.requirements, "熟悉 AI 产品，有项目经验。");
        assert.equal(listing.responsibilities, "参与 AI 产品需求分析。");
        assert.equal(listing.jobType, "internship");
    });
});
