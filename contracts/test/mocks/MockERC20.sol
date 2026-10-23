// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC-20 for tests. `mode` simulates real-world token quirks:
///   0 = standard (returns bool), 1 = no return value (USDT-style), 2 = 1% fee on transfer.
contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint8 public immutable mode;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    constructor(string memory n, string memory s, uint8 d, uint8 m) {
        name = n;
        symbol = s;
        decimals = d;
        mode = m;
    }

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
        totalSupply += amt;
    }

    function approve(address s, uint256 amt) external returns (bool) {
        allowance[msg.sender][s] = amt;
        return true;
    }

    function transfer(address to, uint256 amt) external {
        _move(msg.sender, to, amt);
        _ret();
    }

    function transferFrom(address from, address to, uint256 amt) external {
        uint256 a = allowance[from][msg.sender];
        require(a >= amt, "allowance");
        allowance[from][msg.sender] = a - amt;
        _move(from, to, amt);
        _ret();
    }

    function _move(address from, address to, uint256 amt) private {
        require(balanceOf[from] >= amt, "balance");
        balanceOf[from] -= amt;
        uint256 received = mode == 2 ? amt - amt / 100 : amt;
        balanceOf[to] += received;
        totalSupply -= amt - received;
    }

    function _ret() private view {
        if (mode == 1) return; // no return data
        assembly {
            mstore(0, 1)
            return(0, 32)
        }
    }
}
