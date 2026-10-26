pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "./keypair.circom";
include "./merkleProof.circom";

// ---------------------------------------------------------------------------
// Umbra multi-asset join-split circuit (2-in / 2-out) with an atomic swap leg.
//
// Same model as transaction.circom, but every note carries an asset id, so one
// shielded pool holds tPOT and pUSD side by side:
//
//   UTXO commitment = Poseidon(amount, publicKey, blinding, asset)
//   publicKey       = Poseidon(privateKey)
//   signature       = Poseidon(privateKey, commitment, pathIndices)
//   nullifier       = Poseidon(commitment, pathIndices, signature)
//
// A transaction acts on one asset, `publicAsset`: every non-zero input and output 0 are
// that asset, and value is conserved with the signed `publicAmount` (deposit / withdraw /
// transfer, as before).
//
// A swap (swapAmount != 0) additionally creates output 1 as `swapAmount` of `swapAsset`.
// That value is not taken from the inputs: the pool contract only accepts the proof if
// the counterparty delivers exactly `swapAmount` of `swapAsset` in the same call, while
// it pays out -publicAmount of `publicAsset`. So the trader's notes buy a new note of the
// other asset without the trader appearing on chain.
//
//   no swap:  sum(inAmounts) + publicAmount == out0 + out1   (all publicAsset)
//   swap:     sum(inAmounts) + publicAmount == out0          (publicAsset)
//             out1 == swapAmount, asset(out1) == swapAsset
//
// Public signals (order fixed; MUST match UmbraMultiAssetPool):
//   [root, publicAmount, extDataHash, publicAsset, swapAsset, swapAmount,
//    inputNullifier[2], outputCommitment[2]]
// ---------------------------------------------------------------------------

template MultiAssetTransaction(levels, nIns, nOuts) {
    signal input root;
    signal input publicAmount;   // field-encoded signed delta of publicAsset
    signal input extDataHash;    // binds recipient/relayer/fee/encryptedOutputs
    signal input publicAsset;
    signal input swapAsset;
    signal input swapAmount;     // 0 for a plain transaction

    signal input inputNullifier[nIns];
    signal input inAmount[nIns];
    signal input inAsset[nIns];
    signal input inPrivateKey[nIns];
    signal input inBlinding[nIns];
    signal input inPathIndices[nIns];
    signal input inPathElements[nIns][levels];

    signal input outputCommitment[nOuts];
    signal input outAmount[nOuts];
    signal input outAsset[nOuts];
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

        inCommitmentHasher[tx] = Poseidon(4);
        inCommitmentHasher[tx].inputs[0] <== inAmount[tx];
        inCommitmentHasher[tx].inputs[1] <== inKeypair[tx].publicKey;
        inCommitmentHasher[tx].inputs[2] <== inBlinding[tx];
        inCommitmentHasher[tx].inputs[3] <== inAsset[tx];

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

        // a real input must be the transaction's asset
        (inAsset[tx] - publicAsset) * inAmount[tx] === 0;

        sumIns += inAmount[tx];
    }

    component outCommitmentHasher[nOuts];
    component outAmountCheck[nOuts];
    for (var tx = 0; tx < nOuts; tx++) {
        outCommitmentHasher[tx] = Poseidon(4);
        outCommitmentHasher[tx].inputs[0] <== outAmount[tx];
        outCommitmentHasher[tx].inputs[1] <== outPubkey[tx];
        outCommitmentHasher[tx].inputs[2] <== outBlinding[tx];
        outCommitmentHasher[tx].inputs[3] <== outAsset[tx];
        outCommitmentHasher[tx].out === outputCommitment[tx];

        // amounts must fit in 248 bits so sums can't overflow the field
        outAmountCheck[tx] = Num2Bits(248);
        outAmountCheck[tx].in <== outAmount[tx];
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

    // output 0 is always the transaction's asset
    outAsset[0] === publicAsset;

    component noSwap = IsZero();
    noSwap.in <== swapAmount;
    signal isSwap;
    isSwap <== 1 - noSwap.out;

    // output 1: the transaction's asset normally, the bought asset in a swap
    signal assetIfSwap;
    assetIfSwap <== isSwap * (swapAsset - publicAsset);
    outAsset[1] === publicAsset + assetIfSwap;
    isSwap * (outAmount[1] - swapAmount) === 0;

    // value conservation of publicAsset (output 1 counts only when it is not the swap leg)
    signal out1SameAsset;
    out1SameAsset <== noSwap.out * outAmount[1];
    sumIns + publicAmount === outAmount[0] + out1SameAsset;

    // bind extDataHash into the constraint system (anti-tamper)
    signal extDataSquare;
    extDataSquare <== extDataHash * extDataHash;
}

component main {public [root, publicAmount, extDataHash, publicAsset, swapAsset, swapAmount, inputNullifier, outputCommitment]} = MultiAssetTransaction(20, 2, 2);
