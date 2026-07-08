# ===== 构建阶段 =====
FROM registry.cn-hangzhou.aliyuncs.com/library/node:20-alpine AS builder

WORKDIR /app

# 设置 npm 镜像源
RUN npm config set registry https://registry.npmmirror.com

# 安装 pnpm
RUN npm install -g pnpm@10.6.3

# 设置 pnpm 镜像源
RUN pnpm config set registry https://registry.npmmirror.com

# 复制依赖文件
COPY package.json pnpm-lock.yaml ./

# 安装依赖
RUN pnpm install --frozen-lockfile

# 复制源码
COPY . .

# 构建 TypeScript
RUN pnpm build

# ===== 运行阶段 =====
FROM registry.cn-hangzhou.aliyuncs.com/library/node:20-alpine AS runner

WORKDIR /app

# 设置 npm 镜像源
RUN npm config set registry https://registry.npmmirror.com

# 安装 pnpm（用于生产依赖安装）
RUN npm install -g pnpm@10.6.3

# 设置 pnpm 镜像源
RUN pnpm config set registry https://registry.npmmirror.com

# 复制 package 文件
COPY package.json pnpm-lock.yaml ./

# 仅安装生产依赖
RUN pnpm install --frozen-lockfile --prod

# 复制构建产物
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/knowledge ./knowledge

# 服务端口（FC 自定义容器要求监听 9000）
ENV PORT=9000
ENV NODE_ENV=production

# 暴露端口
EXPOSE 9000

# 启动命令
CMD ["node", "dist/server.js"]
