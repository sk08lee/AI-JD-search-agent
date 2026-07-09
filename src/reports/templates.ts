import { extractMergedSections } from '../careerContextMerger.js';

export interface ReportTemplate {
  id: string;
  name: string;
  sections: string[];
  fallback: (context: string, error: unknown, jobTitle: string) => string;
}

function generateJobDemandReport(context: string, error: unknown, jobTitle: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const { webSection, ragSection } = extractMergedSections(context);

  if (webSection || ragSection) {
    const body = [webSection, ragSection].filter(Boolean).join('\n\n');
    return `# ${jobTitle}岗位需求报告

> 说明：LLM 调用失败（${message}），以下内容由系统自动抓取与本地知识库直接整理。

${body}`;
  }

  return `# ${jobTitle}岗位需求报告

> 生成说明：LLM 调用失败，以下报告由本地岗位知识库降级生成。失败原因：${message}

## 岗位搜索概览

本次搜索面向计算机专业研究生，目标岗位为${jobTitle}。由于在线 LLM 接口不可用，本报告仅基于本地 RAG 召回内容生成。

## 附：本地 RAG 召回片段

\`\`\`md
${context.slice(0, 3000)}
\`\`\`
`;
}

export const reportTemplates: Record<string, ReportTemplate> = {
  'job-demand-report': {
    id: 'job-demand-report',
    name: '岗位需求报告',
    sections: [
      '公开招聘官网岗位（招聘条件）',
      '结合本地岗位知识库归纳（能力要求与求职洞察）'
    ],
    fallback: generateJobDemandReport
  }
};

export function getReportTemplate(id: string): ReportTemplate | undefined {
  return reportTemplates[id];
}
