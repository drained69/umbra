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

contract MultiAssetVerifierInner {
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
    uint256 constant deltax1 = 16159682925012722479874579640443857384728224772008130790422267612580263261465;
    uint256 constant deltax2 = 19567846398870203258562393450870949165899237150410187146919460937048382519805;
    uint256 constant deltay1 = 6921915230621027804175018385291192533366630474049756739748659863124378045201;
    uint256 constant deltay2 = 1363961795638218288754561341990788682658106782748618962313752228407915129346;

    
    uint256 constant IC0x = 17500174364656215796251158424452064503696176329420444494449028732749021370889;
    uint256 constant IC0y = 14764804802002382474474332298110036905958942943542365929529914827962306882498;
    
    uint256 constant IC1x = 18298109377314072265830566832063584612413006399339255215396627735775087029804;
    uint256 constant IC1y = 1654336267126970092456454354703278070409226473627608393071042153059473814157;
    
    uint256 constant IC2x = 20495306489405847346178419264267095773531593652788229804722757484885463027739;
    uint256 constant IC2y = 15559156522973295485853880585423790118391098372003746360432234918010663397377;
    
    uint256 constant IC3x = 17220910695250207069809857127872004815735802397531173775451658491126933576935;
    uint256 constant IC3y = 19744162092459699337086134730348110873214770034299021385014346589926815790020;
    
    uint256 constant IC4x = 7211940721565804682042637196510442931944611337293702423929191392658434458504;
    uint256 constant IC4y = 20865073335484498749854619276769954853416255993833430857841260371990045736873;
    
    uint256 constant IC5x = 17260359065136444011136943452102352920538856638164935785128492629785741944608;
    uint256 constant IC5y = 15996308732652420717238550052089600350028159875631268650546945102370850952510;
    
    uint256 constant IC6x = 3999610074217368794707251124206442117523004089831270308292220600697003762628;
    uint256 constant IC6y = 17776422388732508284792248599462485012834345220673888032388111320500219686516;
    
    uint256 constant IC7x = 4039506001403134624053982239398706036619436920709367517228016864810030562760;
    uint256 constant IC7y = 1247662648892645704917117184514900815640910470844628379703973775515794333841;
    
    uint256 constant IC8x = 6477621656660928839647686232293402132147787035017272519265542434839712956896;
    uint256 constant IC8y = 1014162144780735440661513066285671537930730348994666109978729453658401906824;
    
    uint256 constant IC9x = 19842782407577644010934833229629166052259461514349662616918259453532372318080;
    uint256 constant IC9y = 16948510368593229675279015434550454474581624089608995025061228515092225748379;
    
    uint256 constant IC10x = 11424894066044978949447532245768162506462227013580042282329454561805116956507;
    uint256 constant IC10y = 20280291285182695308986232866063706116799695897071656390697206503192992160664;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[10] calldata _pubSignals) public view returns (bool) {
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
                
                g1_mulAccC(_pVk, IC8x, IC8y, calldataload(add(pubSignals, 224)))
                
                g1_mulAccC(_pVk, IC9x, IC9y, calldataload(add(pubSignals, 256)))
                
                g1_mulAccC(_pVk, IC10x, IC10y, calldataload(add(pubSignals, 288)))
                

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
            
            checkField(calldataload(add(_pubSignals, 224)))
            
            checkField(calldataload(add(_pubSignals, 256)))
            
            checkField(calldataload(add(_pubSignals, 288)))
            

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

contract MultiAssetVerifier is IVerifier {
    MultiAssetVerifierInner public immutable inner;

    constructor() {
        inner = new MultiAssetVerifierInner();
    }

    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata publicSignals
    ) external view returns (bool) {
        require(publicSignals.length == 10, "bad pubSignals len");
        uint256[10] memory fixedSignals;
        for (uint256 i = 0; i < 10; i++) {
            fixedSignals[i] = publicSignals[i];
        }
        return inner.verifyProof(a, b, c, fixedSignals);
    }
}
