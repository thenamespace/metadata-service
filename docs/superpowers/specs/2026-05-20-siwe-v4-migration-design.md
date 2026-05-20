# SIWE v4 migration — metadata-service

**Status:** Draft for review
**Date:** 2026-05-20
**Owner:** Harpreet Singh
**Scope:** This repo (`metadata-service`). Avatar SDK and ui-kit changes are coordinated follow-up work tracked in §6 and §7; they are not implemented as part of this spec.

---

## 1. Goal

Migrate `metadata-service` off the abandoned `siwe@^3.0.0` (Spruce) to the maintained `@signinwithethereum/siwe@^4.2.0`, drop the now-redundant `@ambire/signature-validator` smart-account path in favour of v4's native EIP-1271 + EIP-6492 support via viem, and add **caller-asserted domain binding** as the defence-in-depth control v4 mandates — without breaking the service's plug-and-play, open-to-any-app posture.

Verification remains **inline per avatar/header upload** and the existing **scope + one-time-use consumption** model (`avatar` / `header` / `avatar+header`) is preserved verbatim. No JWT flow is introduced.

## 2. Non-goals

These are out of scope; do not bundle them in:

- **JWT login flow.** A separate `/auth/verify` issuing tokens used by uploads. The current inline model is what we're keeping.
- **Sharing one viem client between `AuthService` and `EnsService`.** `EnsService` keeps its own client; consolidation is unrelated refactoring.
- **Replacing the in-memory nonce `Map`** with Redis/DB. Single-instance assumption is preserved.
- **Domain allowlist / tenant registry / API keys.** The service stays fully open; any app on any domain integrates without server-side enrolment.
- **Observability stack** (pino, Sentry, `prom-client`, OTel). Stays on the NestJS `Logger` baseline.

## 3. Current state (this repo)

All SIWE logic lives in **one file**: `src/auth/auth.service.ts`. The flow:

1. `POST /auth/nonce` → `AuthService.generateNonce(address, scope)` stores a `NonceRecord` keyed by lowercased address with `scope` (`avatar` | `header` | `avatar+header`) and per-action `used` flags.
2. Avatar / header uploads + deletes carry `siweMessage`, `siweSignature`, `address` in either JSON body (`AvatarUploadDto`) or multipart FormData (extracted via `getTextField`).
3. `avatar.controller.ts` calls `authService.verifySiweAndConsume({ action, message, signature, address })` inline; the action (`avatar` / `header`) is checked against the nonce's `scope`, the matching `used.<action>` flag is flipped, and on full consumption the record is deleted.
4. Verification today: `new SiweMessage(message)`; for EOA, `siwe.verify({ signature, nonce })`; for smart-account (detected by `signature.length > 132` or string `'6492'`), `@ambire/signature-validator`'s `verifyMessage`. Manual checks for `siwe.address`, `siwe.nonce`, `siwe.expirationTime`, `siwe.notBefore`, and `SIWE_ALLOWED_CHAIN_IDS` follow.

### What's missing / wrong

- **No domain binding.** The SIWE `domain` field is never validated against anything the server knows. A message signed for an attacker's relying party can be replayed against this backend (Alice's wallet signs `evil.com`'s SIWE; attacker pre-fetches her nonce; submits to us). The wallet UX is currently the only defence.
- **Abandoned library.** `siwe@3.0.0` from Spruce has been unmaintained for ~1 year. The signinwithethereum fork (v4) is the active successor.
- **Crude smart-account detection.** `signature.length > 132 || signature.includes('6492')` is heuristic and Ambire is invoked separately from the SIWE message validation — chain-ID and 6492 envelope handling live in two different libraries.
- **Blanket `catch`** in `verifySiweAndConsume` collapses every internal failure to one opaque `SIGNATURE_VERIFICATION_FAILED`.

## 4. Target state

