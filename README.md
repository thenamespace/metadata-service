# Metadata Service
 
A standalone NestJS service for generating ENS subname metadata and images, and managing user-uploaded profile avatars/headers with SIWE-based authentication. This service was extracted from the main indexer to provide dedicated metadata and media functionality.

## Features

- Generate JSON metadata for ENS subnames
- Create dynamic PNG images with custom avatars
- Upload/delete profile avatar and header images (SIWE-protected)
- Direct SIWE signature verification for each request, including:
  - EOA signatures
  - Smart contract wallet signatures (ERC-4337 / EIP-1271)
  - Pre-deploy smart account signatures via ERC-6492 using `@ambire/signature-validator`
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

# GCS settings
GCLOUD_PROJECT_ID=
GCLOUD_BUCKET_NAME=avatars.namespace.ninja
GCLOUD_BUCKET_CLIENT_EMAIL=
GCLOUD_BUCKET_PRIVATE_KEY_ID=
# Private key in PEM format (raw, not base64-encoded)
GCLOUD_BUCKET_PRIVATE_KEY=
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
http://localhost:3000/docs
```

OpenAPI JSON is available at:

```
http://localhost:3000/openapi.json
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

- `POST /profile/{network}/{subname}/avatar` - Upload or update avatar image for a subname
  - Auth: SIWE signature verification (no JWT required)
  - Content-Type: `multipart/form-data` with fields: `avatar`, `siweMessage`, `siweSignature`, `address`
  - Response: `{ subname, network, avatarUrl, uploadedAt, fileSize, isUpdate }`
- `DELETE /profile/{network}/{subname}/avatar` - Delete avatar image for a subname
  - Auth: SIWE signature verification (no JWT required)
  - Body: `{ "siweMessage": string, "siweSignature": string, "address": string }`
  - Response: `{ subname, network, message, deletedAt }`
- `POST /profile/{network}/{subname}/header` - Upload or update header image for a subname
  - Auth: SIWE signature verification (no JWT required)
  - Content-Type: `multipart/form-data` with fields: `header`, `siweMessage`, `siweSignature`, `address`
  - Response: `{ subname, network, headerUrl, uploadedAt, fileSize, isUpdate }`
- `DELETE /profile/{network}/{subname}/header` - Delete header image for a subname
  - Auth: SIWE signature verification (no JWT required)
  - Body: `{ "siweMessage": string, "siweSignature": string, "address": string }`
  - Response: `{ subname, network, message, deletedAt }`

**Supported Networks:**

- `mainnet` - Ethereum mainnet
- `sepolia` - Ethereum Sepolia testnet

SIWE is supported on chain ids `1` (Mainnet) and `11155111` (Sepolia).

### Health Check

- `GET /health` - Service health status

## Environment Variables

| Variable                       | Description                                | Required | Default                                  |
| ------------------------------ | ------------------------------------------ | -------- | ---------------------------------------- |
| `METADATA_URL`                 | Base URL for this service                  | Yes      | -                                        |
| `INDEXER_SERVICE_URL`          | URL of the indexer service                 | Yes      | -                                        |
| `PORT`                         | Port to run the service on                 | No       | 3000                                     |
| `SIWE_ALLOWED_CHAIN_IDS`       | CSV of allowed chain IDs for SIWE          | No       | `1`                                      |
| `SIWE_NONCE_TTL_MS`            | Nonce TTL in ms for SIWE replay protection | No       | `300000`                                 |
| `ETH_MAINNET_RPC_URL`          | Custom RPC URL for Ethereum mainnet        | No       | Uses Alchemy if `ALCHEMY_API_KEY` is set |
| `ETH_SEPOLIA_RPC_URL`          | Custom RPC URL for Ethereum Sepolia        | No       | Uses Alchemy if `ALCHEMY_API_KEY` is set |
| `GCLOUD_PROJECT_ID`            | GCP project id                             | Yes      | -                                        |
| `GCLOUD_BUCKET_NAME`           | GCS bucket name                            | No       | `avatars.namespace.ninja`                |
| `GCLOUD_BUCKET_CLIENT_EMAIL`   | Service account email                      | Yes      | -                                        |
| `GCLOUD_BUCKET_PRIVATE_KEY_ID` | Service account private key ID             | Yes      | -                                        |
| `GCLOUD_BUCKET_PRIVATE_KEY`    | Private key in PEM format (raw)            | Yes      | -                                        |

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
- **StorageModule**: GCS-backed storage for media
- **HealthModule**: Health check endpoints

