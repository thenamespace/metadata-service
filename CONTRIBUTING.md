# Contributing

Thanks for helping improve the Namespace Metadata Service.

## Before you begin

- Search existing issues and pull requests before starting overlapping work.
- Keep changes focused. Open an issue first for large behavioral or API changes.
- Never commit credentials, private keys, `.env` files, or user data.

## Local setup

You need Node.js 22.13+ and pnpm 11.17+.

```bash
git clone https://github.com/thenamespace/metadata-service.git
cd metadata-service
corepack enable
pnpm install
cp .env.example .env
```

Complete the required values in `.env`, then run:

```bash
pnpm start:dev
```

See the [README](./README.md#configuration) for configuration details.

## Making a change

1. Create a branch from the latest default branch.
2. Add or update tests for behavioral changes.
3. Keep public API changes reflected in Swagger annotations and the README.
4. Run the checks below before opening a pull request.

```bash
pnpm build
pnpm test
pnpm lint
```

`pnpm lint` applies fixes, so review its changes before committing.

## Pull requests

Describe:

- what changed and why;
- how you tested it;
- any configuration, API, security, or deployment impact.

Keep unrelated refactors out of the same pull request. A maintainer may ask for
changes before merging.

## Reporting security issues

Do not open a public issue for a vulnerability. Follow
[SECURITY.md](./SECURITY.md) instead.
