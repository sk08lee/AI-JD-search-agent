# AI Agent 岗位搜索助手产品原型

> 基于 LLM + MCP + RAG 的求职信息研究助手，面向应届生、实习生和计算机专业研究生，帮助用户搜索公开岗位信息并生成岗位需求报告。

## 项目定位

这个项目基于原有 `LLM + MCP + RAG` 技术底座，进一步产品化为一个垂直场景 Agent：

**用户输入想了解的岗位方向后，Agent 会结合本地岗位知识库和公开招聘网页，按实习、校招、社招三类整理岗位要求，并生成 Markdown 岗位需求报告。**

它不是一个通用聊天机器人，而是一个围绕“求职岗位研究”设计的 AI Agent 产品原型。

## 目标用户

- 计算机、人工智能、软件工程等专业的研究生。
- 准备投递 AI 产品经理、大模型产品经理、AI Agent 产品经理岗位的学生。
- 正在比较实习、校招、社招岗位要求差异的求职者。
- 希望用 AI Agent 原型展示产品设计能力的 AI 产品经理候选人。

## 核心场景

用户可以输入类似任务：

```text
我是一名计算机专业研究生，想投 AI 产品经理实习岗位。
请帮我搜索公开招聘信息，总结 AI 产品经理实习岗位常见要求，
并按技能、项目经历、工具能力、业务理解、加分项输出一份 Markdown 报告。
```

系统最终生成：

```text
output/ai-product-manager-job-demand-report.md
```

## 产品痛点

- 岗位信息分散在公司官网、校招官网、招聘软件和公开网页中。
- 用户很难快速区分实习、校招、社招岗位要求差异。
- 普通搜索引擎只能返回链接，不能直接归纳能力要求和简历建议。
- 招聘软件存在登录、授权和反爬限制，不适合直接批量抓取。
- 求职者需要把岗位要求转化为可执行的简历优化计划。

## 解决方案

本项目用三类能力完成岗位研究闭环：

- **RAG**：复用本地岗位知识库，沉淀岗位类型、常见能力和历史分析。
- **MCP Fetch**：读取公开可访问的公司招聘官网或招聘页面。
- **MCP Filesystem**：将最终岗位需求报告保存为 Markdown 文件。

整体流程：

```mermaid
flowchart LR
    A[用户输入岗位方向] --> B[解析关键词和岗位类型]
    B --> C[检索本地岗位知识库]
    C --> D[读取公开招聘网页]
    D --> E[抽取职责和要求]
    E --> F[按实习/校招/社招分类]
    F --> G[生成岗位需求报告]
    G --> H[保存 Markdown 文件]
```

## MVP 功能

- 支持岗位关键词：AI 产品经理、大模型产品经理、AI Agent 产品经理。
- 支持岗位类型分类：实习 `internship`、校招 `campus`、社招 `experienced`。
- 支持本地岗位知识库 RAG 检索。
- 支持公开网页读取和岗位信息归纳。
- 支持生成岗位需求报告。
- 支持输出简历优化建议和项目包装匹配点。

## 合规边界

V1 优先使用公开网页和公司招聘官网，不绕过招聘平台的登录、验证码、授权或反爬机制。

招聘软件信息在 V1 中只支持：

- 用户手动粘贴 JD。
- 用户提供公开可访问链接。
- 作为后续路线图中的合规接入方向。

## 报告结构

生成的岗位需求报告包含：

- 岗位搜索概览
- 实习 / 校招 / 社招岗位差异
- 高频能力要求
- 高频技术关键词
- 常见项目经历要求
- 对计算机研究生的简历优化建议
- 当前项目可包装的匹配点
- 信息来源和待补充来源

## 项目文档

- [AI_JOB_AGENT_PRD.md](./AI_JOB_AGENT_PRD.md)：AI Agent 岗位搜索助手 PRD。
- [AI_JOB_AGENT_DEMO_CASE.md](./AI_JOB_AGENT_DEMO_CASE.md)：岗位需求报告 Demo Case。
- [AI_JOB_AGENT_RESUME_PROJECT.md](./AI_JOB_AGENT_RESUME_PROJECT.md)：可放进 AI 产品经理简历的项目经历。
- [knowledge/jobs/ai_product_manager_roles.md](./knowledge/jobs/ai_product_manager_roles.md)：岗位知识库样例。

