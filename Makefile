.PHONY: help install test check e2e live zk preflight estimate measure deploy relayer frontend coprocessor coprocessor-test clean

FORGE_STD_VERSION := v1.17.0

help:
	@echo "Umbra — confidential tPOT on Portaldot V3"
	@echo ""
	@echo "  make install           install all deps (forge-std pinned, npm ci everywhere)"
	@echo "  make test              Foundry unit + regression tests (incl. real-proof verifiers)"
	@echo "  make coprocessor-test  Rust: WASM coprocessor verifies the same real proofs"
	@echo "  make check             fast gate: tests + artifact pins + SDK typecheck + frontend build"
	@echo "  make e2e               full end-to-end on local Anvil (real deploy + SDK + relayer)"
	@echo "  make zk                re-run trusted setup -> verifiers + keys + fixtures + MANIFEST"
	@echo "  make preflight         verify the target network can run Umbra (read-only)"
	@echo "  make live              live Portaldot integration checks (native accounts, assets; read-only)"
	@echo "  make estimate          exact deploy cost on the target network (read-only dry-run)"
	@echo "  make measure           per-operation storage/fee costs on the target network (read-only)"
	@echo "  make deploy            deploy (NETWORK=testnet by default; needs .env)"
	@echo "  make relayer           start the gasless withdrawal relayer"
	@echo "  make frontend          start the dApp (vite dev server)"
	@echo "  make coprocessor       build the deployable ink! contract (needs cargo-contract)"

install:
	cd contracts && forge install foundry-rs/forge-std@$(FORGE_STD_VERSION) --no-git
	cd circuits && npm ci
	cd sdk && npm ci
	cd scripts && npm ci
	cd relayer && npm ci --omit=optional
	cd frontend && npm ci

test:
	cd contracts && forge test -vv

coprocessor-test:
	cd coprocessor && cargo test -p umbra_groth16
	cd coprocessor && cargo build -p umbra_groth16 --no-default-features --target wasm32-unknown-unknown --release

check: test
	node circuits/scripts/manifest.js --check
	cd sdk && npx tsc --noEmit
	cd frontend && npm run build

e2e:
	bash scripts/e2e.sh

zk:
	cd circuits && bash scripts/setup.sh && node scripts/prove_example.js && node scripts/prove_transaction.js

preflight:
	cd scripts && npm run preflight

live:
	cd sdk && npx --yes tsx@4.19.1 test/portaldot_live.ts
	cd sdk && npx --yes tsx@4.19.1 test/crossvm_live.ts
	cd sdk && npx --yes tsx@4.19.1 test/payments_swap_live.ts
	cd sdk && npx --yes tsx@4.19.1 test/native_logs_live.ts
	cd sdk && npx --yes tsx@4.19.1 test/multiasset_live.ts

estimate:
	cd contracts && forge build
	cd scripts && node estimate-deploy.js

measure:
	cd contracts && forge build
	cd scripts && node measure-costs.js

deploy: preflight
	cd contracts && forge build
	cd scripts && npm run deploy

relayer:
	cd relayer && npm start

frontend:
	cd frontend && npm run dev

# cargo-contract 5.0.3 needs a toolchain that predates the immediate-abort panic strategy.
INK_TOOLCHAIN := 1.86.0

coprocessor:
	cd coprocessor/contract && cargo +$(INK_TOOLCHAIN) contract build --release
	cd scripts && node export-coprocessor.js

clean:
	rm -rf contracts/out contracts/cache circuits/build coprocessor/target frontend/dist frontend/public/zk
