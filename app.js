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
        btnText.textContent = '生成实习岗位需求报告';
        btnSpinner.style.display = 'none';
    }

    function showOutput(content) {
        outputContent.textContent = content;
        outputSection.style.display = 'block';
        outputSection.scrollIntoView({ behavior: 'smooth' });
    }

    function showCopySuccess() {
        const originalText = copyBtn.textContent;
        copyBtn.textContent = '已复制!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
            copyBtn.textContent = originalText;
            copyBtn.classList.remove('copied');
        }, 2000);
    }

    function fallbackCopyText(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '0';
        textarea.style.left = '0';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, text.length);
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (!copied) {
            throw new Error('execCommand copy failed');
        }
    }

    async function copyToClipboard() {
        const text = outputContent.textContent;
        if (!text || !text.trim()) {
            alert('暂无报告内容可复制，请先生成报告');
            return;
        }

        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                fallbackCopyText(text);
            }
            showCopySuccess();
        } catch (err) {
            try {
                fallbackCopyText(text);
                showCopySuccess();
            } catch (fallbackErr) {
                console.error('Failed to copy:', err, fallbackErr);
                alert('复制失败：当前浏览器在非 HTTPS 环境下可能限制剪贴板。请手动选中报告内容后复制。');
            }
        }
    }

    function generateMockReport(jobCategory, jobTitle) {
        const category = jobCategory || '实习';
        return `# ${jobTitle} 实习岗位需求报告

> 生成说明：本报告由前端模拟生成。完整功能需要部署后端服务。

## 一、公开招聘官网实习岗位（招聘条件）

（演示模式：请部署后端以抓取 11 家大厂实习官网）

## 二、结合本地岗位知识库归纳（能力要求与求职洞察）

本次搜索面向计算机专业研究生，岗位方向为「${category}」，具体实习岗位为「${jobTitle}」。

### 实习岗位特点

- 更关注学习能力、基础能力、工具使用经验和项目实践。
- 常见任务包括参与项目、文档整理和基础工作。
- 具备相关技术基础或项目经历会加分。

### 高频能力要求

- 专业技能
- 问题解决
- 团队协作
- 学习能力
- 技术文档

### 简历优化建议

- 将项目经历转化为具体成果。
- 强调技术深度和广度。
- 突出"问题 - 方案 - 实现 - 优化"的完整思路。

## 信息来源

- 当前模式：前端演示模式。
- 完整功能：需要配置 LLM API 密钥并部署后端服务。
`;
    }

    generateBtn.addEventListener('click', async () => {
        const jobCategory = jobCategoryInput.value.trim() || '实习';
        const jobTitle = jobTitleInput.value.trim();

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
