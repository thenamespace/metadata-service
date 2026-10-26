# Avatar service ENS V1 and V2 compatibility plan

Status: Implemented locally on `feat/avatar-ensv2-compatibility`. Sepolia activation and deployment remain pending.

## Objective

Preserve the avatar service's existing ENS V1 behavior, including offchain subnames and uploads before name creation. Add ENS V2 ownership and delegated record-editor checks. Validate on Sepolia before considering mainnet rollout.

Scope is this repository's avatar service, including headers because they share its authorization and pending-upload flow. Do not change offchain-manager, its ownership model, other services, or infrastructure.

## Agreed behavior

| Name or upload state | Required behavior |
| --- | --- |
| V1 name with a resolved ETH address matching the uploader | Accept immediately, as today. |
| V1 name with an existing address that differs from the uploader | Reject, as today. |
| V1 name without a resolved ETH address | Preserve the existing pending-upload flow. |
| Existing offchain subname using the current V1 path | Preserve existing address-based checks. Do not introduce a database-owner policy. |
| V2 name | Accept the name owner or a wallet authorized to edit the relevant text record. |
| Name not created yet | Allow a pending upload using the existing flow. Re-evaluate the applicable authorization path during verification. |
| Pending upload | Confirm or discard using the applicable V1 or V2 checks. |
| RPC or authorization lookup failure | Do not interpret the failure as proof of missing ownership or permission. Preserve the queued upload for retry. |

For V2, an avatar editor needs permission for `avatar`; a header editor needs permission for `header`. The resolved ETH address alone is not V2 authorization. Ownership grants access to the hosted image under this service policy; the service does not set the onchain text record.

Keep the existing pending timing for this first change. A longer registration window was discussed but not selected. Pending uploads must retain existing protections against overwriting an existing file.

## 1. Verify the deployment and classification rules

- Inspect current official Sepolia deployment artifacts and verify the contracts through read-only RPC calls. Record the source commit, ABI provenance, addresses, chain ID, and block number used.
- Resolve the difference between the September 15 deployment tag and the addresses in current documentation before choosing a helper address.
- Use the canonical Universal Resolver proxy for resolution. Confirm the deployed ownership-helper and resolver-permission interfaces rather than using an older `findOwner` ABI.
- Keep the installed `viem@2.38.2` unless a reproducible failure requires an upgrade.
- Establish how to classify each name as V1-backed, V2-backed, or not yet created. Sepolia alone does not imply V2: unmigrated V1 names can resolve through the V2 deployment.
- Check migrated names, V1 fallback resolution, inherited/wildcard resolvers, and resolver-only offchain names. Neither a missing address nor a zero ownership result is sufficient to classify a name.
- Treat unsupported or ambiguous classification explicitly. Do not silently choose the permissive V1 path after a failed V2 lookup.

Deliverable: verified deployment details and classification fixtures. Exact contract calls remain an implementation prerequisite, not a settled part of this draft.

## 2. Add the V2 authorization path

Keep the existing V1 address-check implementation. Add a focused internal authorization function accepting the normalized name, network, authenticated wallet, and media record key.

For a confirmed V2 name:

1. Read the exact name owner through the verified ownership interface.
2. Accept the owner under the agreed service policy.
3. Otherwise locate the resolver actually serving the name and check its supported editor authorization mechanism.
4. For a Permissioned Resolver, evaluate the effective text-setting role for the requested key, including resolver-wide grants. Use the deployed contract's resource computation and role semantics.
5. Reject a wallet without the required authority. Do not infer child ownership from the nearest owned ancestor or treat unrelated/admin-only roles as text-edit permission.

Use fresh V2 permission reads initially so the existing five-minute V1 address cache does not extend revoked V2 permissions. Keep V1 cache behavior unchanged.

V2 resolver-only names need classification and permission fixtures even when they have no exact registry owner. Lack of an owner must not prevent a proven record editor from qualifying.

## 3. Wire uploads, deletes, and pending verification

| File | Planned change |
| --- | --- |
| `src/ens/ens.service.ts` | Preserve V1 lookups and expose the version-aware authorization decision. |
| Focused new files under `src/ens/` | Add classification, V2 reads, and minimal verified ABIs as needed. Avoid a generic authorization framework. |
| `src/avatar/avatar.controller.ts` | Use the shared decision for avatar/header uploads and deletes while preserving V1 responses and pending behavior. |
| `src/avatar/avatar-verification.service.ts` | Re-evaluate the name's current path and queued wallet's authority when processing pending uploads. |
| `src/avatar/avatar.module.ts` | Register additional providers only where needed. |
| Tests and `README.md` | Document and verify the additional V2 behavior and any configuration. |

