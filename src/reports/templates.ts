export interface ReportTemplate {
  id: string;
  name: string;
  sections: string[];
  fallback: (context: string, error: unknown, jobTitle: string) => string;
}

function generateJobDemandReport(context: string, error: unknown, jobTitle: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return `# ${jobTitle}岗位需求报告

> 生成说明：LLM 调用失败，以下报告由本地岗位知识库降级生成。失败原因：${message}

## 1. 岗位搜索概览

本次搜索面向计算机专业研究生，目标岗位为${jobTitle}。由于在线 LLM 接口不可用，本报告仅基于本地 RAG 召回内容生成，不包含实时公开网页检索结果。

## 2. 实习 / 校招 / 社招岗位差异

### 实习 internship

- 更关注学习能力、基础技术能力、工具使用经验和项目实践。
- 常见任务包括参与项目开发、代码编写、文档整理、测试和调试。
- 具备相关技术栈基础或开源项目经历会加分。

### 校招 campus

- 更关注完整项目经历、技术理解能力和团队协作潜力。
- 需要能独立完成模块开发、技术方案设计和问题排查。
- 计算机、人工智能、软件工程等相关背景有优势。

### 社招 experienced

- 更关注业务落地、系统设计和技术领导力。
- 需要理解复杂系统架构、技术选型、性能优化和团队管理。
- 通常要求有完整项目从 0 到 1 或从 1 到 N 的经验。

## 3. 高频能力要求

- 编程能力
- 系统设计
- 问题排查
- 团队协作
- 学习能力
- 技术文档

## 4. 高频技术关键词

- 数据结构与算法
- 系统设计
- 数据库
- 网络基础
- 编程语言
- 框架与工具

## 5. 常见项目经历要求

- 有完整项目开发或实践经历。
- 能说明技术方案如何解决实际问题。
- 能输出技术文档、设计方案和代码。
- 能描述技术选型和权衡。

## 6. 对计算机研究生的简历优化建议

- 将学术项目转化为工程实践经验。
- 强调技术深度和广度。
- 简历项目建议突出"问题 - 方案 - 实现 - 优化"的完整思路。
- 重点展示编码能力、系统设计能力和技术热情。

## 7. 简历匹配点

- 使用 RAG 复用岗位知识库，体现技术应用能力。
- 使用 MCP 连接工具，体现系统集成能力。
- 按实习、校招、社招分类岗位需求，体现结构化分析能力。
- 输出岗位需求报告，体现从信息检索到用户交付的闭环。

## 8. 信息来源和待补充来源

- 已使用：本地岗位知识库。
- 待补充：公司招聘官网、校招官网、公开招聘页面。
- 当前限制：LLM API 调用失败，未执行在线信息抽取。

## 附：本地 RAG 召回片段

\`\`\`md
${context}
\`\`\`
`;
}

export const reportTemplates: Record<string, ReportTemplate> = {
  'job-demand-report': {
    id: 'job-demand-report',
    name: '岗位需求报告',
    sections: [
      '岗位搜索概览',
      '实习/校招/社招岗位差异',
      '高频能力要求',
      '高频技术关键词',
      '常见项目经历要求',
      '简历优化建议',
      '项目匹配点',
      '信息来源'
    ],
    fallback: generateJobDemandReport
  }
};

export function getReportTemplate(id: string): ReportTemplate | undefined {
  return reportTemplates[id];
}