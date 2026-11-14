// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    uint8 private immutable _dec;

    constructor(uint8 dec) ERC20("Mock", "MOCK") {
        _dec = dec;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Tries to re-enter a callback target while receiving native funds.
contract ReentrantReceiver {
    address public target;
    bytes public payload;
    bool public attempted;
    bool public reentrySucceeded;

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    receive() external payable {
        if (!attempted && target != address(0)) {
            attempted = true;
            (bool ok,) = target.call(payload);
            reentrySucceeded = ok;
        }
    }
}
