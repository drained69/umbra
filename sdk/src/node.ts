// Node-only helpers for services (the relayer) that sign as a native Portaldot account.
// Not exported from index.ts, so the browser bundle never pulls in the keyring.

export { ApiPromise, WsProvider, Keyring } from "@polkadot/api";
export { cryptoWaitReady } from "@polkadot/util-crypto";
