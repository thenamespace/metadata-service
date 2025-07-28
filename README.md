# Metadata Service

A standalone NestJS service for generating ENS subname metadata and images. This service was extracted from the main indexer to provide dedicated metadata functionality.

## Features

- Generate JSON metadata for ENS subnames
- Create dynamic PNG images with custom avatars
- RESTful API with Swagger documentation
- Docker support for easy deployment
- Health check endpoints

## Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- Docker (optional)

## Installation

1. Clone the repository and navigate to the metadata-service directory:
```bash
cd metadata-service
```

2. Install dependencies:
```bash
pnpm install
```

3. Copy the environment file and configure:
```bash
cp .env.example .env
```

4. Update the `.env` file with your configuration:
```env
METADATA_URL=http://localhost:3000
INDEXER_SERVICE_URL=http://localhost:3001
PORT=3000
```

## Development

### Running locally

```bash
# Development mode with hot reload
pnpm run start:dev

# Production mode
pnpm run start:prod
```

### Running with Docker

```bash
# Build and run the service
docker-compose up --build

# Run with indexer service (if available)
docker-compose --profile with-indexer up --build
```

## API Documentation

Once the service is running, you can access the Swagger documentation at:
```
http://localhost:3000/api
```

## API Endpoints

### Metadata

- `GET /metadata/network/{chainId}/token/{tokenId}` - Get JSON metadata for a subname
- `GET /metadata/network/{chainId}/token/{tokenId}/image.png` - Get generated PNG image

### Health Check

- `GET /health` - Service health status

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `METADATA_URL` | Base URL for this service | Yes | - |
| `INDEXER_SERVICE_URL` | URL of the indexer service | Yes | - |
| `PORT` | Port to run the service on | No | 3000 |

## Architecture

The service consists of several modules:

- **MetadataModule**: Core metadata functionality
- **SubnamesModule**: Client for fetching subname data from indexer
- **PropertiesModule**: Configuration management
- **HealthModule**: Health check endpoints

### Key Components

- **MetadataController**: HTTP endpoints for metadata requests
- **MetadataService**: Business logic for metadata generation
- **ImageService**: Dynamic image generation with Canvas
- **SubnamesClientService**: HTTP client for indexer service communication

## Image Generation

The service generates dynamic PNG images with:
- Gradient background
- Optional avatar overlay
- Namespace logo
- Subname text with responsive font sizing
- Shadow effects and styling

## Dependencies

### Runtime Dependencies
- `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` - NestJS framework
- `@nestjs/config` - Configuration management
- `@nestjs/swagger` - API documentation
- `canvas` - Image generation
- `axios` - HTTP client
- `viem` - Ethereum utilities

### Development Dependencies
- TypeScript and related tooling
- ESLint and Prettier for code formatting
- Jest for testing

## Testing

```bash
# Unit tests
pnpm run test

# E2E tests
pnpm run test:e2e

# Test coverage
pnpm run test:cov
```

## Building

```bash
# Build for production
pnpm run build
```

## Deployment

### Docker Deployment

```bash
# Build image
docker build -t metadata-service .

# Run container
docker run -p 3000:3000 \
  -e METADATA_URL=https://your-domain.com \
  -e INDEXER_SERVICE_URL=https://indexer.your-domain.com \
  metadata-service
```

### Production Considerations

1. **Environment Variables**: Ensure all required environment variables are set
2. **Network Access**: Service needs HTTP access to the indexer service
3. **Image Dependencies**: Canvas requires system libraries (handled in Dockerfile)
4. **Caching**: Image generation results are cached in memory
5. **Health Checks**: Use `/health` endpoint for load balancer health checks

## Migration from Indexer

This service was extracted from the main indexer project. Key changes:

1. **Database Independence**: Uses HTTP client instead of direct database access
2. **Simplified Configuration**: Only metadata-related environment variables
3. **Standalone Deployment**: Can be deployed independently
4. **API Compatibility**: Maintains the same API endpoints as the original

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the UNLICENSED license.