- `package.json`: remove `siwe@^3.0.0` and `@ambire/signature-validator`; add `@signinwithethereum/siwe@^4.2.0`. `viem` stays at `^2.38.2` (peer requirement is `^2.7.0`).
- `AuthService` constructs one `SiweConfig` per supported chain (mainnet + sepolia) via `createViemConfig({ publicClient })`, reusing the existing `mainnetClient` / `sepoliaClient`. The config matching `siwe.chainId` is passed per `verify()` call. EOA paths need no RPC; smart-account paths route to the chain-matched client.
- Smart-account wallets (EIP-1271) and counterfactual wallets (EIP-6492) verify transparently through the same `verify()` call — no library branching, no length heuristic.
- A new **`domain: string`** field on the wire is asserted by the caller and checked for equality against the SIWE message's `domain` before delegating to v4. No allowlist — service remains open.
- A **1-week grace period** is in effect after first deploy: if `domain` is absent the request is accepted (we fall back to the message's own domain and log a deprecation warning). After 1 week a follow-up PR removes the fallback and `domain` becomes strictly required.
- Verification errors are translated through a typed `SiweErrorType → ErrorCodes` mapper. Consumers get `DOMAIN_MISMATCH`, `MALFORMED_MESSAGE`, `MESSAGE_NOT_YET_VALID`, `NONCE_MISMATCH`, `SIGNATURE_EXPIRED`, `INVALID_CHAIN_ID`, etc., instead of one opaque 401.
- `scope` + `used.{avatar,header}` consumption is untouched; the dual-`avatar+header` flow keeps working.

## 5. Detailed changes

### 5.1 Dependencies (`package.json`)

Remove:

```json
"siwe": "^3.0.0",
"@ambire/signature-validator": "<current>"
```

Add:

```json
"@signinwithethereum/siwe": "^4.2.0"
```

`viem ^2.38.2` is unchanged. The transitive `@signinwithethereum/siwe-parser@^4.2.0` is pulled in by the main package.

### 5.2 SIWE config wiring

New file: `src/auth/siwe.config.ts`.

```ts
import { createViemConfig, SiweConfig } from '@signinwithethereum/siwe';
import type { PublicClient } from 'viem';

export interface ChainConfigs {
  /** chainId → SiweConfig bound to that chain's viem PublicClient */
  byChain: Map<number, SiweConfig>;
}

export async function buildSiweConfigs(clients: {
  mainnet: PublicClient;
  sepolia: PublicClient;
}): Promise<ChainConfigs> {
  const byChain = new Map<number, SiweConfig>();
  byChain.set(1, await createViemConfig({ publicClient: clients.mainnet }));
  byChain.set(11155111, await createViemConfig({ publicClient: clients.sepolia }));
  return { byChain };
}
```

`AuthService` constructs these in its constructor (alongside the existing mainnet/sepolia clients) and exposes `private configFor(chainId: number): SiweConfig`. Lookup miss falls back to mainnet's config (matching today's `getRpcClientForChainId` behaviour) and logs a warning.

`generateSiweNonce` (from `viem/siwe`) is replaced with v4's `generateNonce`. Behaviourally equivalent — both emit a 96-bit alphanumeric token.

### 5.3 `AuthService.verifySiweAndConsume`

Updated signature:

```ts
interface VerificationParams {
  action: 'avatar' | 'header';
  message: string;
  signature: string;
  address: string;
  domain?: string;   // optional during the 1-week grace period; required after follow-up PR
}
```

New flow (steps in order, every failure path emits a typed `ErrorCodes` and logs):

1. **Nonce lookup.** Lowercase address, fetch `NonceRecord`. Missing → `NONCE_NOT_FOUND`. (unchanged)
2. **Parse.** `new SiweMessage(message)` in `try/catch`. Failure → `MALFORMED_MESSAGE`.
3. **Domain assertion (grace-aware).**
   - If `params.domain` is provided: assert `siwe.domain === params.domain`; mismatch → `DOMAIN_MISMATCH`. Pass `params.domain` to `verify()`.
   - If `params.domain` is absent **and** grace period is active: log `siwe.domain.deprecated` warning with caller IP / address; pass `siwe.domain` itself to `verify()` (binding becomes a no-op for that call, identical security posture to today).
   - If absent **and** grace expired (post-follow-up PR): reject with `MISSING_DOMAIN`.
