FROM node:20-alpine AS builder

WORKDIR /app

# Copy ALL files first (no layer caching split)
COPY . .

# Install deps
RUN npm install

# Build with API URL baked in
ENV VITE_API_URL=https://servicedesk-production-f664.up.railway.app
RUN npm run build

FROM nginx:1.25-alpine AS production

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
