// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title AuditAnchor
/// @notice Anchors hashes (approval evidence, encrypted-document commitments, decision records) so they can
///         be verified later without putting any readable content on chain.
contract AuditAnchor is Ownable2Step {
    mapping(address => bool) public anchorers;
    /// key = keccak256(orgRef, kind, contentHash) => block number of first anchoring
    mapping(bytes32 => uint64) public anchoredAt;

    event Anchored(bytes32 indexed orgRef, bytes32 indexed kind, bytes32 indexed contentHash, bytes32 metaHash, address by);
    event AnchorerSet(address indexed anchorer, bool enabled);

    error NotAnchorer();
    error AlreadyAnchored();
    error EmptyHash();

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setAnchorer(address anchorer, bool enabled) external onlyOwner {
        anchorers[anchorer] = enabled;
        emit AnchorerSet(anchorer, enabled);
    }

    function anchor(bytes32 orgRef, bytes32 kind, bytes32 contentHash, bytes32 metaHash) external {
        if (!anchorers[msg.sender]) revert NotAnchorer();
        if (contentHash == bytes32(0)) revert EmptyHash();
        bytes32 key = keyOf(orgRef, kind, contentHash);
        if (anchoredAt[key] != 0) revert AlreadyAnchored();
        anchoredAt[key] = uint64(block.number);
        emit Anchored(orgRef, kind, contentHash, metaHash, msg.sender);
    }

    function isAnchored(bytes32 orgRef, bytes32 kind, bytes32 contentHash) external view returns (bool) {
        return anchoredAt[keyOf(orgRef, kind, contentHash)] != 0;
    }

    function keyOf(bytes32 orgRef, bytes32 kind, bytes32 contentHash) public pure returns (bytes32) {
        return keccak256(abi.encode(orgRef, kind, contentHash));
    }
}
