FROM node:18-alpine AS deps
RUN apk add --no-cache python3 make g++ libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install

FROM node:18-alpine AS builder
RUN apk add --no-cache python3 make g++ libc6-compat
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:18-alpine AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path
COPY --from=builder /app/node_modules/prebuild-install ./node_modules/prebuild-install 2>/dev/null || true
EXPOSE 3000
CMD ["node", "server.js"]
