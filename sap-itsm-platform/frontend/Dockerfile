# BUILDER STAGE
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Build with API URL baked in
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# PRODUCTION STAGE
FROM nginx:1.25-alpine AS production

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Add health check endpoint
RUN echo "OK" > /usr/share/nginx/html/health

# Limit worker_processes to 1 to avoid spawning too many processes on high-core hosts
RUN sed -i 's/worker_processes *auto;/worker_processes 1;/' /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