4. **Chain allowlist.** Existing `SIWE_ALLOWED_CHAIN_IDS` parsing; reject early with `INVALID_CHAIN_ID`. (preserved)
5. **v4 verify.**

   ```ts
   const { success, data, error } = await siwe.verify(
     {
       signature,
       domain: effectiveDomain,
       nonce: record.nonce,
       chainId: Number(siwe.chainId),
     },
     {
       config: this.configFor(Number(siwe.chainId)),
       suppressExceptions: true,
     },
   );
   ```

   `!success` → `mapSiweError(error)` → typed `ErrorCodes`. v4 internally handles `expirationTime` and `notBefore`, so the manual checks at current lines 147–158 are deleted.

6. **Address cross-check.** `data.address.toLowerCase() === lower` → else `ADDRESS_MISMATCH`. v4 already verifies the message-internal address matches the recovered signer; this guards the separate "did the API caller tell us the truth about *which* address" assertion.
7. **Nonce-store TTL.** `Date.now() > record.expiresAt` → delete record, throw `SIGNATURE_EXPIRED`. (app-specific; preserved)
8. **Scope + consumption** (lines 197–223 today): **unchanged**. Scope rejection / re-use → `UNAUTHORIZED`. Delete record on full consumption.
9. Return `{ address: lower }`.

`@ambire/signature-validator` is gone. The `signature.length > 132 / includes('6492')` heuristic is deleted. v4 + viem natively routes EOA → ecrecover, deployed contract → ERC-1271 via `readContract`, counterfactual → EIP-6492 envelope unwrapped and verified via viem's `verifyMessage` with state-override `eth_call`.

### 5.4 Wire contract (`AvatarUploadDto` and multipart paths)

Add `domain` to `AvatarUploadDto` (inherited by `HeaderUploadDto`, `AvatarDeleteDto`, `HeaderDeleteDto` — one DTO change covers all four endpoints):

```ts
@ApiProperty({
  description: 'DNS authority the SIWE message was signed for (e.g. app.example.com). '
             + 'Asserted equal to message.domain. Optional during the 1-week grace period.',
  example: 'namespace.ninja',
  required: false,
})
@IsOptional()
@IsString()
@IsNotEmpty()
@MaxLength(253)
domain?: string;
```

After the grace period's follow-up PR, `@IsOptional()` is removed and the field becomes required.

In `avatar.controller.ts`, both call paths thread `domain` through:

- **JSON DTO path** (current lines ~287, ~507 + the two delete endpoints): pass `dto.domain` into `verifySiweAndConsume({ ..., domain })`.
- **Multipart path** (lines ~176, ~395): extract via `this.getTextField(r.body?.domain)` alongside the existing `siweMessage` / `siweSignature` extraction.

The DTO `address` regex and signature regex stay as-is — EIP-6492 envelopes are still hex strings matching `^0x[a-fA-F0-9]{130,}$`.

### 5.5 Error codes (`src/common/enums/error-codes.enum.ts`)

Add:

- `DOMAIN_MISMATCH` — caller-declared `domain` ≠ `message.domain`, OR v4 reports a domain mismatch internally.
- `MALFORMED_MESSAGE` — `new SiweMessage(message)` threw / `UNABLE_TO_PARSE`.
- `MESSAGE_NOT_YET_VALID` — v4's `NOT_YET_VALID_MESSAGE` (manual `notBefore` check is gone).
- `MISSING_DOMAIN` — only emitted after the grace period; `domain` absent on the wire.

Reuse:

- `NONCE_NOT_FOUND`, `NONCE_MISMATCH`, `ADDRESS_MISMATCH`, `SIGNATURE_EXPIRED`, `INVALID_CHAIN_ID`, `UNAUTHORIZED`, `INVALID_ADDRESS`, `SIGNATURE_VERIFICATION_FAILED` (catch-all).

Remove (no longer used):

- `SMART_CONTRACT_SIGNATURE_VERIFICATION_FAILED` — branching is gone; collapse to `INVALID_SIGNATURE` via the mapper.
- `EOA_SIGNATURE_VERIFICATION_FAILED` — same reason.

New file `src/auth/siwe-error.mapper.ts`:

```ts
import { SiweErrorType } from '@signinwithethereum/siwe';
import { ErrorCodes } from '../common/enums/error-codes.enum';

export function mapSiweError(err?: { type?: SiweErrorType }): ErrorCodes {
  switch (err?.type) {
    case SiweErrorType.DOMAIN_MISMATCH:        return ErrorCodes.DOMAIN_MISMATCH;
    case SiweErrorType.NONCE_MISMATCH:         return ErrorCodes.NONCE_MISMATCH;
    case SiweErrorType.EXPIRED_MESSAGE:        return ErrorCodes.SIGNATURE_EXPIRED;
    case SiweErrorType.NOT_YET_VALID_MESSAGE:  return ErrorCodes.MESSAGE_NOT_YET_VALID;
    case SiweErrorType.CHAIN_ID_MISMATCH:      return ErrorCodes.INVALID_CHAIN_ID;
    case SiweErrorType.INVALID_ADDRESS:        return ErrorCodes.INVALID_ADDRESS;
    case SiweErrorType.UNABLE_TO_PARSE:        return ErrorCodes.MALFORMED_MESSAGE;
    case SiweErrorType.INVALID_SIGNATURE:
    case SiweErrorType.INVALID_SIGNATURE_CHAIN_ID:
    default:                                   return ErrorCodes.SIGNATURE_VERIFICATION_FAILED;
  }
}
```

### 5.6 Environment variables

| Variable | Status | Notes |
|---|---|---|
| `ALCHEMY_API_KEY` | unchanged | Already required for the existing viem clients. |
| `SIWE_NONCE_TTL_MS` | unchanged | Default 300_000 (5 min). App-specific TTL on top of v4's `expirationTime` check. |
| `SIWE_ALLOWED_CHAIN_IDS` | unchanged | Default `1,11155111`. Enforced before `verify()` for early reject. |
| `SIWE_DOMAIN_REQUIRED` | **new, optional** | `false` during 1-week grace (default). Flipped to `true` (or the flag is removed entirely) in the follow-up PR. |

`.env.example` is added in this PR (currently missing per `CLAUDE.md` policy) covering every variable above plus any others the service already reads.

### 5.7 README

Update the auth-flow section to document the new `domain` field, the grace-period behaviour, the smart-account support (EIP-1271 / EIP-6492) provided by v4 + viem, and the expanded error code list. Add a short "Migration notes for SDK / ui-kit consumers" subsection that points at §6 of this spec.

## 6. Migration notes (for avatar SDK + ui-kit consumers)

This is the spec's public contract for the follow-up SDK and ui-kit work — not implemented here, but documented so consumers can plan.

### What changes on the wire

Every `POST /auth/nonce` flow stays the same. Every avatar/header upload + delete now accepts a new field:

- **`domain: string`** — the DNS hostname the SIWE message was signed for. Must equal the `domain` line inside `siweMessage`. RFC-1035 hostname, ≤ 253 chars, no scheme, no port. Examples: `app.example.com`, `namespace.ninja`, `localhost`.

### Before / after request body

Before:

```json
{
  "siweMessage": "namespace.ninja wants you to sign in...",
  "siweSignature": "0x...",
  "address": "0x54b0..."
}
```

After:

