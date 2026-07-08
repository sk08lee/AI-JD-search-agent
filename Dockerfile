# ===== 构建阶段 =====
FROM node:20-alpine AS builder

WORKDIR /app

# 使用国内镜像源，降低网络超时概率
RUN npm config set registry https://registry.npmmirror.com
RUN npm install -g pnpm@10.6.3

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ===== 运行阶段（Playwright 支持动态招聘页渲染） =====
FROM mcr.microsoft.com/playwright:v1.61.1-jammy AS runner

WORKDIR /app

# runner 阶段不再联网安装 pnpm，直接复用 builder 里的 pnpm
COPY --from=builder /usr/local/bin/pnpm /usr/local/bin/pnpm
COPY --from=builder /usr/local/lib/node_modules/pnpm /usr/local/lib/node_modules/pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm config set registry https://registry.npmmirror.com
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/knowledge ./knowledge

ENV PORT=9000
ENV NODE_ENV=production
ENV ENABLE_AUTO_CAREER_FETCH=1
ENV ENABLE_PLAYWRIGHT_FETCH=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 9000

CMD ["node", "dist/server.js"]
