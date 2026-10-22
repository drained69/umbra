.PHONY: help install test zk deploy relayer frontend coprocessor clean

help:
	@echo "Umbra — confidential tPOT on Portaldot V3"
	@echo ""
	@echo "  make install      install all JS deps (contracts use foundry)"
	@echo "  make test         compile + run Foundry tests (contracts + real-proof verifier)"
	@echo "  make zk           run the ZK trusted setup -> WithdrawVerifier.sol + proving artifacts"
	@echo "  make deploy       deploy to Portaldot V3 testnet (needs .env)"
	@echo "  make relayer      start the gasless withdrawal relayer"
	@echo "  make frontend     start the dApp (vite dev server)"
	@echo "  make coprocessor  build the ink!/WASM Groth16 coprocessor (needs cargo-contract)"

install:
	cd circuits && npm install
	cd sdk && npm install
	cd scripts && npm install
	cd relayer && npm install
	cd frontend && npm install

test:
	cd contracts && forge test -vv

zk:
	cd circuits && bash scripts/setup.sh && node scripts/prove_example.js

deploy:
	cd contracts && forge build
	cd scripts && npm run deploy

relayer:
	cd relayer && npm start

frontend:
	cd frontend && npm run dev

coprocessor:
	cd coprocessor && cargo contract build --release

clean:
	rm -rf contracts/out contracts/cache circuits/build */node_modules coprocessor/target