### Key Components

- **MetadataController**: HTTP endpoints for metadata requests
- **MetadataService**: Business logic for metadata generation
- **ImageService**: Dynamic image generation with Canvas
- **SubnamesClientService**: HTTP client for indexer service communication
- **AvatarController**: Upload/delete profile avatar and header images for subnames
- **AuthController/AuthService**: SIWE nonce issuance and signature verification
- **StorageService**: Abstraction over GCS for media storage

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
- `@google-cloud/storage` - GCS backend
- `viem` - Ethereum utilities
- `sharp` - Image processing
- `@fastify/multipart` - Multipart form handling
- `@fastify/static` - Static file serving
- `@ambire/signature-validator` - ERC-6492 and smart wallet signature validation

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

### Test locally with Docker

```bash
docker build -t metadata-service:local .
docker run --rm --name metadata-service \
  -p 3001:3001 \
  --env-file .env  \
  metadata-service:local
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
  -e GCLOUD_BUCKET_PRIVATE_KEY_ID=your-private-key-id \
  -e GCLOUD_BUCKET_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n" \
  metadata-service
```

### Production Considerations

1. **Environment Variables**: Ensure all required environment variables are set
2. **Network Access**: Service needs HTTP access to the indexer service
3. **Image Dependencies**: Canvas requires system libraries (handled in Dockerfile)
4. **Caching**: Image generation results are cached in memory
5. **Health Checks**: Use `/health` endpoint for load balancer health checks
6. **Auth**: Protect profile avatar/header mutations with direct SIWE signature verification
7. **Storage**: Use `gcs` in production; provide private key in PEM format and private key ID

## Migration from Indexer

This service was extracted from the main indexer project. Key changes:

1. **Database Independence**: Uses HTTP client instead of direct database access
2. **Simplified Configuration**: Only metadata and media-related environment variables
3. **Standalone Deployment**: Can be deployed independently
4. **API Compatibility**: Metadata endpoints remain compatible; new SIWE-based auth/profile endpoints added

## Authentication Flow

The service uses a simplified SIWE (Sign-In With Ethereum) authentication flow with full support for both EOA (Externally Owned Accounts) and smart contract wallets (ERC-4337/EIP-1271). It also supports ERC-6492 for validating signatures from smart accounts that are not yet deployed:

1. **Nonce Generation**: Client requests a nonce for their Ethereum address via `POST /auth/nonce`
2. **SIWE Message**: Client creates a SIWE message using the nonce and signs it with their wallet
3. **Direct Verification**: For each protected operation, the client includes the SIWE message, signature, and address
4. **ENS Ownership**: The service verifies the client owns the ENS subname they're trying to modify

This approach eliminates the need for JWT tokens and provides a more direct, stateless authentication mechanism.

### Wallet Type Support

- **EOA Wallets** (MetaMask, Rainbow, etc.): Standard ECDSA signature verification using `ecrecover`
- **Smart Contract Wallets** (ERC-4337 accounts, Safe, etc.)

The service automatically detects the wallet type and uses the appropriate verification method. Smart contract wallet signatures can be variable length and contain additional metadata, which is fully supported. For smart accounts that are not yet deployed, ERC-6492 signatures are validated using `@ambire/signature-validator`.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the UNLICENSED license.