```json
{
  "siweMessage": "namespace.ninja wants you to sign in...",
  "siweSignature": "0x...",
  "address": "0x54b0...",
  "domain": "namespace.ninja"
}
```

Multipart uploads add the same field as a text form field.

### How to source `domain`

- **Avatar SDK:** accept an explicit `domain` argument (preferred) or fall back to `window.location.hostname` in browser builds. Server / Node usage must pass it explicitly.
- **ui-kit:** the existing `siweDomain` prop (already plumbed in `ens-component-library`) maps directly to this; just forward it to the SDK call.

### New error codes consumers should handle

- `DOMAIN_MISMATCH` — caller sent a `domain` that doesn't match `message.domain`. Almost always a bug in how the message was constructed; surface clearly.
- `MALFORMED_MESSAGE` — message could not be parsed at all. Surface as a generic "invalid SIWE message" error.
- `MESSAGE_NOT_YET_VALID` — `notBefore` is in the future. Usually a clock skew on the signing client.
- `MISSING_DOMAIN` (after grace period only) — old client that doesn't send `domain`. Upgrade the SDK.

### Grace period

For one week after the backend deploys, requests without `domain` are accepted with a server-side deprecation log. After one week, a follow-up PR makes `domain` required and absent requests get `MISSING_DOMAIN` (401). SDK + ui-kit consumers should ship updated versions sending `domain` before that window closes.

## 7. Rollout sequence

| Step | Action | Where |
|---|---|---|
| 1 | Implement this spec in `metadata-service` | this repo |
| 2 | Local test against staging Alchemy keys + real-world SIWE signatures (EOA, Safe, Coinbase Smart Wallet, an ERC-6492 counterfactual sample) provided by the owner | this repo |
| 3 | Merge + deploy to staging | this repo |
| 4 | Update `@thenamespace/avatar` SDK: add `domain` argument, forward into the request body / multipart, bump major version | SDK repo |
| 5 | Update `ens-component-library` (ui-kit): bump SDK dep; `siweDomain` prop wired through (already plumbed) | ui-kit repo |
| 6 | Publish SDK + ui-kit | SDK / ui-kit |
| 7 | Deploy `metadata-service` to prod with `SIWE_DOMAIN_REQUIRED=false` (grace ON) | this repo |
| 8 | T+7 days: follow-up PR removes `@IsOptional()` from the DTO, removes the message-derived-domain fallback in `verifySiweAndConsume`, removes the `SIWE_DOMAIN_REQUIRED` env var. Deploy. | this repo |

Step 2's real-world signature samples will be supplied by the owner and committed as fixtures under `test/fixtures/siwe/` (see §8).

## 8. Test plan

`src/auth/auth.service.spec.ts` is rewritten. Tests mock the chain-bound `publicClient.verifyMessage` where smart-account paths run; EOA paths use real `viem` `privateKeyToAccount` signing.

**Unit cases:**

