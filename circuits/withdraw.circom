pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";

// ---------------------------------------------------------------------------
// Umbra withdraw circuit (fixed-denomination shielded pool).
//
// Proves, in zero knowledge, that the prover knows the opening (nullifier, secret)
// of a commitment that is a leaf in the Merkle tree with the given `root`, and
// derives a deterministic `nullifierHash` — WITHOUT revealing which leaf.
//
// Hash: Poseidon(2), identical to the on-chain IHasher (PoseidonT3) and the SDK
// (poseidon-lite), so roots computed in all three places agree.
//
//   commitment    = Poseidon(nullifier, secret)
//   nullifierHash = Poseidon(nullifier, 0)
//
// Public signals (MUST match UmbraPool.withdraw publicSignals order):
//   [root, nullifierHash, recipient, relayer, fee, refund]
//
// recipient/relayer/fee/refund are bound into the proof via dummy quadratic
// constraints so a relayer cannot tamper with the withdrawal parameters.
// ---------------------------------------------------------------------------

// One Merkle level: given current hash + sibling + direction bit, output parent.
template MerkleLevel() {
    signal input hash;
    signal input sibling;
    signal input isRight;   // 0 => current is left child, 1 => current is right child
    signal output parent;

    // Select ordering without branching.
    signal left;
    signal right;
    // if isRight==0: left=hash, right=sibling ; else swapped
    left  <== hash + isRight * (sibling - hash);
    right <== sibling + isRight * (hash - sibling);

    component h = Poseidon(2);
    h.inputs[0] <== left;
    h.inputs[1] <== right;
    parent <== h.out;
}

template MerkleProof(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels]; // each 0/1
    signal output root;

    component levelsHash[levels];
    signal cur[levels + 1];
    cur[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        // enforce pathIndices are boolean
        pathIndices[i] * (pathIndices[i] - 1) === 0;
        levelsHash[i] = MerkleLevel();
        levelsHash[i].hash <== cur[i];
        levelsHash[i].sibling <== pathElements[i];
        levelsHash[i].isRight <== pathIndices[i];
        cur[i + 1] <== levelsHash[i].parent;
    }
    root <== cur[levels];
}

template Withdraw(levels) {
    // public
    signal input root;
    signal input nullifierHash;
    signal input recipient;
    signal input relayer;
    signal input fee;
    signal input refund;

    // private
    signal input nullifier;
    signal input secret;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // commitment = Poseidon(nullifier, secret)
    component cmt = Poseidon(2);
    cmt.inputs[0] <== nullifier;
    cmt.inputs[1] <== secret;

    // nullifierHash = Poseidon(nullifier, 0)
    component nh = Poseidon(2);
    nh.inputs[0] <== nullifier;
    nh.inputs[1] <== 0;
    nh.out === nullifierHash;

    // membership
    component mp = MerkleProof(levels);
    mp.leaf <== cmt.out;
    for (var i = 0; i < levels; i++) {
        mp.pathElements[i] <== pathElements[i];
        mp.pathIndices[i] <== pathIndices[i];
    }
    mp.root === root;

    // Bind withdrawal params into the proof (anti-tamper). No-op arithmetic,
    // but forces these public signals to be part of the constraint system.
    signal recipientSq;
    signal relayerSq;
    signal feeSq;
    signal refundSq;
    recipientSq <== recipient * recipient;
    relayerSq   <== relayer * relayer;
    feeSq       <== fee * fee;
    refundSq    <== refund * refund;
}

component main {public [root, nullifierHash, recipient, relayer, fee, refund]} = Withdraw(20);
