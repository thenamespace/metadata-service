<div align="center">
  <img src="./src/assets/logo/ninja-logo.png" alt="Namespace ninja" width="128" />

  <h1>Namespace Metadata Service</h1>

  <p>
    ENS subname metadata, generated images, and wallet-authenticated profile media.
  </p>

  <p>
    <a href="https://github.com/thenamespace/metadata-service/actions">CI</a>
    ·
    <a href="#api">API</a>
    ·
    <a href="#configuration">Configuration</a>
    ·
    <a href="./CONTRIBUTING.md">Contributing</a>
  </p>
</div>

---

The Metadata Service is a standalone [NestJS](https://nestjs.com/) API that
generates metadata and social images for ENS subnames. It also lets ENS owners
upload and remove profile avatars and headers by signing requests with their
Ethereum wallet.

This repo actually holds two logically separate services:

1. **Metadata service** (`/metadata`) — dynamic, on-the-fly image and
   ERC-compatible JSON metadata generation for onchain subnames.
2. **Avatar service** (`/auth`, `/profile`) — the SIWE-authenticated flow for
   uploading and removing profile avatars/headers, backed by Google Cloud
   Storage. In production, uploaded media is served publicly from
   `https://avtr.cc`, so an uploaded avatar ends up reachable at
   `avtr.cc/name.eth` (or `avtr.cc/name.eth/h` for the header).

## What it provides

- ERC-compatible JSON metadata for ENS subnames
- Dynamically generated PNG images
- Avatar and header uploads backed by Google Cloud Storage
- Sign-In with Ethereum (SIWE) authentication on every profile mutation
- Support for EOAs, EIP-1271 contract wallets, and EIP-6492 counterfactual wallets
- Mainnet and Sepolia ENS ownership verification
- Interactive Swagger docs and an OpenAPI document
- Health and Prometheus metrics endpoints
- Per-route rate limiting

## Requirements

- [Node.js](https://nodejs.org/) 22.13 or newer
- [pnpm](https://pnpm.io/) 11.17 or newer
- A Google Cloud Storage bucket and service-account credentials
- An [Alchemy](https://www.alchemy.com/) API key
- A running Namespace indexer instance

Docker is optional. It packages the native libraries needed by `canvas`.

## Quick start

Clone the repository, install dependencies, and create a local configuration:

```bash
git clone https://github.com/thenamespace/metadata-service.git
cd metadata-service
corepack enable
pnpm install
cp .env.example .env
```

Fill in the required values in `.env`, then start the development server:

```bash
pnpm start:dev
```

The service is available at `http://localhost:3000`.

| Resource             | URL                                  |
| -------------------- | ------------------------------------ |
| Interactive API docs | `http://localhost:3000/docs`         |
| OpenAPI document     | `http://localhost:3000/openapi.json` |
| Health check         | `http://localhost:3000/health`       |
| Prometheus metrics   | `http://localhost:3000/metrics`      |

> [!NOTE]
> Startup fails fast when required indexer, Alchemy, or Google Cloud credentials
> are missing. This is intentional so a deployment cannot silently run without
> authentication or storage.

## Configuration

Copy [`.env.example`](./.env.example) and set the values for your environment.

### Required

| Variable                       | Description                                                               |
| ------------------------------ | ------------------------------------------------------------------------- |
| `METADATA_URL`                 | Public base URL of this service, used in generated metadata               |
| `INDEXER_SERVICE_URL`          | Base URL of the Namespace indexer service                                 |
| `ALCHEMY_API_KEY`              | Alchemy key used to verify smart-wallet signatures on Mainnet and Sepolia |
| `GCLOUD_PROJECT_ID`            | Google Cloud project containing the media bucket                          |
| `GCLOUD_BUCKET_NAME`           | Public media bucket hostname, for example `avatars.example.com`           |
| `GCLOUD_BUCKET_CLIENT_EMAIL`   | Service-account email with access to the bucket                           |
| `GCLOUD_BUCKET_PRIVATE_KEY_ID` | Service-account private-key ID                                            |
| `GCLOUD_BUCKET_PRIVATE_KEY`    | Base64-encoded PEM private key                                            |

Encode a service-account PEM key without line breaks:

```bash
base64 < private-key.pem | tr -d '\n'
```

### Optional

| Variable                 | Default               | Description                                |
| ------------------------ | --------------------- | ------------------------------------------ |
| `PORT`                   | `3000`                | HTTP port                                  |
| `SIWE_ALLOWED_CHAIN_IDS` | `1,11155111`          | Comma-separated chain IDs accepted by SIWE |
| `SIWE_NONCE_TTL_MS`      | `300000`              | Nonce lifetime in milliseconds             |
| `ETH_MAINNET_RPC_URL`    | viem public transport | Custom Mainnet RPC for ENS lookups         |
| `ETH_SEPOLIA_RPC_URL`    | viem public transport | Custom Sepolia RPC for ENS lookups         |
| `MAX_AVATAR_BYTES_IN_MB` | `2097152` (2 MiB)      | Max avatar upload size, in bytes           |
| `MAX_HEADER_BYTES_IN_MB` | `5242880` (5 MiB)      | Max header upload size, in bytes           |

Avatar uploads are limited to 2 MiB and header uploads to 5 MiB. The multipart
server also enforces a 5 MiB limit per request.

## Avatar authorization

V1 names retain the existing ETH-address check. V2 names accept the owner or an
editor authorized for the relevant avatar/header record. Uploads before name
creation retain the pending verification flow. Supported V2 deployments are
listed in `src/ens/ens-contracts.ts`; mainnet behavior is unchanged.

## API

The Swagger UI is the canonical, interactive API reference. The summary below
is useful for orientation.

### Metadata

| Method | Path                                                  | Description                              |
| ------ | ----------------------------------------------------- | ---------------------------------------- |
| `GET`  | `/metadata/network/:chainId/token/:tokenId`           | Return JSON metadata for a subname token |
| `GET`  | `/metadata/network/:chainId/token/:tokenId/image.png` | Return its generated PNG image           |

### Authentication

| Method | Path          | Description               | Limit              |
| ------ | ------------- | ------------------------- | ------------------ |
| `POST` | `/auth/nonce` | Issue a scoped SIWE nonce | 10 requests/minute |

Request:

```json
{
  "address": "0x0000000000000000000000000000000000000000",
  "scope": "avatar+header"
}
```

`scope` may be `avatar`, `header`, or `avatar+header`; it defaults to
`avatar+header`.

### Profile media

| Method   | Path                                | Body                                                                        | Limit              |
| -------- | ----------------------------------- | --------------------------------------------------------------------------- | ------------------ |
| `POST`   | `/profile/:network/:subname/avatar` | Multipart form with `avatar`, `siweMessage`, `siweSignature`, and `address` | 5 requests/minute  |
| `DELETE` | `/profile/:network/:subname/avatar` | JSON with `siweMessage`, `siweSignature`, and `address`                     | 10 requests/minute |
| `POST`   | `/profile/:network/:subname/header` | Multipart form with `header`, `siweMessage`, `siweSignature`, and `address` | 5 requests/minute  |
| `DELETE` | `/profile/:network/:subname/header` | JSON with `siweMessage`, `siweSignature`, and `address`                     | 10 requests/minute |

`network` must be `mainnet` (chain ID `1`) or `sepolia` (chain ID `11155111`).
Uploads accept JPEG, PNG, GIF, WebP, and SVG images.

If an ENS address record exists, it must match the verified signer. If the
record does not exist yet, the upload is held as pending for five minutes while
the service waits for the record to be set.

## Authentication flow

1. Request a nonce from `POST /auth/nonce` for the wallet and intended media
   scope.
2. Create and sign a SIWE v1 message containing that nonce.
3. Send the original message, signature, and address with the protected request.
4. The service verifies the signature, consumes the nonce for that action, and
   checks the ENS address record.

A combined `avatar+header` nonce may be consumed once for each action. Reusing
it for the same action is rejected. The SIWE message chain ID must match the
network in the profile route.

The service accepts the domain embedded in the signed SIWE message; it does not
enforce an application-domain allowlist. Integrators should not treat the SIWE
domain as a server-enforced origin boundary.

## Development

```bash
# Watch mode
pnpm start:dev

# Compile the service
pnpm build

# Run the compiled service
pnpm start:prod

# Lint and apply safe fixes
pnpm lint

# Format source and tests
pnpm format
```

### Tests

```bash
pnpm test
pnpm test:e2e
pnpm test:cov
```

### Docker

Build and run the image with the same `.env` file:

```bash
docker build -t namespace-metadata-service .
docker run --rm \
  --name namespace-metadata-service \
  --env-file .env \
  -p 3000:3000 \
  namespace-metadata-service
```

## Architecture

```text
Client
  ├─ metadata request ──> Metadata module ──> Namespace indexer
  └─ profile mutation ──> SIWE verification ──> ENS ownership check
                                                  └─> Google Cloud Storage
```

| Module          | Responsibility                                          |
| --------------- | ------------------------------------------------------- |
| `metadata`      | Builds token metadata and generated images              |
| `subnames`      | Fetches subname data from the indexer                   |
| `auth`          | Issues nonces and verifies SIWE signatures              |
| `avatar`        | Validates profile mutations and uploaded media          |
| `ens`           | Resolves ENS address records on Mainnet and Sepolia     |
| `storage`       | Reads and writes media in Google Cloud Storage          |
| `observability` | Exposes request, verification, ENS, and storage metrics |

## Contributing and security

Contributions are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the
development workflow.

Please report vulnerabilities privately as described in
[SECURITY.md](./SECURITY.md), not in a public issue.

## License

MIT — see [LICENSE](./LICENSE).
