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
# Copy custom server.js AFTER standalone (standalone generates its own server.js, we need ours)
COPY --from=builder /app/server.js ./server.js
# Copy wakeup scheduler lib (not included in standalone output)
COPY --from=builder /app/lib/wakeup.js ./lib/wakeup.js
# Copy better-sqlite3 native module and its dependencies
COPY --from=builder /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path
EXPOSE 3000
CMD ["node", "server.js"]
