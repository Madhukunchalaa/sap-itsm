# Cache bust: 20260228_041500
FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN node_modules/.bin/prisma generate
RUN npm run build

EXPOSE 3001

CMD ["sh", "-c", "node_modules/.bin/prisma db push --accept-data-loss && node dist/server.js"]
