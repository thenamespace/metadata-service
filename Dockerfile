# Use Node.js LTS version as the base image
FROM node:20-slim

# Install system packages needed for canvas and build tools
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    pkg-config \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Enable corepack for package managers
RUN corepack enable

# Set working directory
WORKDIR /app

# Copy package files and TypeScript config
COPY package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json ./

# Clear any existing node_modules and install fresh
RUN rm -rf node_modules
RUN pnpm install --frozen-lockfile

# Specifically rebuild canvas to ensure native bindings work
RUN cd node_modules/.pnpm/canvas*/node_modules/canvas && npm run install || true
RUN pnpm rebuild canvas

# Copy source code
COPY src/ ./src/

# Build the application
RUN pnpm run build

COPY src/assets /app/dist/assets

# Expose port 3000
EXPOSE 3000

# Run the application
CMD ["node", "dist/main.js"]
