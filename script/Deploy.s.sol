// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StubEscrow} from "../contracts/StubEscrow.sol";

/// Deploy:   arc-forge script script/Deploy.s.sol --rpc-url arc_testnet --account deployer --broadcast
/// Reads:    USDC_ADDRESS, OWNER_ADDRESS, FEE_RECIPIENT_ADDRESS, PROTOCOL_FEE_BPS from .env
contract Deploy is Script {
    function run() external returns (StubEscrow gate) {
        address usdc = vm.envAddress("USDC_ADDRESS");
        address owner = vm.envAddress("OWNER_ADDRESS");
        address feeTo = vm.envAddress("FEE_RECIPIENT_ADDRESS");
        uint16 feeBps = uint16(vm.envUint("PROTOCOL_FEE_BPS"));

        require(usdc.code.length > 0, "USDC_ADDRESS has no code on this chain");

        vm.startBroadcast();
        gate = new StubEscrow(IERC20(usdc), owner, feeTo, feeBps);
        vm.stopBroadcast();

        console2.log("StubEscrow deployed at:", address(gate));
        console2.log("chainId:", block.chainid);
    }
}

/// Register the Pitch Brief service. Run from the MERCHANT wallet.
/// arc-forge script script/Deploy.s.sol:RegisterService --rpc-url arc_testnet --account merchant --broadcast
contract RegisterService is Script {
    function run() external returns (uint64 serviceId) {
        StubEscrow gate = StubEscrow(vm.envAddress("VITE_ESCROW_ADDRESS"));
        address fulfiller = vm.envAddress("FULFILLER_ADDRESS");
        uint96 price = uint96(vm.envUint("SERVICE_PRICE_UNITS")); // 6 decimals: 50000 = 0.05 USDC
        uint32 timeout = uint32(vm.envUint("SERVICE_TIMEOUT_SECONDS"));

        vm.startBroadcast();
        serviceId = gate.registerService(fulfiller, price, timeout, keccak256("stub:pitch-brief:v1"));
        vm.stopBroadcast();

        console2.log("Registered serviceId:", serviceId);
    }
}
