# pnpm 11.17.0 requires Node.js 22.13+ (it uses the node:sqlite built-in module).
FROM node:22-slim

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

# Copy package files, pnpm policy, and TypeScript config
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.build.json ./

# Install exactly what is recorded in the lockfile
RUN pnpm install --frozen-lockfile

# Copy source code
COPY src/ ./src/

# Build the application
RUN pnpm run build

COPY src/assets /app/dist/assets

# Expose port 3000
EXPOSE 3000

# Run the application
CMD ["node", "dist/main.js"]
