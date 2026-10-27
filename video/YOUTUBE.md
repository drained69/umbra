# YouTube upload kit

Upload `out/umbra-landscape-1920x1080.mp4`, then add `out/umbra-landscape-1920x1080.en.srt`
under Subtitles → Upload file → With timing, and `out/umbra-thumbnail-1280x720.png` as the
custom thumbnail.

## Title (pick one, ≤ 70 characters)

- Umbra: private payments on Portaldot, powered by zero-knowledge proofs
- Umbra — pay anyone on Portaldot. Hide everything. (2-min demo)
- Private payments, requests and swaps on Portaldot | Umbra demo

## Description

Umbra is a zero-knowledge privacy layer for Portaldot V3. Pay anyone, request money with a
link and swap tPOT ↔ pUSD from a private balance — your wallet signs only the deposit, and
the chain never sees who paid whom or how much.

▶ Try it: https://umbrav1.up.railway.app
▶ Source: [add your repository link]

How it works
• Groth16 zero-knowledge proofs are generated in your browser (snarkjs) and verified on chain
  using Portaldot's BN254 precompiles.
• Your balance is a set of encrypted notes: Poseidon commitments in an on-chain Merkle tree,
  with nullifiers that stop double spends.
• A relayer submits private payments and swaps, so your wallet never signs them and nothing
  links back to you.
• Payment requests travel as a link or QR code; private payments to a request are matched
  automatically.

Built for the Portaldot Hacker House 2026. Running on the Portaldot V3 testnet with test tokens
that have no monetary value; the contracts have not been independently audited.
All names, addresses and amounts in this video are example data.

Chapters
0:00 Intro
0:19 Connect a wallet
0:30 Private account
0:43 Shield funds
0:58 Send privately
1:14 Pay a request link
1:27 Private swap
1:40 What the chain sees

## Tags

Umbra, Portaldot, Portaldot Hacker House, zero knowledge, zk proofs, Groth16, private payments,
privacy, crypto payments, web3, DeFi, private swap, tPOT, pUSD, hackathon demo
