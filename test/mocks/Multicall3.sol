// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Minimal Multicall3 (aggregate3 only) so a bare local anvil behaves like Arc, where the canonical
///      Multicall3 lives at 0xcA11bde05977b3631167028862bE2a173976CA11. Test/dev only.
contract Multicall3 {
    struct Call3 {
        address target;
        bool allowFailure;
        bytes callData;
    }

    struct Result {
        bool success;
        bytes returnData;
    }

    function aggregate3(Call3[] calldata calls) external payable returns (Result[] memory returnData) {
        returnData = new Result[](calls.length);
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory data) = calls[i].target.call(calls[i].callData);
            require(ok || calls[i].allowFailure, "Multicall3: call failed");
            returnData[i] = Result(ok, data);
        }
    }
}
