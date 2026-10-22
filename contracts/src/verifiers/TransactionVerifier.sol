// SPDX-License-Identifier: GPL-3.0
/*
    Copyright 2021 0KIMS association.

    This file is generated with [snarkJS](https://github.com/iden3/snarkjs).

    snarkJS is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    snarkJS is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with snarkJS. If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity >=0.7.0 <0.9.0;

contract TransactionVerifierInner {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 21866377696916832754690483304557354767505064407190776930178293779190536807919;
    uint256 constant alphay  = 11041688945590226940397016298271559343384663475375679232784368720881599662772;
    uint256 constant betax1  = 14858453637018377520403374369761033190747880890599737933526054911847011417179;
    uint256 constant betax2  = 11938262774250005336877305503027746887430680672478857651320523276634594616997;
    uint256 constant betay1  = 10220527445549148552425334078001195963523626542165104508824914796621726705723;
    uint256 constant betay2  = 11711728319528035628172399967866414698204279215592642806535223287743402382517;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 21271731996924608221669250146908255424682385666991526447633208641809781003503;
    uint256 constant deltax2 = 8645922864207913726190241816932673923075348259677552490996277127341022175493;
    uint256 constant deltay1 = 17041985216657073766294967415339328530459641462175334468149690616082764761831;
    uint256 constant deltay2 = 9729894354160587357643204141653488562971422838103638362567445894872601434147;

    
    uint256 constant IC0x = 13698495520457336048059142126746223491804908853442432427214710806089212027365;
    uint256 constant IC0y = 11607393859154240087591556627353727289305897138544548739470246235922373991905;
    
    uint256 constant IC1x = 329620434708696766672968776182634517292388671407869266309531358383404517337;
    uint256 constant IC1y = 4500675461171527476796555142827028965505470399798364551352459957953594612993;
    
    uint256 constant IC2x = 8335365504291094749158109547315404192039806661727604286635219854573154361527;
    uint256 constant IC2y = 17991161913855668154305933625823978381408196123040243167444249022111779770391;
    
    uint256 constant IC3x = 2819147195264370369215470376130266294421756840088696812308250958984649530123;
    uint256 constant IC3y = 11331652648474919673617779703605620727410730419185574329932859830737586083162;
    
    uint256 constant IC4x = 19405519897456137236324830307661586344023931350527850432778350971783746269372;
    uint256 constant IC4y = 5873924434562073362744308802173857529757750402888364032308026416321575273117;
    
    uint256 constant IC5x = 13698772230431717878511880655200807054683760586086325635144476913068525801637;
    uint256 constant IC5y = 5089003831971861516512533862705583056664369558329455323330597697930821519312;
    
    uint256 constant IC6x = 15158699908346608138408935005115908120287419745792003556081236729626154190316;
    uint256 constant IC6y = 931008100904418912561045994605533341425968716614119976244225752576124039522;
    
    uint256 constant IC7x = 19025176610625063823681886967829698133678578604575571723578717381772650352882;
    uint256 constant IC7y = 19526875249084581114433386691349166871699115032236989297114932353943747328163;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[7] calldata _pubSignals) public view returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }
            
            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x
                
                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))
                
                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))
                
                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))
                
                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))
                
                g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))
                
                g1_mulAccC(_pVk, IC6x, IC6y, calldataload(add(pubSignals, 160)))
                
                g1_mulAccC(_pVk, IC7x, IC7y, calldataload(add(pubSignals, 192)))
                

                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))


                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)


                let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F
            
            checkField(calldataload(add(_pubSignals, 0)))
            
            checkField(calldataload(add(_pubSignals, 32)))
            
            checkField(calldataload(add(_pubSignals, 64)))
            
            checkField(calldataload(add(_pubSignals, 96)))
            
            checkField(calldataload(add(_pubSignals, 128)))
            
            checkField(calldataload(add(_pubSignals, 160)))
            
            checkField(calldataload(add(_pubSignals, 192)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }


// ---------------------------------------------------------------------------
// Umbra adapter: exposes the snarkjs verifier through IVerifier so the pools can
// stay VM-agnostic (this on-chain verifier OR the WASM coprocessor bridge).
// Auto-generated by circuits/scripts/adapt_verifier.js — do not edit by hand.
// ---------------------------------------------------------------------------
import {IVerifier} from "../interfaces/IVerifier.sol";

contract TransactionVerifier is IVerifier {
    TransactionVerifierInner public immutable inner;

    constructor() {
        inner = new TransactionVerifierInner();
    }

    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata publicSignals
    ) external view returns (bool) {
        require(publicSignals.length == 7, "bad pubSignals len");
        uint256[7] memory fixedSignals;
        for (uint256 i = 0; i < 7; i++) {
            fixedSignals[i] = publicSignals[i];
        }
        return inner.verifyProof(a, b, c, fixedSignals);
    }
}
