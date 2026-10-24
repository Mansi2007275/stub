// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StubEscrow} from "../contracts/StubEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @dev Random actor that pays, fulfils, refunds and warps time.
contract Handler is Test {
    StubEscrow internal gate;
    MockUSDC internal usdc;
    address internal fulfiller;
    uint64 internal sid;
    address[3] internal buyers;
    bytes32[] public ids;
    uint256 public totalPaid;
    uint256 public totalOut;

    constructor(StubEscrow g, MockUSDC u, address f, uint64 s) {
        gate = g;
        usdc = u;
        fulfiller = f;
        sid = s;
        for (uint256 i; i < 3; ++i) {
            buyers[i] = makeAddr(string(abi.encode("b", i)));
            usdc.mint(buyers[i], 1_000e6);
            vm.prank(buyers[i]);
            usdc.approve(address(gate), type(uint256).max);
        }
    }

    function pay(uint256 who, uint256 salt) external {
        address b = buyers[who % 3];
        bytes32 id = keccak256(abi.encode(b, salt, ids.length));
        (, uint96 price,,,) = _svc();
        vm.prank(b);
        gate.pay(sid, id, keccak256("in"), price);
        ids.push(id);
        totalPaid += price;
    }

    function fulfill(uint256 i) external {
        if (ids.length == 0) return;
        bytes32 id = ids[i % ids.length];
        StubEscrow.Purchase memory p = gate.getPurchase(id);
        if (p.status != StubEscrow.Status.Locked || block.timestamp > p.deadline) return;
        vm.prank(fulfiller);
        gate.fulfill(id, keccak256("out"));
        totalOut += p.amount;
    }

    function refund(uint256 i) external {
        if (ids.length == 0) return;
        bytes32 id = ids[i % ids.length];
        StubEscrow.Purchase memory p = gate.getPurchase(id);
        if (p.status != StubEscrow.Status.Locked || block.timestamp <= p.deadline) return;
        vm.prank(p.payer);
        gate.refund(id);
        totalOut += p.amount;
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 2 hours));
    }

    function _svc() internal view returns (address, uint96, uint32, bool, bytes32) {
        (, address f, uint96 price, uint32 timeout, bool active, bytes32 meta) = gate.services(sid);
        return (f, price, timeout, active, meta);
    }
}

contract StubEscrowInvariantTest is Test {
    StubEscrow internal gate;
    MockUSDC internal usdc;
    Handler internal handler;

    function setUp() public {
        usdc = new MockUSDC();
        gate = new StubEscrow(IERC20(address(usdc)), address(this), makeAddr("fee"), 300);
        address fulfiller = makeAddr("fulfiller");
        vm.prank(makeAddr("merchant"));
        uint64 sid = gate.registerService(fulfiller, 50_000, 10 minutes, bytes32(0));
        handler = new Handler(gate, usdc, fulfiller, sid);
        targetContract(address(handler));
    }

    /// Escrow always holds exactly what is locked: no funds created, lost, or stuck.
    function invariant_balanceEqualsTotalLocked() public view {
        assertEq(usdc.balanceOf(address(gate)), gate.totalLocked());
    }

    /// Everything paid in is either still locked or has been paid out exactly once.
    function invariant_conservation() public view {
        assertEq(handler.totalPaid(), handler.totalOut() + gate.totalLocked());
    }
}
