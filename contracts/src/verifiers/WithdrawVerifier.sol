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

contract UmbraGroth16Verifier {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 12720234310066394703174388779866980078679696914695305482334824130358202206964;
    uint256 constant alphay  = 18288874443273790030693678719470299212966494846709527346372203156959367844534;
    uint256 constant betax1  = 13411796638089819188307687228939008168329529805353052647542589202604810692014;
    uint256 constant betax2  = 6796161067135171772854797839031593118832167558776699974700652835613644927349;
    uint256 constant betay1  = 9560726941089981963559146721557641928328296675952804267645876525115296677317;
    uint256 constant betay2  = 19431864912848027096627834416739769704684084268803303915884538020966379593781;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 2441816552306464373247041527145176086954869007207920393844485185518011669023;
    uint256 constant deltax2 = 14485148297026476661943445512289875314416970319418106086556638428868552384063;
    uint256 constant deltay1 = 12311337673687097922431500783913500255526731027356970619749100483625294143381;
    uint256 constant deltay2 = 3927256860050599149775829625344352441833513724513852846364270319291999679012;

    
    uint256 constant IC0x = 5594300285231602769611157238698132038328705826014617456339212593380580232981;
    uint256 constant IC0y = 2041765648699022815392470914386281982399243044775009665895506911439350391183;
    
    uint256 constant IC1x = 1270938730870379378012821654175581121802329020793091817397777836640793868465;
    uint256 constant IC1y = 10965878140339837559806889916697725026759500782087396894673337165423796942323;
    
    uint256 constant IC2x = 3927723211077121721698748153416073740443170717379712632957024721737954890789;
    uint256 constant IC2y = 18002566313786587041827851364273458377767326137030566056830449077072501837527;
    
    uint256 constant IC3x = 9081619030341797762723357071790817891291758585856520292356137954213858444929;
    uint256 constant IC3y = 19663307927726077832787134006082177860612862049080226520227505340395104537146;
    
    uint256 constant IC4x = 9031193892814316336458276042686400178531474082094988105095731482156111443944;
    uint256 constant IC4y = 17919151729956584566204955241467458357423091924623770989287387319662068653409;
    
    uint256 constant IC5x = 19470983879489064187736730498345619561114086458690428391739804030407011010315;
    uint256 constant IC5y = 9900026481500956328756789844247718772071638120568143125614482052126860769158;
    
    uint256 constant IC6x = 7064479489193822031624179275124353150348331889846804466508399767844125336005;
    uint256 constant IC6y = 6891313686915540094840526092624606815089296636826038801386015272164100228231;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[6] calldata _pubSignals) public view returns (bool) {
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
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }


// ---------------------------------------------------------------------------
// Umbra adapter: exposes the snarkjs verifier through IVerifier so UmbraPool can
// stay VM-agnostic (this on-chain verifier OR the WASM coprocessor bridge).
// Auto-generated by circuits/scripts/adapt_verifier.js — do not edit by hand.
// ---------------------------------------------------------------------------
import {IVerifier} from "../interfaces/IVerifier.sol";

contract WithdrawVerifier is IVerifier {
    UmbraGroth16Verifier public immutable inner;

    constructor() {
        inner = new UmbraGroth16Verifier();
    }

    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata publicSignals
    ) external view returns (bool) {
        require(publicSignals.length == 6, "bad pubSignals len");
        uint256[6] memory fixedSignals;
        for (uint256 i = 0; i < 6; i++) {
            fixedSignals[i] = publicSignals[i];
        }
        return inner.verifyProof(a, b, c, fixedSignals);
    }
}
