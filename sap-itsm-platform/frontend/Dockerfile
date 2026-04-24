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

EXPOSE 80

CMD ["sh", "-c", "if [ -z \"$BACKEND_URL\" ]; then echo \"ERROR: BACKEND_URL environment variable is not set.\"; exit 1; fi; \
    case \"$BACKEND_URL\" in http://*|https://*) ;; *) BACKEND_URL=\"http://$BACKEND_URL\" ;; esac; \
    sed -i \"s|http://itsm-backend:3001|${BACKEND_URL}|g\" /etc/nginx/conf.d/default.conf && \
    nginx -g 'daemon off;'"]
