# Metadata Service

A standalone NestJS service for generating ENS subname metadata and images, and managing user-uploaded profile avatars/headers with SIWE-based authentication. This service was extracted from the main indexer to provide dedicated metadata and media functionality.

## Features

- Generate JSON metadata for ENS subnames
- Create dynamic PNG images with custom avatars
- Upload/delete profile avatar and header images (SIWE-protected)
- Direct SIWE signature verification for each request
- RESTful API with Swagger documentation
- Docker support for easy deployment
- Health check endpoints
- Google Cloud Storage backend

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

# Auth (SIWE Configuration)
SIWE_ALLOWED_CHAIN_IDS=1
SIWE_NONCE_TTL_MS=300000

# Storage (choose one mode)
# STORAGE_MODE can be 'local' or 'gcs' (default: gcs)
STORAGE_MODE=

# GCS settings (required if STORAGE_MODE=gcs)
GCLOUD_PROJECT_ID=
GCLOUD_BUCKET_NAME=avatars.namespace.ninja
GCLOUD_BUCKET_CLIENT_EMAIL=
# Base64-encoded private key; newlines should be encoded. Example: echo -n "$KEY" | base64
GCLOUD_BUCKET_PRIVATE_KEY=
GCLOUD_SCOPES=https://www.googleapis.com/auth/devstorage.read_write
```

## Development

### Running locally

```bash
# Development mode with hot reload
pnpm run start:dev

# Production mode
pnpm run start:prod
```

When `STORAGE_MODE=local`, uploaded files are saved under `public/<subname>/avatar` and `public/<subname>/header`, and are served from `/static/...` URLs by the service.

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

### Auth (SIWE Nonce Generation)

- `POST /auth/nonce` - Generate a nonce for the provided EVM address
  - body: `{ "address": "0x...", "scope": "avatar+header" }`
  - Returns: `{ "nonce": string, "expiresAt": number }`

### Profile

- `POST /profile/{subname}/avatar` - Upload or update avatar image for a subname
  - Auth: SIWE signature verification (no JWT required)
  - Content-Type: `multipart/form-data` with fields: `avatar`, `siweMessage`, `siweSignature`, `address`
  - Response: `{ subname, avatarUrl, uploadedAt, fileSize, isUpdate }`
- `DELETE /profile/{subname}/avatar` - Delete avatar image for a subname
  - Auth: SIWE signature verification (no JWT required)
  - Body: `{ "siweMessage": string, "siweSignature": string, "address": string }`
  - Response: `{ subname, message, deletedAt }`
- `POST /profile/{subname}/header` - Upload or update header image for a subname
  - Auth: SIWE signature verification (no JWT required)
  - Content-Type: `multipart/form-data` with fields: `header`, `siweMessage`, `siweSignature`, `address`
  - Response: `{ subname, headerUrl, uploadedAt, fileSize, isUpdate }`
- `DELETE /profile/{subname}/header` - Delete header image for a subname
  - Auth: SIWE signature verification (no JWT required)
  - Body: `{ "siweMessage": string, "siweSignature": string, "address": string }`
  - Response: `{ subname, message, deletedAt }`

### Health Check

- `GET /health` - Service health status

## Environment Variables

| Variable                     | Description                                | Required     | Default                                                 |
| ---------------------------- | ------------------------------------------ | ------------ | ------------------------------------------------------- |
| `METADATA_URL`               | Base URL for this service                  | Yes          | -                                                       |
| `INDEXER_SERVICE_URL`        | URL of the indexer service                 | Yes          | -                                                       |
| `PORT`                       | Port to run the service on                 | No           | 3000                                                    |
| `SIWE_ALLOWED_CHAIN_IDS`     | CSV of allowed chain IDs for SIWE          | No           | `1`                                                     |
| `SIWE_NONCE_TTL_MS`          | Nonce TTL in ms for SIWE replay protection | No           | `300000`                                                |
| `STORAGE_MODE`               | `local` or `gcs`                           | No           | `gcs`                                                   |
| `GCLOUD_PROJECT_ID`          | GCP project id (GCS mode)                  | Yes if `gcs` | -                                                       |
| `GCLOUD_BUCKET_NAME`         | GCS bucket name (GCS mode)                 | Yes if `gcs` | `avatars.namespace.ninja`                               |
| `GCLOUD_BUCKET_CLIENT_EMAIL` | Service account email (GCS mode)           | Yes if `gcs` | -                                                       |
| `GCLOUD_BUCKET_PRIVATE_KEY`  | Base64-encoded private key (GCS mode)      | Yes if `gcs` | -                                                       |
| `GCLOUD_SCOPES`              | OAuth scopes (GCS mode)                    | Yes if `gcs` | `https://www.googleapis.com/auth/devstorage.read_write` |

