//! # umbra_groth16
//!
//! `no_std` BN254 Groth16 verification for Umbra's WASM coprocessor.
//!
//! Inputs use the **same encoding as the EVM verifier calldata** — 32-byte big-endian words,
//! with G2 coordinates in EVM precompile order `(x.c1, x.c0, y.c1, y.c0)` — so a proof can be
//! forwarded from the EVM to WASM byte-for-byte (fixes audit H-02: the previous version read
//! big-endian words as little-endian and could never verify a real proof).
//!
//! Hardening: every coordinate must be a canonical field element (< p), every point must be
//! on-curve and in the prime-order subgroup (critical for G2), and every public input must be
//! a canonical scalar (< r) — mirroring the checks in the snarkjs Solidity verifier.

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;
use alloc::vec::Vec;

use ark_bn254::{Bn254, Fq, Fq2, Fr, G1Affine, G2Affine};
use ark_ff::{BigInt, PrimeField};
use ark_groth16::{prepare_verifying_key, Groth16, Proof, VerifyingKey};

/// A 32-byte big-endian word, exactly as in EVM calldata.
pub type Word = [u8; 32];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    /// A coordinate or scalar was >= the field modulus.
    NonCanonicalField,
    /// A point is not on the curve.
    NotOnCurve,
    /// A point is on the curve but not in the prime-order subgroup.
    NotInSubgroup,
    /// Verifying-key word layout is malformed.
    BadVerifyingKey,
    /// Number of public inputs does not match the verifying key.
    WrongInputCount,
}

fn limbs_be(w: &Word) -> BigInt<4> {
    let mut limbs = [0u64; 4];
    for i in 0..4 {
        let mut chunk = [0u8; 8];
        chunk.copy_from_slice(&w[i * 8..i * 8 + 8]);
        limbs[3 - i] = u64::from_be_bytes(chunk);
    }
    BigInt::new(limbs)
}

fn fq(w: &Word) -> Result<Fq, Error> {
    Fq::from_bigint(limbs_be(w)).ok_or(Error::NonCanonicalField)
}

/// Public input / scalar: must be canonical (< r).
pub fn fr(w: &Word) -> Result<Fr, Error> {
    Fr::from_bigint(limbs_be(w)).ok_or(Error::NonCanonicalField)
}

fn g1(x: &Word, y: &Word) -> Result<G1Affine, Error> {
    let p = G1Affine::new_unchecked(fq(x)?, fq(y)?);
    if !p.is_on_curve() {
        return Err(Error::NotOnCurve);
    }
    if !p.is_in_correct_subgroup_assuming_on_curve() {
        return Err(Error::NotInSubgroup);
    }
    Ok(p)
}

/// G2 from EVM-ordered words `[x.c1, x.c0, y.c1, y.c0]`.
fn g2(w: &[Word]) -> Result<G2Affine, Error> {
    let x = Fq2::new(fq(&w[1])?, fq(&w[0])?);
    let y = Fq2::new(fq(&w[3])?, fq(&w[2])?);
    let p = G2Affine::new_unchecked(x, y);
    if !p.is_on_curve() {
        return Err(Error::NotOnCurve);
    }
    if !p.is_in_correct_subgroup_assuming_on_curve() {
        return Err(Error::NotInSubgroup);
    }
    Ok(p)
}

/// Verifying key from words:
/// `alpha(2) | beta(4) | gamma(4) | delta(4) | IC_0..IC_n (2 each)` — G2 in EVM order.
pub fn verifying_key(words: &[Word]) -> Result<VerifyingKey<Bn254>, Error> {
    if words.len() < 16 || (words.len() - 14) % 2 != 0 {
        return Err(Error::BadVerifyingKey);
    }
    let mut ic = Vec::with_capacity((words.len() - 14) / 2);
    for pair in words[14..].chunks(2) {
        ic.push(g1(&pair[0], &pair[1])?);
    }
    Ok(VerifyingKey {
        alpha_g1: g1(&words[0], &words[1])?,
        beta_g2: g2(&words[2..6])?,
        gamma_g2: g2(&words[6..10])?,
        delta_g2: g2(&words[10..14])?,
        gamma_abc_g1: ic,
    })
}

/// Verify an EVM-encoded Groth16 proof.
///
/// * `a`, `c`: G1 `(x, y)`; `b`: G2 in EVM order `[x.c1, x.c0, y.c1, y.c0]`
///   (i.e. exactly the `uint256[2]`, `uint256[2][2]` (flattened), `uint256[2]` calldata).
/// * `inputs`: public signals in circuit order.
pub fn verify(vk_words: &[Word], a: &[Word; 2], b: &[Word; 4], c: &[Word; 2], inputs: &[Word]) -> Result<bool, Error> {
    let vk = verifying_key(vk_words)?;
    if inputs.len() + 1 != vk.gamma_abc_g1.len() {
        return Err(Error::WrongInputCount);
    }
    let proof = Proof::<Bn254> { a: g1(&a[0], &a[1])?, b: g2(b)?, c: g1(&c[0], &c[1])? };
    let mut public = Vec::with_capacity(inputs.len());
    for w in inputs {
        public.push(fr(w)?);
    }
    let pvk = prepare_verifying_key(&vk);
    Ok(Groth16::<Bn254>::verify_proof(&pvk, &proof, &public).unwrap_or(false))
}

