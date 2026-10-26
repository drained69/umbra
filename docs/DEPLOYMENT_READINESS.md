# Umbra V3 testnet deployment

Completed and verified on 2026-10-24 for native deployer `5Dvps2P4hYwZAwDw2qjTdozWUvwXyFCc98o3RJx2eKHAFXv8`.

## Scope and result

- The deployment target is **Portaldot V3 testnet** (chain ID `420420777`).
- The full native plan is eight functional contracts: Poseidon(2), the withdrawal verifier, 100 and 1000 tPOT pools, 100 and 1000 pUSD pools, the transaction verifier, and the join-split pool. These pools are deployed directly; the native plan does not deploy `UmbraPoolFactory`.
- The eight deployed addresses are saved in `deployments/testnet.json` and `frontend/src/config/deployment.json`.
- Read-only verification confirmed all eight contract accounts, all four pool configurations, join-split pool wiring, Poseidon zero hashing, and real-proof acceptance by both verifiers.
- The contract and circuit review found no new Critical or High finding in the fixed pools, join-split pool, Merkle trees, factory, or circuits. `forge test --offline -vv` passed 47 tests. `node circuits/scripts/manifest.js --check` verified all nine pinned ZK artifacts. The native SDK's live read-only deployment test reported the full plan affordable.

## Deployment controls

- Use the link with `?deploy&all&account=<SS58 address>` to select the full plan and require the exact extension account. The UI shows the full signer address and prices the plan before enabling Deploy.
- The Portaldot Extension signs each transaction. No private key is supplied to the site or repository.
- Progress is keyed by chain, signer, artifact manifest hash, and plan. Before resume, the UI checks stored code hashes and each pool's verifier, hasher, denomination, asset, and tree depth against the plan. Each remaining step is dry-run before signing.
- The app's bundled config contains the verified addresses. Gasless withdrawals require a separate configured relayer; until then, the app offers wallet-signed withdrawal.
- Run `node scripts/verify-native-deployment.js path/to/deployment.json 5Dvps2P4hYwZAwDw2qjTdozWUvwXyFCc98o3RJx2eKHAFXv8` before installing the config. It checks chain, deployer mapping, all eight deployed contracts, pool wiring, Poseidon, and both verifiers with real proofs.

## Boundary

`sdk/artifacts/MANIFEST.json` marks the Groth16 setup `local-single-contributor (DEMO ONLY)`. This is a testnet demo deployment. Real-funds deployment requires a multi-party trusted setup and independent professional audit as documented in `docs/MAINNET.md`.
