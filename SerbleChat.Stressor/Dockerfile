FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY *.js ./
COPY *.md ./
COPY config.example.json ./
COPY config.schema.json ./

# Create volume mount point for config
VOLUME ["/app/config"]

# Set environment variable for config path
ENV CONFIG_PATH=/app/config/config.json

# Run the stress test
CMD ["sh", "-c", "node index.js ${CONFIG_PATH}"]
