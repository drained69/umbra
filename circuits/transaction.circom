pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "./keypair.circom";
include "./merkleProof.circom";

// ---------------------------------------------------------------------------
// Umbra join-split transaction circuit (2-in / 2-out), tornado-nova style.
//
// This is the SHARED ENGINE behind arbitrary-value private transfers. A single
// transaction can simultaneously:
//   * deposit   (publicAmount > 0, msg.value in)
//   * withdraw  (publicAmount < 0, paid out to recipient)
//   * transfer  (publicAmount == 0, value moves between shielded owners)
// by consuming up to 2 input UTXOs and creating 2 output UTXOs, hiding amounts,
// owners, and the input/output links.
//
//   UTXO commitment = Poseidon(amount, publicKey, blinding)
//   publicKey       = Poseidon(privateKey)
//   signature       = Poseidon(privateKey, commitment, pathIndices)
//   nullifier       = Poseidon(commitment, pathIndices, signature)
//
// Invariant enforced in-circuit:  sum(inAmounts) + publicAmount == sum(outAmounts)
//
// Public signals (order fixed; MUST match UmbraShieldedPool):
//   [root, publicAmount, extDataHash, inputNullifier[2], outputCommitment[2]]
// ---------------------------------------------------------------------------

template Transaction(levels, nIns, nOuts) {
    signal input root;
    signal input publicAmount;   // field-encoded signed delta (see pool.calculatePublicAmount)
    signal input extDataHash;    // binds recipient/relayer/fee/encryptedOutputs

    // inputs
    signal input inputNullifier[nIns];
    signal input inAmount[nIns];
    signal input inPrivateKey[nIns];
    signal input inBlinding[nIns];
    signal input inPathIndices[nIns];
    signal input inPathElements[nIns][levels];

    // outputs
    signal input outputCommitment[nOuts];
    signal input outAmount[nOuts];
    signal input outPubkey[nOuts];
    signal input outBlinding[nOuts];

    component inKeypair[nIns];
    component inSignature[nIns];
    component inCommitmentHasher[nIns];
    component inNullifierHasher[nIns];
    component inTree[nIns];
    component inCheckRoot[nIns];

    var sumIns = 0;
    for (var tx = 0; tx < nIns; tx++) {
        inKeypair[tx] = Keypair();
        inKeypair[tx].privateKey <== inPrivateKey[tx];

        inCommitmentHasher[tx] = Poseidon(3);
        inCommitmentHasher[tx].inputs[0] <== inAmount[tx];
        inCommitmentHasher[tx].inputs[1] <== inKeypair[tx].publicKey;
        inCommitmentHasher[tx].inputs[2] <== inBlinding[tx];

        inSignature[tx] = Signature();
        inSignature[tx].privateKey <== inPrivateKey[tx];
        inSignature[tx].commitment <== inCommitmentHasher[tx].out;
        inSignature[tx].merklePath <== inPathIndices[tx];

        inNullifierHasher[tx] = Poseidon(3);
        inNullifierHasher[tx].inputs[0] <== inCommitmentHasher[tx].out;
        inNullifierHasher[tx].inputs[1] <== inPathIndices[tx];
        inNullifierHasher[tx].inputs[2] <== inSignature[tx].out;
        inNullifierHasher[tx].out === inputNullifier[tx];

        inTree[tx] = MerkleProof(levels);
        inTree[tx].leaf <== inCommitmentHasher[tx].out;
        inTree[tx].pathIndices <== inPathIndices[tx];
        for (var i = 0; i < levels; i++) {
            inTree[tx].pathElements[i] <== inPathElements[tx][i];
        }

        // enforce membership only for non-zero inputs (zero-value inputs are "dummy")
        inCheckRoot[tx] = ForceEqualIfEnabled();
        inCheckRoot[tx].in[0] <== root;
        inCheckRoot[tx].in[1] <== inTree[tx].root;
        inCheckRoot[tx].enabled <== inAmount[tx];

        sumIns += inAmount[tx];
    }

    component outCommitmentHasher[nOuts];
    component outAmountCheck[nOuts];
    var sumOuts = 0;
    for (var tx = 0; tx < nOuts; tx++) {
        outCommitmentHasher[tx] = Poseidon(3);
        outCommitmentHasher[tx].inputs[0] <== outAmount[tx];
        outCommitmentHasher[tx].inputs[1] <== outPubkey[tx];
        outCommitmentHasher[tx].inputs[2] <== outBlinding[tx];
        outCommitmentHasher[tx].out === outputCommitment[tx];

        // amounts must fit in 248 bits so sums can't overflow the field
        outAmountCheck[tx] = Num2Bits(248);
        outAmountCheck[tx].in <== outAmount[tx];

        sumOuts += outAmount[tx];
    }

    // no duplicate input nullifiers within a single transaction
    component sameNullifiers[nIns * (nIns - 1) / 2];
    var idx = 0;
    for (var i = 0; i < nIns - 1; i++) {
        for (var j = i + 1; j < nIns; j++) {
            sameNullifiers[idx] = IsEqual();
            sameNullifiers[idx].in[0] <== inputNullifier[i];
            sameNullifiers[idx].in[1] <== inputNullifier[j];
            sameNullifiers[idx].out === 0;
            idx++;
        }
    }

    // value conservation
    sumIns + publicAmount === sumOuts;

    // bind extDataHash into the constraint system (anti-tamper)
    signal extDataSquare;
    extDataSquare <== extDataHash * extDataHash;
}

component main {public [root, publicAmount, extDataHash, inputNullifier, outputCommitment]} = Transaction(20, 2, 2);
