FROM node:20-alpine

WORKDIR /app

# Install curl for docker healthcheck
RUN apk add --no-cache curl

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy application code
COPY src/ ./src/

# Create persistent uploads directory
RUN mkdir -p /app/uploads/resumes

EXPOSE 5000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

CMD ["node", "src/index.js"]

