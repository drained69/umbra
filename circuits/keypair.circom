pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";

// Shielded account keypair for the join-split (UTXO) model.
//   publicKey = Poseidon(privateKey)
// A UTXO is owned by whoever knows the privateKey behind its publicKey.
template Keypair() {
    signal input privateKey;
    signal output publicKey;

    component hasher = Poseidon(1);
    hasher.inputs[0] <== privateKey;
    publicKey <== hasher.out;
}

// Spend authorization signature binding the owner to a specific note + tree position.
//   signature = Poseidon(privateKey, commitment, merklePath)
template Signature() {
    signal input privateKey;
    signal input commitment;
    signal input merklePath;
    signal output out;

    component hasher = Poseidon(3);
    hasher.inputs[0] <== privateKey;
    hasher.inputs[1] <== commitment;
    hasher.inputs[2] <== merklePath;
    out <== hasher.out;
}
