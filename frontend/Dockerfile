# 构建阶段：保留 Vite 构建方式
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm config set registry https://registry.npmmirror.com \
  && npm install --no-audit --no-fund
COPY . .
RUN npm run build

# 生产阶段：Nginx 承载静态产物并代理 /api 到后端服务名
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