1. **EOA happy path** — viem-generated SIWE + signature, expected `domain` matches; returns `{ address }`.
2. **EOA happy path (grace, no domain)** — same as #1 but request omits `domain`; expect success + a `siwe.domain.deprecated` warning logged.
3. **EIP-1271 happy path** — mock `publicClient.verifyMessage` returns `true` for a contract address; verify completes.
4. **EIP-6492 detection logged** — signature carries the 6492 magic suffix; verify completes; structured log notes `signatureType: 'eip6492'`.
5. **Domain mismatch (body vs message)** — `domain: a.com`, message says `b.com` → 401 `DOMAIN_MISMATCH`.
6. **Nonce not found** — verify before nonce → 401 `NONCE_NOT_FOUND`.
7. **Nonce mismatch** — message embeds a different nonce → 401 `NONCE_MISMATCH` via mapper.
8. **Expired (v4 internal)** — `expirationTime` in the past → 401 `SIGNATURE_EXPIRED`.
9. **Not yet valid** — `notBefore` in the future → 401 `MESSAGE_NOT_YET_VALID`.
10. **Chain not allowed** — `SIWE_ALLOWED_CHAIN_IDS=1`, message says `chainId: 137` → 401 `INVALID_CHAIN_ID`.
11. **Address mismatch** — signature recovers to X, body says Y → 401 `ADDRESS_MISMATCH`.
12. **Replay** — successful verify consumes; second call with same message → 401 `NONCE_NOT_FOUND` (record deleted) or scope-rejection.
13. **Scope avatar-only used for header** — nonce issued with `scope: 'avatar'`, verify with `action: 'header'` → 401 `UNAUTHORIZED`.
14. **Scope avatar+header dual use** — single `avatar+header` nonce successfully verifies once for `avatar`, once for `header`; third call → 401.
15. **Nonce TTL expiry** — verify after `SIWE_NONCE_TTL_MS` → 401 `SIGNATURE_EXPIRED`, record deleted.
16. **Malformed message** — garbage string → 401 `MALFORMED_MESSAGE`.
17. **Post-grace, missing domain** — when `SIWE_DOMAIN_REQUIRED=true`, request omits `domain` → 401 `MISSING_DOMAIN`.

**Production fixtures (provided by owner):** real SIWE messages + signatures from at least one EOA, one Safe, one Coinbase Smart Wallet, and one ERC-6492 counterfactual case. Committed to `test/fixtures/siwe/` as JSON files; loaded by a fixture-driven `it.each` test that asserts each verifies successfully under the new flow. These guard against silent regressions when v4 / viem versions move.

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `@signinwithethereum/siwe@4` has no formal audit | Same disclaimer as `siwe@3`. v4 is EIP-4361-spec compliant and actively maintained; risk is not increasing. |
| Dropping `@ambire/signature-validator` regresses some exotic smart account | v4 + viem covers EIP-1271 and EIP-6492 for every wallet the user base realistically holds (Safe, Coinbase Smart Wallet, Argent, Biconomy, generic ERC-4337). The §8 production fixtures explicitly include a Safe and a 6492 case to prevent regression. If a regression appears, the rollback is a single-PR re-introduction of Ambire as a `verificationFallback` via v4's `VerifyOpts.verificationFallback` hook — design-compatible. |
| Alchemy outage breaks smart-account verification | EOA verification needs no RPC and continues to work. README notes this. |
| Breaking change for SDK / ui-kit consumers | 1-week grace period; coordinated rollout (§7) puts the follow-up PR after the SDK + ui-kit have released. |
| Smart-contract signature replay across chains | v4 enforces chain-ID match during EIP-1271 lookup (`INVALID_SIGNATURE_CHAIN_ID`). Already mitigated by the library. |
| Multi-chain `publicClient` mismatch (mainnet config used for a sepolia message) | `configFor(chainId)` selects the correct chain-bound config per request; unknown chainId falls back to mainnet with a warning (matches today's behaviour for the EOA path, where chain doesn't matter for ecrecover). |
| Grace-period code lives past 1 week | The follow-up PR is the *only* exit; calendar it. The `SIWE_DOMAIN_REQUIRED` env var makes it observable in deployment configs even if the PR slips. |

## 10. Follow-up work (not in this spec)

- **Avatar SDK migration** — add `domain` argument, drop any v3 SIWE references, bump major version.
- **ui-kit** (`ens-component-library`) — bump avatar SDK dep; `siweDomain` prop is already plumbed.
- **Grace-period removal PR** (T+7 days) — `@IsOptional()` removed from `domain`, message-derived fallback deleted from `verifySiweAndConsume`, `SIWE_DOMAIN_REQUIRED` env var deleted.
- **Eventual `EnsService` viem-client consolidation** — separate refactor; not coupled to this migration.
- **Persistence** — replace in-memory nonce `Map` with Redis before running > 1 instance.
- **Optional: structured logging** if the org standardises on pino later.
