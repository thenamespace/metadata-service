# Real-wallet SIWE fixtures

This directory holds production-style SIWE fixtures captured from real wallets
(EOA, Safe, Coinbase Smart Wallet, an ERC-6492 counterfactual case). They are
used by `src/auth/auth.service.spec.ts` to guard against regressions when
`@signinwithethereum/siwe` or `viem` versions move.

## File format

One JSON file per fixture. Filename should describe the wallet, e.g.
`safe-mainnet-deployed.json`, `coinbase-smart-wallet-counterfactual.json`,
`eoa-metamask.json`.

```json
{
  "label": "Safe (deployed) on mainnet",
  "address": "0x...",
  "domain": "namespace.ninja",
  "chainId": 1,
  "siweMessage": "namespace.ninja wants you to sign in...",
  "siweSignature": "0x...",
  "expected": "verifies"
}
```

`expected` is either `"verifies"` or `"rejects"`; the latter is for adversarial
samples (replays, tampered messages, etc.) and should include a `reason` field.

## How fixtures are loaded

`src/auth/auth.service.spec.ts` uses `fs.readdirSync('test/fixtures/siwe')` +
`it.each(...)` to assert each fixture verifies. The `domain` and `chainId` in
the fixture must match the SIWE message — the harness asserts both before
calling `verifySiweAndConsume`.

## Capturing a fixture

1. In a browser dev console after signing, copy the SIWE message + signature
   straight from the network tab.
2. Save as `<wallet>-<chain>-<state>.json` in this directory.
3. For Safe / smart-account wallets, the assertion uses the real chain RPC, so
   ensure `ALCHEMY_API_KEY` is set when running the test against fixtures.
