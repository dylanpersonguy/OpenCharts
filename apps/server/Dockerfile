FROM node:20-alpine AS base
WORKDIR /app

COPY package.json ./
COPY packages/common/package.json packages/common/
COPY apps/server/package.json apps/server/
RUN npm install --workspace=@opencharts/server --workspace=@opencharts/common

COPY packages/common packages/common
COPY apps/server apps/server
COPY tsconfig.base.json ./

FROM base AS runner
WORKDIR /app
EXPOSE 4000
CMD ["npx", "tsx", "apps/server/src/index.ts"]