/// Canonical byte encoding of a proof + inputs (`a | b | c | inputs`), used to key cached
/// results. The contract hashes THIS — never a caller-supplied hash (audit H-02).
pub fn canonical_encoding(a: &[Word; 2], b: &[Word; 4], c: &[Word; 2], inputs: &[Word]) -> Vec<u8> {
    let mut out = Vec::with_capacity(32 * (8 + inputs.len()));
    for w in a.iter().chain(b.iter()).chain(c.iter()).chain(inputs.iter()) {
        out.extend_from_slice(w);
    }
    out
}

#[cfg(test)]
mod tests {
    //! Verifies the SAME real proofs the Solidity verifiers accept (contracts/test/fixtures),
    //! against the committed verifying keys (sdk/artifacts). Run: `cargo test -p umbra_groth16`.
    use super::*;
    use serde_json::Value;
    use std::{fs, path::PathBuf};

    fn root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
    }

    /// Decimal string -> 32-byte big-endian word.
    fn word(dec: &str) -> Word {
        let mut out = [0u8; 32];
        for ch in dec.bytes() {
            let mut carry = (ch - b'0') as u32;
            for byte in out.iter_mut().rev() {
                let v = (*byte as u32) * 10 + carry;
                *byte = (v & 0xff) as u8;
                carry = v >> 8;
            }
            assert_eq!(carry, 0, "overflow");
        }
        out
    }

    fn s(v: &Value) -> &str {
        v.as_str().unwrap()
    }

    /// snarkjs verification_key.json -> EVM-ordered words.
    fn vk_words(path: &str) -> Vec<Word> {
        let vk: Value = serde_json::from_str(&fs::read_to_string(root().join(path)).unwrap()).unwrap();
        let g2 = |k: &str| {
            let p = &vk[k];
            // snarkjs stores [[x.c0, x.c1], [y.c0, y.c1]]; EVM order is x.c1, x.c0, y.c1, y.c0
            vec![word(s(&p[0][1])), word(s(&p[0][0])), word(s(&p[1][1])), word(s(&p[1][0]))]
        };
        let mut w = vec![word(s(&vk["vk_alpha_1"][0])), word(s(&vk["vk_alpha_1"][1]))];
        w.extend(g2("vk_beta_2"));
        w.extend(g2("vk_gamma_2"));
        w.extend(g2("vk_delta_2"));
        for p in vk["IC"].as_array().unwrap() {
            w.push(word(s(&p[0])));
            w.push(word(s(&p[1])));
        }
        w
    }

    fn proof(path: &str) -> ([Word; 2], [Word; 4], [Word; 2], Vec<Word>) {
        let f: Value = serde_json::from_str(&fs::read_to_string(root().join(path)).unwrap()).unwrap();
        let arr = |k: &str| f[k].as_array().unwrap().iter().map(|x| word(s(x))).collect::<Vec<_>>();
        let (a, b, c) = (arr("aFlat"), arr("bFlat"), arr("cFlat"));
        ([a[0], a[1]], [b[0], b[1], b[2], b[3]], [c[0], c[1]], arr("pub"))
    }

    #[test]
    fn verifies_real_withdraw_proof() {
        let vk = vk_words("sdk/artifacts/withdraw_verification_key.json");
        let (a, b, c, inputs) = proof("contracts/test/fixtures/proof.json");
        assert_eq!(verify(&vk, &a, &b, &c, &inputs), Ok(true));
    }

    #[test]
    fn verifies_real_join_split_proof() {
        let vk = vk_words("sdk/artifacts/transaction_verification_key.json");
        let (a, b, c, inputs) = proof("contracts/test/fixtures/tx_proof.json");
        assert_eq!(inputs.len(), 7);
        assert_eq!(verify(&vk, &a, &b, &c, &inputs), Ok(true));
    }

    #[test]
    fn rejects_tampered_public_input() {
        let vk = vk_words("sdk/artifacts/withdraw_verification_key.json");
        let (a, b, c, mut inputs) = proof("contracts/test/fixtures/proof.json");
        inputs[2][31] ^= 1; // flip recipient
        assert_eq!(verify(&vk, &a, &b, &c, &inputs), Ok(false));
    }

    #[test]
    fn rejects_proof_for_wrong_circuit() {
        let vk = vk_words("sdk/artifacts/transaction_verification_key.json");
        let (a, b, c, inputs) = proof("contracts/test/fixtures/proof.json"); // withdraw proof
        assert_eq!(verify(&vk, &a, &b, &c, &inputs), Err(Error::WrongInputCount));
    }

    #[test]
    fn rejects_non_canonical_scalar() {
        let vk = vk_words("sdk/artifacts/withdraw_verification_key.json");
        let (a, b, c, mut inputs) = proof("contracts/test/fixtures/proof.json");
        inputs[0] = [0xff; 32]; // >= r
        assert_eq!(verify(&vk, &a, &b, &c, &inputs), Err(Error::NonCanonicalField));
    }

    #[test]
    fn rejects_point_off_curve() {
        let vk = vk_words("sdk/artifacts/withdraw_verification_key.json");
        let (mut a, b, c, inputs) = proof("contracts/test/fixtures/proof.json");
        a[1][31] ^= 1; // perturb A.y
        assert_eq!(verify(&vk, &a, &b, &c, &inputs), Err(Error::NotOnCurve));
    }

    #[test]
    fn canonical_encoding_layout() {
        let (a, b, c, inputs) = proof("contracts/test/fixtures/proof.json");
        let enc = canonical_encoding(&a, &b, &c, &inputs);
        assert_eq!(enc.len(), 32 * (8 + inputs.len()));
        assert_eq!(&enc[..32], &a[0]);
    }
}
