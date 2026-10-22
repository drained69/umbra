#![cfg_attr(not(feature = "std"), no_std, no_main)]

//! # Umbra Coprocessor (ink! / WASM)
//!
//! Runs BN254 Groth16 verification in Portaldot V3's WASM VM (pallet-contracts) so the EVM
//! shielded pools can offload the pairing check — "the right VM for the right job".
//!
//! All verification logic lives in the `umbra_groth16` crate, which is unit-tested natively
//! against the same real proofs the Solidity verifiers accept. Inputs use the EVM calldata
//! encoding (32-byte big-endian words), so proofs pass between VMs unchanged.
//!
//! Security (audit H-02):
//!   * the verified-proof cache is keyed by a hash the CONTRACT computes over the canonical
//!     proof encoding — callers can no longer mark arbitrary hashes as verified;
//!   * the verifying key is fixed per deployment (one contract per circuit) and only the
//!     owner can rotate it, emitting an event.

#[ink::contract]
mod umbra_coprocessor {
    use ink::env::hash::{HashOutput, Keccak256};
    use ink::prelude::vec::Vec;
    use ink::storage::Mapping;
    use umbra_groth16::Word;

    #[ink(storage)]
    pub struct UmbraCoprocessor {
        owner: AccountId,
        /// EVM-ordered verifying-key words (see umbra_groth16::verifying_key).
        vk: Vec<Word>,
        /// keccak256(canonical proof encoding) => verified
        verified: Mapping<[u8; 32], bool>,
        verify_count: u64,
    }

    #[ink(event)]
    pub struct Verified {
        #[ink(topic)]
        proof_hash: [u8; 32],
        result: bool,
    }

    #[ink(event)]
    pub struct VerifyingKeyRotated {
        words: u32,
    }

    #[derive(Debug, PartialEq, Eq, Clone)]
    #[ink::scale_derive(Encode, Decode, TypeInfo)]
    pub enum Error {
        NotOwner,
        BadVerifyingKey,
        NonCanonicalField,
        NotOnCurve,
        NotInSubgroup,
        WrongInputCount,
    }
    pub type Result<T> = core::result::Result<T, Error>;

    impl From<umbra_groth16::Error> for Error {
        fn from(e: umbra_groth16::Error) -> Self {
            match e {
                umbra_groth16::Error::NonCanonicalField => Error::NonCanonicalField,
                umbra_groth16::Error::NotOnCurve => Error::NotOnCurve,
                umbra_groth16::Error::NotInSubgroup => Error::NotInSubgroup,
                umbra_groth16::Error::BadVerifyingKey => Error::BadVerifyingKey,
                umbra_groth16::Error::WrongInputCount => Error::WrongInputCount,
            }
        }
    }

    impl UmbraCoprocessor {
        /// `vk` = output of `node scripts/vk_to_words.js <circuit>` (validated here).
        #[ink(constructor)]
        pub fn new(vk: Vec<Word>) -> Result<Self> {
            umbra_groth16::verifying_key(&vk)?;
            Ok(Self { owner: Self::env().caller(), vk, verified: Mapping::default(), verify_count: 0 })
        }

        fn proof_hash(a: &[Word; 2], b: &[Word; 4], c: &[Word; 2], inputs: &[Word]) -> [u8; 32] {
            let mut out = <Keccak256 as HashOutput>::Type::default();
            ink::env::hash_bytes::<Keccak256>(&umbra_groth16::canonical_encoding(a, b, c, inputs), &mut out);
            out
        }

        /// Verify an EVM-encoded Groth16 proof in WASM and cache the result.
        #[ink(message)]
        pub fn verify(&mut self, a: [Word; 2], b: [Word; 4], c: [Word; 2], inputs: Vec<Word>) -> Result<bool> {
            let ok = umbra_groth16::verify(&self.vk, &a, &b, &c, &inputs)?;
            let h = Self::proof_hash(&a, &b, &c, &inputs);
            if ok {
                self.verified.insert(h, &true);
            }
            self.verify_count = self.verify_count.saturating_add(1);
            self.env().emit_event(Verified { proof_hash: h, result: ok });
            Ok(ok)
        }

        /// Read-only verification (no state change) — what a relayer dry-runs.
        #[ink(message)]
        pub fn check(&self, a: [Word; 2], b: [Word; 4], c: [Word; 2], inputs: Vec<Word>) -> Result<bool> {
            Ok(umbra_groth16::verify(&self.vk, &a, &b, &c, &inputs)?)
        }

        /// Was this exact proof (contract-computed hash) verified before?
        #[ink(message)]
        pub fn is_verified(&self, a: [Word; 2], b: [Word; 4], c: [Word; 2], inputs: Vec<Word>) -> bool {
            self.verified.get(Self::proof_hash(&a, &b, &c, &inputs)).unwrap_or(false)
        }

        #[ink(message)]
        pub fn verify_count(&self) -> u64 {
            self.verify_count
        }

        /// Rotate the verifying key (owner only), e.g. after a ceremony. Emits an event.
        #[ink(message)]
        pub fn set_vk(&mut self, vk: Vec<Word>) -> Result<()> {
            if self.env().caller() != self.owner {
                return Err(Error::NotOwner);
            }
            umbra_groth16::verifying_key(&vk)?;
            let words = vk.len() as u32;
            self.vk = vk;
            self.env().emit_event(VerifyingKeyRotated { words });
            Ok(())
        }
    }
}