Keep endpoint request formats, SIWE authentication, storage paths, and image URL formats unchanged. Reuse queue entries' wallet, network, name, and file type where sufficient. Check that delayed verification cannot delete a newer upload before deciding whether a queue change is necessary.

## 4. Automated verification

- V1 regression tests: matching address, mismatching address, missing record, offchain/CCIP resolution, pending confirmation/discard, and existing cache behavior.
- V2 tests: owner with and without an ETH address record; avatar-only editor; header-only editor; resolver-wide text editor; unauthorized wallet; and address recipient without owner/editor authority.
- State changes: ownership transfer, delegation revocation, resolver replacement, expired names, and pending names created after upload.
- Classification: V1 names on Sepolia, migrated V2 names, fresh V2 names, resolver-only names, and genuinely absent names.
- Failure handling: RPC timeout, CCIP failure, unsupported permission interface, and ambiguous classification must not become successful authorization or destructive pending cleanup.
- Verify both avatar and header upload/delete paths, network separation, and existing SIWE checks.
- Run relevant tests, type checking, non-mutating lint checks, formatting checks, and build. Report any pre-existing failures separately.

## 5. Sepolia validation and rollout

1. Run read-only deployment and fixture checks automatically.
2. Use isolated test storage and controlled owner, delegate, and unauthorized wallets for signed upload, update, delete, and pending verification tests.
3. Test registration after upload and permission revocation before queued verification.
4. Record local, live RPC, and signed end-to-end results separately. A passing mock test is not evidence of live compatibility.
5. Prepare an implementation PR from a non-main branch into `main`, including evidence and rollback instructions. Merge requires separate approval.
6. Validate in Sepolia staging first. Mainnet activation is a later rollout decision after V1 regression and V2 checks pass.

No production credentials or private keys belong in fixtures or documentation. The supplied test signer was used only in memory for local signed tests with live Sepolia reads and in-memory image storage.

## Acceptance criteria

- Existing V1 and offchain avatar flows retain their behavior.
- V2 owners and authorized editors can manage the corresponding hosted images.
- Unauthorized V2 wallets cannot gain access through an address-record fallback.
- Uploads before name creation remain supported.
- Pending verification selects the applicable checks after creation or migration.
- Errors do not authorize writes or cause deletion as if permission had been conclusively denied.
- Changes remain confined to the avatar service and its supporting tests/configuration/docs in this repository.

## References

- [ENS readiness and supported library versions](https://docs.ens.domains/web/ensv2-readiness/)
- [Current deployment documentation](https://docs.ens.domains/learn/deployments/)
- [September 15 Sepolia release](https://github.com/ensdomains/contracts-v2/releases/tag/sepolia-deployment-2026-09-15)
- [Universal Resolver and ownership helper](https://docs.ens.domains/ensv2/universal-resolver-v2/)
- [Permissioned Resolver permissions](https://docs.ens.domains/ensv2/permissioned-resolver/)
- [V1 to V2 migration behavior](https://docs.ens.domains/ensv2/migration/)

## Implementation evidence

- Deployment source pinned to `07e55a056f5b6a9c90119f501bdd05714e67dddd`; helper and canonical resolver root registries matched on Sepolia.
- Signed local controller checks completed at Sepolia block `12000434`: owner avatar/header create, update, delete; unrelated signer rejection; inherited resolver editor upload/delete; pre-registration pending admission and unresolved cleanup; and V1 mirror compatibility.
- Storage was in memory. No production bucket writes, onchain transactions, or deployment occurred. HTTP transport and deployed storage remain unverified.
- Automated suite: 54 tests across 8 suites. Type check, build, changed-TypeScript ESLint, and formatting checks passed. Tests use the existing Jest setup in this PR; no separate test PR is needed or created.
- V2 is opt-in on Sepolia through the variables documented in README. Mainnet remains on the existing V1 address path.
- Ownerless V2 names may inherit a resolver before registration. After a definitive failed editor check, a missing ETH address permits pending admission; it never authorizes an immediate V2 upload.
- Unsupported custom V2 editor interfaces return an error; only PermissionedResolver and the configured PublicResolverV2 editor interfaces are supported initially.
- The existing pending queue timing and storage concurrency behavior are unchanged. Registration transactions, live permission grant/revoke transactions, and deployed HTTP/storage tests remain outside the completed validation.
