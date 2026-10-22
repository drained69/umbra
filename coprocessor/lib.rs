#![cfg_attr(not(feature = "std"), no_std, no_main)]

//! # Umbra Coprocessor (ink! / WASM)
//!
//! A Groth16 (BN254) verifier that runs in Portaldot V3's **WASM** VM (pallet-contracts).
//! It exists so the Umbra shielded pool — which lives in the **EVM** VM — can offload the
//! expensive pairing check to the VM that does it cheaply, on the **same chain**.
//!
//! This is the literal "right VM for the right job" argument for Portaldot V3:
//!   * EVM holds the assets (familiar ERC-style accounting, MetaMask UX).
//!   * WASM does the cryptography (arkworks, no EVM gas-loop ceiling).
//!
//! ## How the EVM reaches it
//! Two paths (see docs/CROSS_VM.md), both leaving the pool's `IVerifier` interface intact:
//!   1. A chain-extension / precompile that lets the EVM `staticcall` into here.
//!   2. (testnet) A relayer calls `verify` here over the Substrate RPC, then mirrors the
//!      boolean onto the EVM via `UmbraCoprocessorBridge.attest(proofHash)`.
//!
//! The verification key is set once at construction (the key exported by the trusted
//! setup, `circuits/build/verification_key.json`, serialized with ark-serialize).

#[ink::contract]
mod umbra_coprocessor {
    use ink::prelude::vec::Vec;
    use ink::storage::Mapping;

    use ark_bn254::{Bn254, Fr};
    use ark_ff::PrimeField;
    use ark_groth16::{Groth16, Proof, VerifyingKey};
    use ark_serialize::CanonicalDeserialize;

    /// A verified-proof cache so repeated queries are cheap and the EVM bridge can read
    /// results by proof hash.
    #[ink(storage)]
    pub struct UmbraCoprocessor {
        owner: AccountId,
        /// ark-serialized Groth16 VerifyingKey for the withdraw circuit.
        vk_bytes: Vec<u8>,
        /// proofHash (keccak of the EVM-encoded proof+signals) => verified?
        verified: Mapping<[u8; 32], bool>,
        verify_count: u64,
    }

    #[ink(event)]
    pub struct Verified {
        #[ink(topic)]
        proof_hash: [u8; 32],
        result: bool,
    }

    #[derive(Debug, PartialEq, Eq, Clone)]
    #[ink::scale_derive(Encode, Decode, TypeInfo)]
    pub enum Error {
        NotOwner,
        DeserializeFailed,
        BadPublicInputCount,
    }
    pub type Result<T> = core::result::Result<T, Error>;

    impl UmbraCoprocessor {
        /// `vk_bytes` = ark-serialized VerifyingKey<Bn254> for the withdraw circuit.
        #[ink(constructor)]
        pub fn new(vk_bytes: Vec<u8>) -> Self {
            Self {
                owner: Self::env().caller(),
                vk_bytes,
                verified: Mapping::default(),
                verify_count: 0,
            }
        }

        /// Verify a Groth16 proof in WASM.
        ///
        /// * `proof_bytes`     — ark-serialized `Proof<Bn254>` (a, b, c).
        /// * `public_inputs`   — the 6 public signals as little-endian 32-byte words,
        ///                       in the pool's order: [root, nullifierHash, recipient,
        ///                       relayer, fee, refund].
        /// * `proof_hash`      — keccak256(abi.encode(a,b,c,publicSignals)) from the EVM
        ///                       side, so the result can be mirrored by hash.
        ///
        /// Returns true iff the proof is valid; caches the result.
        #[ink(message)]
        pub fn verify(
            &mut self,
            proof_bytes: Vec<u8>,
            public_inputs: Vec<[u8; 32]>,
            proof_hash: [u8; 32],
        ) -> Result<bool> {
            if public_inputs.len() != 6 {
                return Err(Error::BadPublicInputCount);
            }

            let vk = VerifyingKey::<Bn254>::deserialize_compressed(&self.vk_bytes[..])
                .map_err(|_| Error::DeserializeFailed)?;
            let proof = Proof::<Bn254>::deserialize_compressed(&proof_bytes[..])
                .map_err(|_| Error::DeserializeFailed)?;

            let mut inputs = Vec::with_capacity(6);
            for word in &public_inputs {
                // public signals are field elements < r; interpret as little-endian.
                inputs.push(Fr::from_le_bytes_mod_order(word));
            }

            let pvk = Groth16::<Bn254>::process_vk(&vk).map_err(|_| Error::DeserializeFailed)?;
            let ok = Groth16::<Bn254>::verify_with_processed_vk(&pvk, &inputs, &proof)
                .unwrap_or(false);

            self.verified.insert(proof_hash, &ok);
            self.verify_count = self.verify_count.saturating_add(1);
            self.env().emit_event(Verified { proof_hash, result: ok });
            Ok(ok)
        }

        /// Read a cached verification result (used by the bridge/relayer).
        #[ink(message)]
        pub fn is_verified(&self, proof_hash: [u8; 32]) -> bool {
            self.verified.get(proof_hash).unwrap_or(false)
        }

        #[ink(message)]
        pub fn verify_count(&self) -> u64 {
            self.verify_count
        }

        /// Rotate the verification key (owner only) — e.g. after a new trusted setup.
        #[ink(message)]
        pub fn set_vk(&mut self, vk_bytes: Vec<u8>) -> Result<()> {
            if self.env().caller() != self.owner {
                return Err(Error::NotOwner);
            }
            self.vk_bytes = vk_bytes;
            Ok(())
        }
    }
}
