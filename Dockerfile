# ===== 构建阶段 =====
FROM node:20-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm@10.6.3

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ===== 运行阶段（Playwright 支持动态招聘页渲染） =====
FROM mcr.microsoft.com/playwright:v1.61.1-jammy AS runner

WORKDIR /app

RUN npm install -g pnpm@10.6.3

COPY package.json pnpm-lock.yaml ./
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
