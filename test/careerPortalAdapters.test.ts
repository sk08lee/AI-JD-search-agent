import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    extractJobsFromApiJson,
    extractJobsFromEmbeddedJson,
    type PortalJsonExtractionConfig
} from "../src/careerPortalAdapters";

const jsonConfig: PortalJsonExtractionConfig = {
    paths: [
        {
            root: "props.pageProps.jobs",
            fields: {
                title: "title",
                detailUrl: "url",
                location: "city",
                responsibilities: "responsibilities",
                requirements: "requirements"
            }
        }
    ]
};

describe("career portal adapters", () => {
    it("extracts jobs from embedded frontend JSON and resolves relative URLs", () => {
        const html = `
<html>
  <body>
    <script id="__NEXT_DATA__" type="application/json">
      {"props":{"pageProps":{"jobs":[{"title":"AI产品经理实习生","url":"/jobs/123","city":"北京","responsibilities":"负责需求分析","requirements":"熟悉 LLM 产品"}]}}}
    </script>
  </body>
</html>`;

        const jobs = extractJobsFromEmbeddedJson(html, "https://careers.example.com/search", jsonConfig, {
            company: "示例公司",
            sourceLabel: "实习招聘",
            jobType: "internship"
        });

        assert.equal(jobs.length, 1);
        assert.equal(jobs[0].title, "AI产品经理实习生");
        assert.equal(jobs[0].detailUrl, "https://careers.example.com/jobs/123");
        assert.equal(jobs[0].location, "北京");
        assert.equal(jobs[0].company, "示例公司");
        assert.equal(jobs[0].jobType, "internship");
    });

    it("extracts jobs from public API JSON payloads", () => {
        const payload = {
            data: {
                list: [
                    {
                        name: "Java后端开发实习生",
                        link: "https://careers.example.com/jobs/java",
                        workCity: "深圳",
                        duty: "参与后端服务开发",
                        qualification: "熟悉 Java 和数据库"
                    }
                ]
            }
        };
        const config: PortalJsonExtractionConfig = {
            paths: [
                {
                    root: "data.list",
                    fields: {
                        title: "name",
                        detailUrl: "link",
                        location: "workCity",
                        responsibilities: "duty",
                        requirements: "qualification"
                    }
                }
            ]
        };

        const jobs = extractJobsFromApiJson(payload, "https://careers.example.com/api/jobs", config, {
            company: "示例公司",
            jobType: "internship"
        });

        assert.equal(jobs.length, 1);
        assert.equal(jobs[0].title, "Java后端开发实习生");
        assert.equal(jobs[0].requirements, "熟悉 Java 和数据库");
    });
});
