#!/usr/bin/env bash
# Umbra ZK trusted setup: compile withdraw.circom, run Groth16 setup, export the
# on-chain Verifier.sol + the proving artifacts (wasm + zkey) the SDK/frontend use.
#
# Local fresh Powers-of-Tau (power 14) is generated for a reproducible demo. For a
# production deployment, replace phase-1 with a real community ceremony ptau.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
BUILD="$ROOT/build"
PTAU_POWER="${PTAU_POWER:-14}"
SNARKJS="npx --yes snarkjs"
CIRCOM="${CIRCOM:-circom}"

mkdir -p "$BUILD"

echo "==> [0/6] ensuring node deps (circomlib)"
[ -d node_modules/circomlib ] || npm install --no-audit --no-fund --silent

echo "==> [1/6] compiling withdraw.circom"
$CIRCOM withdraw.circom --r1cs --wasm --sym -l node_modules -o "$BUILD"

echo "==> [2/6] powers of tau (phase 1, power $PTAU_POWER)"
$SNARKJS powersoftau new bn128 "$PTAU_POWER" "$BUILD/pot_0000.ptau" -v
echo "umbra-portaldot-$(date +%s)" | $SNARKJS powersoftau contribute "$BUILD/pot_0000.ptau" "$BUILD/pot_0001.ptau" --name="umbra-1" -v

echo "==> [3/6] prepare phase 2"
$SNARKJS powersoftau prepare phase2 "$BUILD/pot_0001.ptau" "$BUILD/pot_final.ptau" -v

echo "==> [4/6] groth16 setup + contribution"
$SNARKJS groth16 setup "$BUILD/withdraw.r1cs" "$BUILD/pot_final.ptau" "$BUILD/withdraw_0000.zkey"
echo "umbra-phase2-$(date +%s)" | $SNARKJS zkey contribute "$BUILD/withdraw_0000.zkey" "$BUILD/withdraw_final.zkey" --name="umbra-p2-1" -v
$SNARKJS zkey export verificationkey "$BUILD/withdraw_final.zkey" "$BUILD/verification_key.json"

echo "==> [5/6] export Solidity verifier"
mkdir -p "$ROOT/../contracts/src/verifiers"
$SNARKJS zkey export solidityverifier "$BUILD/withdraw_final.zkey" "$BUILD/WithdrawVerifierRaw.sol"
# Adapt the snarkjs export to our IVerifier interface (uint[] publicSignals).
node scripts/adapt_verifier.js "$BUILD/WithdrawVerifierRaw.sol" "$ROOT/../contracts/src/verifiers/WithdrawVerifier.sol"

echo "==> [6/6] publish proving artifacts to sdk + frontend"
for dest in "$ROOT/../sdk/artifacts" "$ROOT/../frontend/public/zk"; do
  mkdir -p "$dest"
  cp "$BUILD/withdraw_js/withdraw.wasm" "$dest/withdraw.wasm"
  cp "$BUILD/withdraw_final.zkey" "$dest/withdraw_final.zkey"
  cp "$BUILD/verification_key.json" "$dest/verification_key.json"
done

echo "==> ZK setup complete."
echo "    Verifier:  contracts/src/verifiers/WithdrawVerifier.sol"
echo "    Artifacts: sdk/artifacts/ and frontend/public/zk/"
