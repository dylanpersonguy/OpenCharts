FROM node:20-alpine AS base
WORKDIR /app

COPY package.json ./
COPY packages/common/package.json packages/common/
COPY apps/web/package.json apps/web/
RUN npm install --workspace=@opencharts/web --workspace=@opencharts/common

COPY packages/common packages/common
COPY apps/web apps/web
COPY tsconfig.base.json ./

FROM base AS builder
RUN npm run build --workspace=@opencharts/web

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/web/.next .next
COPY --from=builder /app/apps/web/public public
COPY --from=builder /app/apps/web/package.json ./
COPY --from=builder /app/node_modules node_modules
EXPOSE 3000
CMD ["npx", "next", "start"]
