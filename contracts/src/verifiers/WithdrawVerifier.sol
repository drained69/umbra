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

contract WithdrawVerifierInner {
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
    uint256 constant deltax1 = 4512374823084947892630820990658484224616657977128153615118486471460727688807;
    uint256 constant deltax2 = 10849725407093618189527571048053743121860810520426193537159310521819755206219;
    uint256 constant deltay1 = 6625274508588383804843817329715248099729479353932408529889887952243385600152;
    uint256 constant deltay2 = 21751789784672842578570844905675388745545458235618882100658038958176214406596;

    
    uint256 constant IC0x = 2992473606952995894788209557514204772564939421688048493941237971479279463395;
    uint256 constant IC0y = 10843462715206819247345875023086794603809515232755347647461854574126267951039;
    
    uint256 constant IC1x = 6134292914149981625786252005177617313878878647204102968188870890379959039008;
    uint256 constant IC1y = 10667385872808726741611769680100873756762172918221200835536759176512561481005;
    
    uint256 constant IC2x = 7076640694400731394329751332495753702512569351699429750980773732785324937340;
    uint256 constant IC2y = 7253529333976588198991624910740630130874828503852036730365601107458360496636;
    
    uint256 constant IC3x = 12342752499895095000705132204026162643854026092704603979635007700323315220534;
    uint256 constant IC3y = 797865837330752484289050610259993465846367169709623060079286374317439006056;
    
    uint256 constant IC4x = 19433420595151892312212720735701815168175163676522717937131110719274009176565;
    uint256 constant IC4y = 15716472593710339972890252280992932866293476341767345942091028050477683763299;
    
    uint256 constant IC5x = 6018157130405368036165502056706006974666088763405899301679024392008092063173;
    uint256 constant IC5y = 5864272530357744329226241874363871505730953672957728147699026279076148043315;
    
    uint256 constant IC6x = 3294920757496534542119138887297588116714448095925609301679078629892811652083;
    uint256 constant IC6y = 777356656777689729432625836688604921830725140111619511416806586403718804682;
    
 
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
// Umbra adapter: exposes the snarkjs verifier through IVerifier so the pools can
// stay VM-agnostic (this on-chain verifier OR the WASM coprocessor bridge).
// Auto-generated by circuits/scripts/adapt_verifier.js — do not edit by hand.
// ---------------------------------------------------------------------------
import {IVerifier} from "../interfaces/IVerifier.sol";

contract WithdrawVerifier is IVerifier {
    WithdrawVerifierInner public immutable inner;

    constructor() {
        inner = new WithdrawVerifierInner();
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
