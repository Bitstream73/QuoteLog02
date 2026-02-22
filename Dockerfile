# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Production stage
FROM node:20-alpine
WORKDIR /app

# Copy built node_modules and source
COPY --from=builder /app/node_modules ./node_modules
ARG CACHEBUST=1
COPY . .

# Copy seed files to project root as fallback (volume mount shadows data/)
RUN cp -f data/sources-seed.json sources-seed.json 2>/dev/null || true && \
    cp -f data/settings-seed.json settings-seed.json 2>/dev/null || true

# Create data directories
RUN mkdir -p data uploads

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "src/index.js"]
