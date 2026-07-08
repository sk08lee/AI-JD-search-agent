document.addEventListener('DOMContentLoaded', () => {
    const jobCategoryInput = document.getElementById('job-category');
    const jobTitleInput = document.getElementById('job-title');
    const generateBtn = document.getElementById('generate-btn');
    const outputSection = document.getElementById('output-section');
    const outputContent = document.getElementById('output-content');
    const loading = document.getElementById('loading');
    const copyBtn = document.getElementById('copy-btn');
    const btnText = document.querySelector('.btn-text');
    const btnSpinner = document.querySelector('.btn-spinner');

    const API_BASE = '';

    function showLoading() {
        loading.style.display = 'block';
        outputSection.style.display = 'none';
        generateBtn.disabled = true;
        btnText.textContent = '生成中...';
        btnSpinner.style.display = 'inline';
    }

    function hideLoading() {
        loading.style.display = 'none';
        generateBtn.disabled = false;
        btnText.textContent = '生成岗位需求报告';
        btnSpinner.style.display = 'none';
    }

    function showOutput(content) {
        outputContent.textContent = content;
        outputSection.style.display = 'block';
        outputSection.scrollIntoView({ behavior: 'smooth' });
    }

    function copyToClipboard() {
        const text = outputContent.textContent;
        if (!text) return;

        navigator.clipboard.writeText(text).then(() => {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = '已复制!';
            copyBtn.classList.add('copied');
            setTimeout(() => {
                copyBtn.textContent = originalText;
                copyBtn.classList.remove('copied');
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy:', err);
        });
    }

    function generateMockReport(jobCategory, jobTitle) {
        return `# ${jobTitle} 岗位需求报告

> 生成说明：本报告由前端模拟生成。完整功能需要部署后端服务。

## 1. 岗位搜索概览

本次搜索面向计算机专业研究生，岗位类型为「${jobCategory}」，具体岗位为「${jobTitle}」。

## 2. 实习 / 校招 / 社招岗位差异

### 实习 internship

- 更关注学习能力、基础能力、工具使用经验和项目实践。
- 常见任务包括参与项目、文档整理和基础工作。
- 具备相关技术基础或项目经历会加分。

### 校招 campus

- 更关注完整项目经历、技术理解能力和团队协作潜力。
- 需要能独立完成任务、方案设计和问题排查。
- 相关专业背景有优势。

### 社招 experienced

- 更关注业务落地、系统设计和领导力。
- 需要理解复杂系统架构、技术选型和团队管理。
- 通常要求有完整项目经验。

## 3. 高频能力要求

- 专业技能
- 问题解决
- 团队协作
- 学习能力
- 技术文档

## 4. 高频技术关键词

根据 ${jobCategory} 岗位类型有所不同，通常包括数据结构、算法、数据库、网络等基础技能。

## 5. 常见项目经历要求

- 有完整项目开发或实践经历。
- 能说明技术方案如何解决实际问题。
- 能输出技术文档和代码。

## 6. 简历优化建议

- 将项目经历转化为具体成果。
- 强调技术深度和广度。
- 突出"问题 - 方案 - 实现 - 优化"的完整思路。

## 7. 信息来源

- 当前模式：前端演示模式。
- 完整功能：需要配置 LLM API 密钥并部署后端服务。
`;
    }

    generateBtn.addEventListener('click', async () => {
        const jobCategory = jobCategoryInput.value.trim();
        const jobTitle = jobTitleInput.value.trim();

        if (!jobCategory) {
            alert('请输入岗位类型，例如：产品、技术');
            return;
        }

        if (!jobTitle) {
            alert('请输入具体岗位名称，例如：AI产品经理、Java后端开发');
            return;
        }

        showLoading();

        try {
            const response = await fetch(`${API_BASE}/api/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    taskId: 'custom',
                    jobCategory,
                    jobTitle
                })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    showOutput(data.content);
                    hideLoading();
                    return;
                }
            }
        } catch (error) {
            console.log('API unavailable, using mock data');
        }

        showOutput(generateMockReport(jobCategory, jobTitle));
        hideLoading();
    });

    copyBtn.addEventListener('click', copyToClipboard);
});
