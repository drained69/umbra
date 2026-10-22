#!/usr/bin/env bash
# Full end-to-end run on a throwaway local Anvil chain:
#   real deploy pipeline -> SDK E2E (fixed pool + join-split) -> relayer smoke test.
# Used by `make e2e` and CI. Anvil keys below are Foundry's public dev keys (local only).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

KEY0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # deployer/user
KEY1=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d   # relayer
PORT_RPC=${E2E_RPC_PORT:-8545}
PORT_RELAYER=${E2E_RELAYER_PORT:-8787}

cleanup() { kill ${ANVIL_PID:-} ${RELAYER_PID:-} 2>/dev/null || true; }
trap cleanup EXIT

echo "==> anvil"
anvil --silent --port "$PORT_RPC" &
ANVIL_PID=$!
until curl -s -X POST -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "http://127.0.0.1:$PORT_RPC" >/dev/null; do sleep 0.5; done

echo "==> build + deploy (local)"
(cd contracts && forge build >/dev/null)
(cd scripts && NETWORK=local PRIVATE_KEY=$KEY0 PORTALDOT_RPC="http://127.0.0.1:$PORT_RPC" node deploy.js)

echo "==> SDK end-to-end"
(cd sdk && E2E_RPC="http://127.0.0.1:$PORT_RPC" npx --yes tsx@4.19.1 test/e2e.ts)

echo "==> relayer smoke"
(cd relayer && NETWORK=local PRIVATE_KEY=$KEY1 PORTALDOT_RPC="http://127.0.0.1:$PORT_RPC" RELAYER_PORT=$PORT_RELAYER exec node index.js) &
RELAYER_PID=$!
until curl -s "http://127.0.0.1:$PORT_RELAYER/health" >/dev/null; do sleep 0.5; done
(cd sdk && E2E_RPC="http://127.0.0.1:$PORT_RPC" RELAYER_URL="http://127.0.0.1:$PORT_RELAYER" npx --yes tsx@4.19.1 test/relayer_smoke.ts)

echo "==> E2E OK"