## 技术实现

核心模块：

- `Agent`：负责组织 LLM、MCP Client、上下文和工具调用循环。
- `ChatOpenAI`：封装 OpenAI-compatible Chat Completion，支持流式响应和 tool calls。
- `MCPClient`：连接 MCP Server，获取工具列表并执行工具调用。
- `EmbeddingRetriever`：生成文档向量和 query 向量，并执行检索。
- `VectorStore`：使用余弦相似度实现轻量级向量检索。

技术栈：

- TypeScript
- Node.js
- OpenAI-compatible API
- Model Context Protocol SDK
- RAG
- Embedding
- Vector Search

## 运行方式

安装依赖：

```bash
pnpm install
```

复制环境变量模板：

```bash
cp .env.example .env
```

配置 `.env`：

```bash
OPENAI_API_KEY=your_openai_compatible_api_key
OPENAI_BASE_URL=https://api.example.com/v1
OPENAI_MODEL=openai/gpt-4o-mini
ENABLE_FETCH_MCP=0
UVX_COMMAND=uvx
EMBEDDING_KEY=your_embedding_api_key
EMBEDDING_BASE_URL=https://api.example.com/v1
```

如果在 WSL 中没有全局 `uvx` 命令，但 Windows 侧已经安装 `uvx.exe`，可以显式配置：

```bash
ENABLE_FETCH_MCP=1
UVX_COMMAND=/mnt/d/Python38/Scripts/uvx.exe
```

运行 Demo：

```bash
pnpm dev
```

## 部署到阿里云（ECS + Nginx + HTTPS）

本项目已内置 ECS 生产部署能力，支持 Nginx 反向代理、Let's Encrypt HTTPS 与 GitHub Actions 自动发布。

### 1. 准备 ECS 与域名

- 购买 Linux ECS（建议 Ubuntu 22.04 或 Alibaba Cloud Linux 3）。
- 安全组放行端口：`22`、`80`、`443`。
- 将域名 A 记录指向 ECS 公网 IP（例如 `agent.example.com`）。
- 安装 Docker 与 Docker Compose。

### 2. 首次在 ECS 部署（HTTP）

```bash
git clone <your_repo_url>
cd llm-mcp-rag
cp deploy/aliyun/.env.prod.example deploy/aliyun/.env.prod
```

编辑 `deploy/aliyun/.env.prod`，填入生产环境变量（`OPENAI_API_KEY`、`EMBEDDING_KEY` 等）。

构建并推送镜像到 ACR（也可后续由 GitHub Actions 自动完成）：

```bash
docker build -t registry.cn-hangzhou.aliyuncs.com/<namespace>/ai-job-agent:latest .
docker login --username=<acr_username> registry.cn-hangzhou.aliyuncs.com
docker push registry.cn-hangzhou.aliyuncs.com/<namespace>/ai-job-agent:latest
```

启动 Nginx + 应用：

```bash
bash deploy/aliyun/deploy-nginx.sh registry.cn-hangzhou.aliyuncs.com/<namespace>/ai-job-agent:latest agent.example.com
```

如果暂时没有可用远程镜像（Docker Hub / ACR 拉取失败），可在 ECS 本地构建并启动：

```bash
bash deploy/aliyun/build-and-run.sh 9000
```

### 3. 启用 HTTPS 证书

确认域名已解析到 ECS 后执行：

```bash
bash deploy/aliyun/enable-https.sh agent.example.com ops@example.com
```

执行完成后访问：

```bash
https://agent.example.com
```

### 4. 配置证书自动续期

在 ECS 上添加 `crontab`（每天凌晨 3 点）：

```bash
crontab -e
```

```cron
0 3 * * * cd /path/to/llm-mcp-rag && bash deploy/aliyun/renew-cert.sh >> /var/log/ai-job-agent-cert-renew.log 2>&1
```

