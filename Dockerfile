# TRCODER Server Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9.12.1

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/auth/package.json ./packages/auth/
COPY packages/billing/package.json ./packages/billing/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/server ./packages/server
COPY packages/auth ./packages/auth
COPY packages/billing ./packages/billing

# Build
RUN pnpm -r build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install pnpm for production
RUN npm install -g pnpm@9.12.1

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/auth/package.json ./packages/auth/
COPY packages/billing/package.json ./packages/billing/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy built files
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/auth/dist ./packages/auth/dist
COPY --from=builder /app/packages/billing/dist ./packages/billing/dist

# Set environment
ENV NODE_ENV=production
ENV TRCODER_HOST=0.0.0.0
ENV TRCODER_PORT=3333

EXPOSE 3333

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3333/v1/usage/today || exit 1

# Start server
CMD ["node", "packages/server/dist/index.js"]
