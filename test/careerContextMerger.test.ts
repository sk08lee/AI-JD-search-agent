import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractMergedSections } from "../src/careerContextMerger";

describe("career context merger", () => {
    it("extracts the current internship web section title for degraded reports", () => {
        const context = [
            "## 结构化检索上下文（供报告生成使用）",
            "## 自动检索的公开招聘官网实习岗位信息",
            "腾讯岗位信息",
            "## 本地岗位知识库召回（归纳素材）",
            "本地知识"
        ].join("\n\n");

        const sections = extractMergedSections(context);

        assert.match(sections.webSection, /腾讯岗位信息/);
        assert.match(sections.ragSection, /本地知识/);
    });
});
