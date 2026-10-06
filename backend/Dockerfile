# syntax=docker/dockerfile:1
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache ffmpeg
COPY package.json package-lock.json* ./
RUN npm config set registry https://registry.npmmirror.com && npm install
COPY prisma ./prisma
RUN npx prisma generate

FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache ffmpeg
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache ffmpeg tini && addgroup -S app && adduser -S app -G app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package.json ./
USER app
EXPOSE 3001
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
