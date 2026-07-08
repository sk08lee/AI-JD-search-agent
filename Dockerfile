FROM daocloud.io/library/node:20-alpine AS builder

WORKDIR /app

RUN npm config set registry https://registry.npmmirror.com
RUN npm install -g pnpm@10.6.3
RUN pnpm config set registry https://registry.npmmirror.com

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM daocloud.io/library/node:20-alpine AS runner

WORKDIR /app

RUN npm config set registry https://registry.npmmirror.com
RUN npm install -g pnpm@10.6.3
RUN pnpm config set registry https://registry.npmmirror.com

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/knowledge ./knowledge

ENV PORT=9000
ENV NODE_ENV=production

EXPOSE 9000

CMD ["node", "dist/server.js"]
