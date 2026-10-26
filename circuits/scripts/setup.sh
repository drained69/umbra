#!/usr/bin/env bash
# Umbra ZK trusted setup for the circuits:
#   * withdraw     (fixed-denomination pool)
#   * transaction  (join-split / arbitrary-value shielded transfers)
#   * multiasset   (multi-asset join-split with a private swap leg)
#
# CIRCUITS="name:Verifier ..." builds a subset; REUSE_PTAU=1 keeps an existing phase-1 file
# (so adding a circuit does not change the keys of circuits that are already deployed).
#
# Phase 1 (Powers of Tau) is universal and shared by both circuits.
#
#   DEMO (default):       a fresh local ptau is generated (reproducible, NOT ceremony-grade)
#   PRODUCTION:           set PTAU_URL to a real community ptau (e.g. Hermez powersOfTau28_hez_final_16)
#                         -> required before any mainnet / real-funds deployment.
#
# Outputs per circuit: contracts/src/verifiers/<Name>Verifier.sol + wasm/zkey artifacts.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
BUILD="$ROOT/build"
PTAU_POWER="${PTAU_POWER:-15}"   # 2^15 = 32768 >= transaction circuit (~27k constraints)
PTAU_URL="${PTAU_URL:-}"
SNARKJS="npx --yes snarkjs"
CIRCOM="${CIRCOM:-circom}"

mkdir -p "$BUILD"
[ -d node_modules/circomlib ] || npm install --no-audit --no-fund --silent

# ---- Phase 1: Powers of Tau (shared) ----
if [ "${REUSE_PTAU:-}" = "1" ] && [ -f "$BUILD/pot_final.ptau" ]; then
  echo "==> [phase1] reusing $BUILD/pot_final.ptau"
elif [ -n "$PTAU_URL" ]; then
  echo "==> [phase1] downloading production ptau: $PTAU_URL"
  curl -L --fail -o "$BUILD/pot_final.ptau" "$PTAU_URL"
else
  echo "==> [phase1] generating local ptau (power $PTAU_POWER) — DEMO ONLY"
  $SNARKJS powersoftau new bn128 "$PTAU_POWER" "$BUILD/pot_0000.ptau" -v
  echo "umbra-ptau-$(date +%s)" | $SNARKJS powersoftau contribute "$BUILD/pot_0000.ptau" "$BUILD/pot_0001.ptau" --name="umbra-1" -v
  $SNARKJS powersoftau prepare phase2 "$BUILD/pot_0001.ptau" "$BUILD/pot_final.ptau" -v
fi

build_circuit () {
  local NAME="$1"
  local CONTRACT="$2"   # path under contracts/src/verifiers (without .sol)
  echo "==> [$NAME] compiling"
  $CIRCOM "$NAME.circom" --r1cs --wasm --sym -l node_modules -o "$BUILD"

  echo "==> [$NAME] groth16 setup + contribution"
  $SNARKJS groth16 setup "$BUILD/$NAME.r1cs" "$BUILD/pot_final.ptau" "$BUILD/${NAME}_0000.zkey"
  echo "umbra-$NAME-$(date +%s)" | $SNARKJS zkey contribute "$BUILD/${NAME}_0000.zkey" "$BUILD/${NAME}_final.zkey" --name="umbra-$NAME" -v
  $SNARKJS zkey export verificationkey "$BUILD/${NAME}_final.zkey" "$BUILD/${NAME}_verification_key.json"

  echo "==> [$NAME] export + adapt Solidity verifier -> $CONTRACT.sol"
  mkdir -p "$ROOT/../contracts/src/verifiers"
  $SNARKJS zkey export solidityverifier "$BUILD/${NAME}_final.zkey" "$BUILD/${NAME}VerifierRaw.sol"
  node scripts/adapt_verifier.js "$BUILD/${NAME}VerifierRaw.sol" "$ROOT/../contracts/src/verifiers/$(basename "$CONTRACT").sol" "$(basename "$CONTRACT")"

  echo "==> [$NAME] publish artifacts -> sdk/artifacts (single source of truth)"
  dest="$ROOT/../sdk/artifacts"
  mkdir -p "$dest"
  cp "$BUILD/${NAME}_js/$NAME.wasm" "$dest/$NAME.wasm"
  cp "$BUILD/${NAME}_final.zkey" "$dest/${NAME}_final.zkey"
  cp "$BUILD/${NAME}_verification_key.json" "$dest/${NAME}_verification_key.json"
}

for spec in ${CIRCUITS:-withdraw:WithdrawVerifier transaction:TransactionVerifier multiasset:MultiAssetVerifier}; do
  build_circuit "${spec%%:*}" "${spec##*:}"
done

echo "==> pinning artifacts + verifiers in sdk/artifacts/MANIFEST.json"
node scripts/manifest.js

echo "==> ZK setup complete. Commit sdk/artifacts AND contracts/src/verifiers together."
