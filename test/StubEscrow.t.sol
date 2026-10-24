// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {StubEscrow} from "../contracts/StubEscrow.sol";
import {MockUSDC, FeeOnTransferToken} from "./mocks/MockUSDC.sol";

contract StubEscrowTest is Test {
    StubEscrow internal gate;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal feeTo = makeAddr("feeTo");
    address internal merchant = makeAddr("merchant");
    address internal fulfiller = makeAddr("fulfiller");
    address internal buyer = makeAddr("buyer");
    address internal agent = makeAddr("agent");
    address internal stranger = makeAddr("stranger");

    uint96 internal constant PRICE = 50_000; // 0.05 USDC (6 decimals)
    uint32 internal constant TIMEOUT = 10 minutes;
    uint16 internal constant FEE = 300; // 3%
    bytes32 internal constant INPUT = keccak256("idea: uber for dog walkers");
    bytes32 internal constant RESULT = keccak256("pitch-brief-json");
    bytes32 internal constant META = keccak256("pitch-brief-v1");

    uint64 internal sid;

    function setUp() public {
        usdc = new MockUSDC();
        gate = new StubEscrow(IERC20(address(usdc)), owner, feeTo, FEE);

        vm.prank(merchant);
        sid = gate.registerService(fulfiller, PRICE, TIMEOUT, META);

        usdc.mint(buyer, 100e6);
        vm.prank(buyer);
        usdc.approve(address(gate), type(uint256).max);
    }

    // ------------------------------------------------------------------ helpers

    function _pay(bytes32 id) internal {
        vm.prank(buyer);
        gate.pay(sid, id, INPUT, PRICE);
    }

    function _assertSolvent() internal view {
        assertEq(usdc.balanceOf(address(gate)), gate.totalLocked(), "escrow balance != totalLocked");
    }

    // ------------------------------------------------------------------ constructor

    function test_constructor_rejectsBadParams() public {
        vm.expectRevert(StubEscrow.ZeroAddress.selector);
        new StubEscrow(IERC20(address(0)), owner, feeTo, FEE);
        vm.expectRevert(StubEscrow.ZeroAddress.selector);
        new StubEscrow(IERC20(address(usdc)), owner, address(0), FEE);
        vm.expectRevert(StubEscrow.InvalidFee.selector);
        new StubEscrow(IERC20(address(usdc)), owner, feeTo, 501);
    }

    // ------------------------------------------------------------------ services

    function test_register_validates() public {
        vm.startPrank(merchant);
        vm.expectRevert(StubEscrow.ZeroAddress.selector);
        gate.registerService(address(0), PRICE, TIMEOUT, META);
        vm.expectRevert(StubEscrow.InvalidPrice.selector);
        gate.registerService(fulfiller, 0, TIMEOUT, META);
        vm.expectRevert(StubEscrow.InvalidTimeout.selector);
        gate.registerService(fulfiller, PRICE, 59, META);
        vm.expectRevert(StubEscrow.InvalidTimeout.selector);
        gate.registerService(fulfiller, PRICE, 7 days + 1, META);
        vm.stopPrank();
    }

    function test_updateService_onlyMerchant() public {
        vm.prank(stranger);
        vm.expectRevert(StubEscrow.NotMerchant.selector);
        gate.updateService(sid, fulfiller, PRICE, TIMEOUT, true, META);

        vm.expectRevert(StubEscrow.UnknownService.selector);
        gate.updateService(999, fulfiller, PRICE, TIMEOUT, true, META);
    }

    // ------------------------------------------------------------------ happy path

    function test_pay_fulfill_splitsCorrectly() public {
        bytes32 id = keccak256("p1");
        _pay(id);

        assertEq(usdc.balanceOf(address(gate)), PRICE);
        assertEq(uint8(gate.statusOf(id)), uint8(StubEscrow.Status.Locked));
        _assertSolvent();

        vm.prank(fulfiller);
        gate.fulfill(id, RESULT);

        uint256 fee = (uint256(PRICE) * FEE) / 10_000; // 1_500
        assertEq(usdc.balanceOf(feeTo), fee);
        assertEq(usdc.balanceOf(merchant), PRICE - fee); // 48_500
        assertEq(usdc.balanceOf(address(gate)), 0);
        assertEq(uint8(gate.statusOf(id)), uint8(StubEscrow.Status.Fulfilled));
        assertEq(gate.getPurchase(id).resultHash, RESULT);
        _assertSolvent();
    }

    function test_zeroFee_skipsFeeTransfer() public {
        vm.prank(owner);
        gate.setProtocolFee(0, feeTo);
        bytes32 id = keccak256("p0");
        _pay(id);
        vm.prank(fulfiller);
        gate.fulfill(id, RESULT);
        assertEq(usdc.balanceOf(merchant), PRICE);
        assertEq(usdc.balanceOf(feeTo), 0);
    }

    // ------------------------------------------------------------------ pay guards

    function test_pay_duplicatePurchaseId_reverts() public {
        bytes32 id = keccak256("dup");
        _pay(id);
        vm.prank(buyer);
        vm.expectRevert(StubEscrow.PurchaseExists.selector);
        gate.pay(sid, id, INPUT, PRICE);
    }

    function test_pay_idReusedAfterSettlement_reverts() public {
        bytes32 id = keccak256("reuse");
        _pay(id);
        vm.prank(fulfiller);
        gate.fulfill(id, RESULT);
        vm.prank(buyer);
        vm.expectRevert(StubEscrow.PurchaseExists.selector);
        gate.pay(sid, id, INPUT, PRICE);
    }

    function test_pay_zeroIdOrHash_reverts() public {
        vm.startPrank(buyer);
        vm.expectRevert(StubEscrow.InvalidPurchaseId.selector);
        gate.pay(sid, bytes32(0), INPUT, PRICE);
        vm.expectRevert(StubEscrow.InvalidHash.selector);
        gate.pay(sid, keccak256("x"), bytes32(0), PRICE);
        vm.stopPrank();
    }

    function test_pay_unknownOrInactiveService_reverts() public {
        vm.prank(buyer);
        vm.expectRevert(StubEscrow.UnknownService.selector);
        gate.pay(42, keccak256("x"), INPUT, PRICE);

        vm.prank(merchant);
        gate.updateService(sid, fulfiller, PRICE, TIMEOUT, false, META);
        vm.prank(buyer);
        vm.expectRevert(StubEscrow.ServiceInactive.selector);
        gate.pay(sid, keccak256("x"), INPUT, PRICE);
    }

    function test_pay_priceFrontrun_guardedByMaxAmount() public {
        vm.prank(merchant);
        gate.updateService(sid, fulfiller, PRICE * 10, TIMEOUT, true, META);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(StubEscrow.PriceAboveMax.selector, PRICE * 10, PRICE));
        gate.pay(sid, keccak256("x"), INPUT, PRICE);
    }

    function test_pay_insufficientAllowance_reverts() public {
        vm.prank(buyer);
        usdc.approve(address(gate), PRICE - 1);
        vm.prank(buyer);
        vm.expectRevert();
        gate.pay(sid, keccak256("x"), INPUT, PRICE);
    }

    function test_pay_insufficientBalance_reverts() public {
        address poor = makeAddr("poor");
        vm.startPrank(poor);
        usdc.approve(address(gate), type(uint256).max);
        vm.expectRevert();
        gate.pay(sid, keccak256("x"), INPUT, PRICE);
        vm.stopPrank();
    }

    function test_pay_feeOnTransferToken_rejected() public {
        FeeOnTransferToken bad = new FeeOnTransferToken();
        StubEscrow g2 = new StubEscrow(IERC20(address(bad)), owner, feeTo, FEE);
        vm.prank(merchant);
        uint64 s2 = g2.registerService(fulfiller, PRICE, TIMEOUT, META);
        bad.mint(buyer, 1e6);
        vm.startPrank(buyer);
        bad.approve(address(g2), type(uint256).max);
        vm.expectRevert(StubEscrow.TransferMismatch.selector);
        g2.pay(s2, keccak256("x"), INPUT, PRICE);
        vm.stopPrank();
    }

    function test_priceChangeAfterLock_doesNotAffectPurchase() public {
        bytes32 id = keccak256("snap");
        _pay(id);
        vm.prank(merchant);
        gate.updateService(sid, stranger, PRICE * 3, TIMEOUT, true, META); // new price + new fulfiller
        vm.prank(owner);
        gate.setProtocolFee(0, feeTo); // fee change too

        // original fulfiller still settles at the original price and fee
        vm.prank(fulfiller);
        gate.fulfill(id, RESULT);
        assertEq(usdc.balanceOf(merchant), PRICE - (uint256(PRICE) * FEE) / 10_000);
    }

    // ------------------------------------------------------------------ fulfil guards

    function test_fulfill_wrongCaller_reverts() public {
        bytes32 id = keccak256("w");
        _pay(id);
        vm.prank(stranger);
        vm.expectRevert(StubEscrow.NotFulfiller.selector);
        gate.fulfill(id, RESULT);
        vm.prank(merchant); // even the merchant cannot self-release
        vm.expectRevert(StubEscrow.NotFulfiller.selector);
        gate.fulfill(id, RESULT);
    }

    function test_fulfill_afterDeadline_reverts() public {
        bytes32 id = keccak256("late");
        _pay(id);
        vm.warp(block.timestamp + TIMEOUT + 1);
        vm.prank(fulfiller);
        vm.expectRevert(StubEscrow.DeadlinePassed.selector);
        gate.fulfill(id, RESULT);
    }

    function test_fulfill_atExactDeadline_ok() public {
        bytes32 id = keccak256("edge");
        _pay(id);
        vm.warp(block.timestamp + TIMEOUT);
        vm.prank(fulfiller);
        gate.fulfill(id, RESULT);
    }

    function test_fulfill_zeroResult_reverts() public {
        bytes32 id = keccak256("z");
        _pay(id);
        vm.prank(fulfiller);
        vm.expectRevert(StubEscrow.InvalidHash.selector);
        gate.fulfill(id, bytes32(0));
    }

    function test_fulfill_twice_reverts() public {
        bytes32 id = keccak256("twice");
        _pay(id);
        vm.startPrank(fulfiller);
        gate.fulfill(id, RESULT);
        vm.expectRevert(StubEscrow.NotLocked.selector);
        gate.fulfill(id, RESULT);
        vm.stopPrank();
    }

    function test_fulfill_unknownPurchase_reverts() public {
        vm.prank(fulfiller);
        vm.expectRevert(StubEscrow.NotLocked.selector);
        gate.fulfill(keccak256("never"), RESULT);
    }

    // ------------------------------------------------------------------ refunds

    function test_refund_beforeDeadline_reverts() public {
        bytes32 id = keccak256("r");
        _pay(id);
        vm.prank(buyer);
        vm.expectRevert(StubEscrow.DeadlineNotReached.selector);
        gate.refund(id);
    }

    function test_refund_afterDeadline_returnsFunds() public {
        bytes32 id = keccak256("r2");
        uint256 start = usdc.balanceOf(buyer);
        _pay(id);
        vm.warp(block.timestamp + TIMEOUT + 1);
        vm.prank(buyer);
        gate.refund(id);
        assertEq(usdc.balanceOf(buyer), start);
        assertEq(uint8(gate.statusOf(id)), uint8(StubEscrow.Status.Refunded));
        _assertSolvent();
    }

    function test_refund_byStranger_reverts() public {
        bytes32 id = keccak256("r3");
        _pay(id);
        vm.warp(block.timestamp + TIMEOUT + 1);
        vm.prank(stranger);
        vm.expectRevert(StubEscrow.NotPayerOrBuyer.selector);
        gate.refund(id);
    }

    function test_doubleRefund_and_fulfillAfterRefund_revert() public {
        bytes32 id = keccak256("r4");
        _pay(id);
        vm.warp(block.timestamp + TIMEOUT + 1);
        vm.startPrank(buyer);
        gate.refund(id);
        vm.expectRevert(StubEscrow.NotLocked.selector);
        gate.refund(id);
        vm.stopPrank();
        vm.prank(fulfiller);
        vm.expectRevert(StubEscrow.NotLocked.selector);
        gate.fulfill(id, RESULT);
    }

    function test_refundAfterFulfill_reverts() public {
        bytes32 id = keccak256("r5");
        _pay(id);
        vm.prank(fulfiller);
        gate.fulfill(id, RESULT);
        vm.warp(block.timestamp + TIMEOUT + 1);
        vm.prank(buyer);
        vm.expectRevert(StubEscrow.NotLocked.selector);
        gate.refund(id);
    }

    function test_refundEarly_byFulfillerOrMerchant() public {
        bytes32 a = keccak256("e1");
        bytes32 b = keccak256("e2");
        uint256 start = usdc.balanceOf(buyer);
        _pay(a);
        _pay(b);
        vm.prank(fulfiller);
        gate.refundEarly(a);
        vm.prank(merchant);
        gate.refundEarly(b);
        assertEq(usdc.balanceOf(buyer), start);
        _assertSolvent();
    }

    function test_refundEarly_byBuyer_reverts() public {
        bytes32 id = keccak256("e3");
        _pay(id);
        vm.prank(buyer);
        vm.expectRevert(StubEscrow.NotMerchantOrFulfiller.selector);
        gate.refundEarly(id);
    }

    // ------------------------------------------------------------------ agent budgets

    function _setupAgent(uint96 maxPerCall, uint96 dailyCap) internal {
        vm.prank(buyer);
        gate.setAgentBudget(agent, maxPerCall, dailyCap, true);
    }

    function test_agent_paysWithinBudget_refundGoesToOwner() public {
        _setupAgent(PRICE, PRICE * 3);
        bytes32 id = keccak256("a1");
        uint256 start = usdc.balanceOf(buyer);
        vm.prank(agent);
        gate.payAsAgent(buyer, sid, id, INPUT, PRICE);

        StubEscrow.Purchase memory p = gate.getPurchase(id);
        assertEq(p.payer, buyer);
        assertEq(p.buyer, agent);
        assertEq(gate.remainingToday(buyer, agent), PRICE * 2);

        vm.warp(block.timestamp + TIMEOUT + 1);
        vm.prank(agent);
        gate.refund(id);
        assertEq(usdc.balanceOf(buyer), start, "refund must go to owner, never the agent");
        assertEq(usdc.balanceOf(agent), 0);
    }

    function test_agent_overPerCall_reverts() public {
        _setupAgent(PRICE - 1, PRICE * 10);
        vm.prank(agent);
        vm.expectRevert(StubEscrow.OverPerCallLimit.selector);
        gate.payAsAgent(buyer, sid, keccak256("a"), INPUT, PRICE);
    }

    function test_agent_overDailyCap_reverts_thenResetsNextDay() public {
        _setupAgent(PRICE, PRICE * 2);
        vm.startPrank(agent);
        gate.payAsAgent(buyer, sid, keccak256("d1"), INPUT, PRICE);
        gate.payAsAgent(buyer, sid, keccak256("d2"), INPUT, PRICE);
        vm.expectRevert(StubEscrow.OverDailyCap.selector);
        gate.payAsAgent(buyer, sid, keccak256("d3"), INPUT, PRICE);
        assertEq(gate.remainingToday(buyer, agent), 0);

        vm.warp(block.timestamp + 1 days);
        assertEq(gate.remainingToday(buyer, agent), PRICE * 2);
        gate.payAsAgent(buyer, sid, keccak256("d4"), INPUT, PRICE);
        vm.stopPrank();
    }

    function test_agent_inactive_or_unset_reverts() public {
        vm.prank(agent);
        vm.expectRevert(StubEscrow.AgentInactive.selector);
        gate.payAsAgent(buyer, sid, keccak256("u"), INPUT, PRICE);

        _setupAgent(PRICE, PRICE * 5);
        vm.prank(buyer);
        gate.setAgentBudget(agent, PRICE, PRICE * 5, false);
        vm.prank(agent);
        vm.expectRevert(StubEscrow.AgentInactive.selector);
        gate.payAsAgent(buyer, sid, keccak256("u2"), INPUT, PRICE);
        assertEq(gate.remainingToday(buyer, agent), 0);
    }

    function test_agent_cannotSpendOtherOwner() public {
        _setupAgent(PRICE, PRICE * 5); // budget is buyer->agent only
        address victim = makeAddr("victim");
        usdc.mint(victim, 10e6);
        vm.prank(victim);
        usdc.approve(address(gate), type(uint256).max);
        vm.prank(agent);
        vm.expectRevert(StubEscrow.AgentInactive.selector);
        gate.payAsAgent(victim, sid, keccak256("steal"), INPUT, PRICE);
    }

    function test_agent_failedLock_doesNotConsumeBudget() public {
        _setupAgent(PRICE, PRICE);
        bytes32 id = keccak256("once");
        _pay(id); // id already used by owner directly
        vm.prank(agent);
        vm.expectRevert(StubEscrow.PurchaseExists.selector);
        gate.payAsAgent(buyer, sid, id, INPUT, PRICE);
        assertEq(gate.remainingToday(buyer, agent), PRICE, "reverted call must not burn budget");
    }

    function test_setAgentBudget_validates() public {
        vm.startPrank(buyer);
        vm.expectRevert(StubEscrow.ZeroAddress.selector);
        gate.setAgentBudget(address(0), 1, 1, true);
        vm.expectRevert(StubEscrow.SelfAgent.selector);
        gate.setAgentBudget(buyer, 1, 1, true);
        // per-call cap exceeds daily cap only matters when active=true
        vm.expectRevert(StubEscrow.DailyCapBelowPerCall.selector);
        gate.setAgentBudget(agent, PRICE * 2, PRICE, true);
        // same values with active=false are allowed (disabled budgets carry no spending power)
        gate.setAgentBudget(agent, PRICE * 2, PRICE, false);
        vm.stopPrank();
    }

    /// @dev An agent whose per-call limit exactly equals the daily cap should succeed (boundary).
    function test_setAgentBudget_perCallEqualsDailyCap_ok() public {
        vm.prank(buyer);
        gate.setAgentBudget(agent, PRICE, PRICE, true);
        assertEq(gate.remainingToday(buyer, agent), PRICE);
    }

    // ------------------------------------------------------------------ admin

    function test_admin_onlyOwner() public {
        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        gate.setProtocolFee(100, feeTo);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        gate.pause();
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        gate.rescue(IERC20(address(usdc)), stranger);
        vm.stopPrank();
    }

    function test_setProtocolFee_capped() public {
        vm.prank(owner);
        vm.expectRevert(StubEscrow.InvalidFee.selector);
        gate.setProtocolFee(501, feeTo);
    }

    function test_renounce_disabled() public {
        vm.prank(owner);
        vm.expectRevert(bytes("Stub: renounce disabled"));
        gate.renounceOwnership();
    }

    function test_ownershipTransfer_isTwoStep() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        gate.transferOwnership(newOwner);
        assertEq(gate.owner(), owner);
        vm.prank(newOwner);
        gate.acceptOwnership();
        assertEq(gate.owner(), newOwner);
    }

    function test_pause_blocksNewLocks_butNeverTrapsFunds() public {
        bytes32 a = keccak256("pa");
        bytes32 b = keccak256("pb");
        _pay(a);
        _pay(b);
        vm.prank(owner);
        gate.pause();

        vm.prank(buyer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        gate.pay(sid, keccak256("pc"), INPUT, PRICE);

        vm.prank(fulfiller);
        gate.fulfill(a, RESULT); // still works
        vm.warp(block.timestamp + TIMEOUT + 1);
        vm.prank(buyer);
        gate.refund(b); // still works
        _assertSolvent();
    }

    function test_rescue_onlyExcessUSDC() public {
        _pay(keccak256("lockme"));
        vm.prank(owner);
        vm.expectRevert(StubEscrow.NothingToRescue.selector);
        gate.rescue(IERC20(address(usdc)), owner);

        usdc.mint(address(gate), 7e6); // accidental donation
        vm.prank(owner);
        gate.rescue(IERC20(address(usdc)), owner);
        assertEq(usdc.balanceOf(owner), 7e6);
        _assertSolvent(); // escrowed funds untouched
    }

    // ------------------------------------------------------------------ fuzz

    function testFuzz_split_isExact(uint96 price, uint16 fee) public {
        price = uint96(bound(price, 1, 1_000_000e6));
        fee = uint16(bound(fee, 0, 500));
        vm.prank(owner);
        gate.setProtocolFee(fee, feeTo);
        vm.prank(merchant);
        uint64 s = gate.registerService(fulfiller, price, TIMEOUT, META);

        address b = makeAddr("fuzzBuyer");
        usdc.mint(b, price);
        vm.startPrank(b);
        usdc.approve(address(gate), price);
        gate.pay(s, keccak256("f"), INPUT, price);
        vm.stopPrank();

        vm.prank(fulfiller);
        gate.fulfill(keccak256("f"), RESULT);

        assertEq(usdc.balanceOf(merchant) + usdc.balanceOf(feeTo), price, "no dust created or lost");
        assertLe(usdc.balanceOf(feeTo), (uint256(price) * 500) / 10_000);
        _assertSolvent();
    }

    function testFuzz_randomSettlementSequence_staysSolvent(uint256 seed) public {
        for (uint256 i; i < 12; ++i) {
            bytes32 id = keccak256(abi.encode(seed, i));
            _pay(id);
            uint256 action = uint256(keccak256(abi.encode(seed, i, "act"))) % 3;
            if (action == 0) {
                vm.prank(fulfiller);
                gate.fulfill(id, RESULT);
            } else if (action == 1) {
                vm.prank(fulfiller);
                gate.refundEarly(id);
            }
            // action 2: leave locked
            _assertSolvent();
        }
    }
}