## Rate Limiting

Rate limits are applied per endpoint category:

- Auth: 10 req/min
- Uploads: 5 req/min
- Deletes: 10 req/min
- Reads: 100 req/min

## Architecture

The service consists of several modules:

- **MetadataModule**: Core metadata functionality
- **SubnamesModule**: Client for fetching subname data from indexer
- **AvatarModule**: Authenticated profile avatar/header upload and deletion
- **AuthModule**: SIWE nonce generation and signature verification
- **PropertiesModule**: Configuration management
- **StorageModule**: Local or GCS-backed storage for media
- **HealthModule**: Health check endpoints

### Key Components

- **MetadataController**: HTTP endpoints for metadata requests
- **MetadataService**: Business logic for metadata generation
- **ImageService**: Dynamic image generation with Canvas
- **SubnamesClientService**: HTTP client for indexer service communication
- **AvatarController**: Upload/delete profile avatar and header images for subnames
- **AuthController/AuthService**: SIWE nonce issuance and signature verification
- **StorageService**: Abstraction over local filesystem or GCS for media storage

## Image Generation

The service generates dynamic PNG images with:

- Gradient background
- Optional avatar overlay
- Namespace logo
- Subname text with responsive font sizing
- Shadow effects and styling

## Dependencies

### Runtime Dependencies

- `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-fastify` - NestJS framework
- `@nestjs/config` - Configuration management
- `@nestjs/swagger` - API documentation
- `siwe` - Sign-In With Ethereum verification
- `@nestjs/throttler` - Rate limiting
- `canvas` - Image generation
- `axios` - HTTP client
- `@google-cloud/storage` - GCS backend (optional)
- `viem` - Ethereum utilities
- `sharp` - Image processing
- `@fastify/multipart` - Multipart form handling
- `@fastify/static` - Static file serving

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
  -e STORAGE_MODE=gcs \
  -e GCLOUD_PROJECT_ID=your-project \
  -e GCLOUD_BUCKET_NAME=avatars.namespace.ninja \
  -e GCLOUD_BUCKET_CLIENT_EMAIL=service-account@your-project.iam.gserviceaccount.com \
  -e GCLOUD_BUCKET_PRIVATE_KEY=$(cat key.base64) \
  -e GCLOUD_SCOPES=https://www.googleapis.com/auth/devstorage.read_write \
  metadata-service
```

### Production Considerations

1. **Environment Variables**: Ensure all required environment variables are set
2. **Network Access**: Service needs HTTP access to the indexer service
3. **Image Dependencies**: Canvas requires system libraries (handled in Dockerfile)
4. **Caching**: Image generation results are cached in memory
5. **Health Checks**: Use `/health` endpoint for load balancer health checks
6. **Auth**: Protect profile avatar/header mutations with direct SIWE signature verification
7. **Storage**: Use `gcs` in production; provide base64-encoded private key and scopes

## Migration from Indexer

This service was extracted from the main indexer project. Key changes:

1. **Database Independence**: Uses HTTP client instead of direct database access
2. **Simplified Configuration**: Only metadata and media-related environment variables
3. **Standalone Deployment**: Can be deployed independently
4. **API Compatibility**: Metadata endpoints remain compatible; new SIWE-based auth/profile endpoints added

## Authentication Flow

The service uses a simplified SIWE (Sign-In With Ethereum) authentication flow:

1. **Nonce Generation**: Client requests a nonce for their Ethereum address via `POST /auth/nonce`
2. **SIWE Message**: Client creates a SIWE message using the nonce and signs it with their wallet
3. **Direct Verification**: For each protected operation, the client includes the SIWE message, signature, and address
4. **ENS Ownership**: The service verifies the client owns the ENS subname they're trying to modify

This approach eliminates the need for JWT tokens and provides a more direct, stateless authentication mechanism.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the UNLICENSED license.