### 5. 配置 GitHub Actions 自动发布到 ECS

仓库已提供工作流：`.github/workflows/deploy-aliyun-ecs.yml`  
触发方式：`push main` 或手动 `workflow_dispatch`。

请在 GitHub 仓库 Secrets 中配置：

- `ACR_REGISTRY`：如 `registry.cn-hangzhou.aliyuncs.com`
- `ACR_REPO`：如 `<namespace>/ai-job-agent`
- `ACR_USERNAME`：ACR 用户名
- `ACR_PASSWORD`：ACR 密码
- `ECS_HOST`：ECS 公网 IP
- `ECS_PORT`：SSH 端口（默认 `22`）
- `ECS_USER`：SSH 用户（如 `root`）
- `ECS_SSH_KEY`：私钥内容（PEM）
- `ECS_PROJECT_DIR`：ECS 项目绝对路径（如 `/root/llm-mcp-rag`）
- `ECS_DOMAIN`：部署域名（如 `agent.example.com`）

工作流流程：

1. 构建镜像并推送到 ACR（`latest` + `sha` 标签）。
2. SSH 登录 ECS，`git pull` 最新代码。
3. 执行 `deploy/aliyun/deploy-nginx.sh` 拉起新镜像并热更新容器。

### 自动抓取招聘官网

生成报告前，系统会根据岗位关键词自动访问 `knowledge/sources/career_portals.json` 中的公开招聘官网，并将抓取结果注入 LLM 上下文。

可在 `deploy/aliyun/.env.prod` 中配置：

```bash
ENABLE_AUTO_CAREER_FETCH=1
CAREER_FETCH_MAX_SOURCES=10
ENABLE_PLAYWRIGHT_FETCH=1
```

说明：
- 搜索关键词仅使用“具体岗位名称”（如 `Java后端开发`），不会拼接岗位类型前缀。
- 系统会进入招聘官网搜索页，匹配岗位链接并进一步打开详情页提取 JD 摘录。
- 字节、腾讯、阿里、美团等动态招聘页会通过 Playwright 渲染后再检索具体岗位。
- 该能力只抓取公开官网页面，不绕过 BOSS/拉勾等平台的登录或反爬限制。

### 已提供的阿里云部署文件

- `deploy/aliyun/docker-compose.ecs.yml`：单容器部署（无 Nginx）编排文件。
- `deploy/aliyun/deploy-ecs.sh`：单容器部署脚本。
- `deploy/aliyun/docker-compose.nginx.yml`：Nginx + 应用双容器编排文件。
- `deploy/aliyun/nginx/http.conf.template`：HTTP 配置模板。
- `deploy/aliyun/nginx/https.conf.template`：HTTPS 配置模板。
- `deploy/aliyun/deploy-nginx.sh`：按域名部署并自动选择 HTTP/HTTPS 配置。
- `deploy/aliyun/enable-https.sh`：申请证书并切换 HTTPS。
- `deploy/aliyun/renew-cert.sh`：证书续期脚本。
- `deploy/aliyun/.env.prod.example`：生产环境变量模板。

构建：

```bash
pnpm build
```

## 产品指标

- 任务完成率：是否成功生成岗位需求报告。
- 来源覆盖数：报告中引用的公开来源数量。
- 岗位分类准确率：岗位是否正确归为实习、校招或社招。
- 要求抽取完整度：岗位职责、任职要求、技能关键词是否完整。
- 报告可用率：用户是否能直接用于简历优化或面试准备。

## 后续路线图

- 增加公司招聘官网入口清单。
- 支持用户手动粘贴招聘 JD 并自动结构化。
- 增加岗位来源可信度标记。
- 增加简历匹配度分析。
- 增加岗位趋势报告。
- 增加可视化任务配置和报告预览界面。

## 作品集表达

如果用于 AI 产品经理简历，建议表述为：

**基于 LLM + MCP + RAG 技术底座，设计 AI Agent 岗位搜索助手产品原型，面向应届生和实习求职者，支持公开岗位信息读取、本地岗位知识库检索、实习/校招/社招分类和岗位需求报告生成。**
