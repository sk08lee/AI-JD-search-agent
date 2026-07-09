import { requirementsOnlyUserPrompt } from './requirementsOnlyPrompt.js';

export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  userPrompt: string;
  reportTemplate: string;
  knowledgeBaseDir: string;
}

export const taskTemplates: Record<string, TaskTemplate> = {
  'ai-product-manager': {
    id: 'ai-product-manager',
    name: 'AI 产品经理岗位搜索',
    description: '搜索 AI 产品经理相关岗位需求',
    systemPrompt: `你是一个严谨的 AI 求职研究助手。你需要区分事实、推断和建议。
涉及岗位信息时，优先引用公开来源或本地知识库内容；如果信息不足，明确提醒用户补充来源。`,
    userPrompt: requirementsOnlyUserPrompt,
    reportTemplate: 'job-demand-report',
    knowledgeBaseDir: 'knowledge/jobs/ai_product_manager'
  },
  'software-engineer': {
    id: 'software-engineer',
    name: '软件工程师岗位搜索',
    description: '搜索软件工程师相关岗位需求',
    systemPrompt: `你是一个严谨的技术求职研究助手。你需要区分事实、推断和建议。
涉及岗位信息时，优先引用公开来源或本地知识库内容；如果信息不足，明确提醒用户补充来源。`,
    userPrompt: requirementsOnlyUserPrompt,
    reportTemplate: 'job-demand-report',
    knowledgeBaseDir: 'knowledge/jobs/software_engineer'
  },
  'data-analyst': {
    id: 'data-analyst',
    name: '数据分析岗位搜索',
    description: '搜索数据分析相关岗位需求',
    systemPrompt: `你是一个严谨的数据分析求职研究助手。你需要区分事实、推断和建议。
涉及岗位信息时，优先引用公开来源或本地知识库内容；如果信息不足，明确提醒用户补充来源。`,
    userPrompt: requirementsOnlyUserPrompt,
    reportTemplate: 'job-demand-report',
    knowledgeBaseDir: 'knowledge/jobs/data_analyst'
  }
};

export function getTaskById(id: string): TaskTemplate | undefined {
  return taskTemplates[id];
}

export function listTasks(): { id: string; name: string; description: string }[] {
  return Object.entries(taskTemplates).map(([key, template]) => ({
    id: key,
    name: template.name,
    description: template.description
  }));
}