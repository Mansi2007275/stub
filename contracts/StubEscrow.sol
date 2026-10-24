// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title StubEscrow
/// @notice Pay-per-call escrow for APIs and AI agents on Arc. USDC is locked per purchase,
///         released to the merchant only when the service's fulfiller delivers a result hash,
///         and refundable to the payer after the deadline (or early by the merchant/fulfiller).
/// @dev    Uses ONLY the USDC ERC-20 interface on Arc (6 decimals). Never mix with native 18-decimal units.
///         Non-custodial: funds exist here only while a purchase is Locked. No pooled deposits.
contract StubEscrow is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum Status {
        None,
        Locked,
        Fulfilled,
        Refunded
    }

    struct Service {
        address merchant; // receives payment
        address fulfiller; // gateway key allowed to fulfil
        uint96 price; // USDC (6 decimals)
        uint32 timeout; // seconds a purchase stays fulfillable
        bool active;
        bytes32 metadataHash; // hash of off-chain metadata (name, schema, endpoint docs)
    }

    /// @dev Everything needed to settle is snapshotted at lock time, so later service or fee
    ///      changes can never affect a purchase that is already paid.
    struct Purchase {
        address payer; // whose USDC was pulled; refunds always go here
        uint96 amount;
        address buyer; // who acts (payer itself, or an agent spending payer's budget)
        uint64 deadline;
        uint16 feeBps;
        Status status;
        address merchant;
        address fulfiller;
        uint64 serviceId;
        bytes32 inputHash;
        bytes32 resultHash;
    }

    struct AgentBudget {
        uint96 maxPerCall;
        uint96 dailyCap;
        uint96 spentToday;
        uint32 day; // UTC day index of spentToday
        bool active;
    }

    // ---------------------------------------------------------------------
    // Constants & immutables
    // ---------------------------------------------------------------------

    uint16 public constant MAX_FEE_BPS = 500; // 5%
    uint16 internal constant BPS = 10_000;
    uint32 public constant MIN_TIMEOUT = 60; // 1 minute
    uint32 public constant MAX_TIMEOUT = 7 days;

    IERC20 public immutable usdc;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    uint16 public feeBps;
    address public feeRecipient;
    uint64 public serviceCount;
    uint256 public totalLocked; // sum of amounts in Locked purchases (accounting invariant)

    mapping(uint64 serviceId => Service) public services;
    mapping(bytes32 purchaseId => Purchase) internal _purchases;
    mapping(address owner => mapping(address agent => AgentBudget)) public agentBudgets;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event ServiceRegistered(
        uint64 indexed serviceId, address indexed merchant, address fulfiller, uint96 price, uint32 timeout, bytes32 metadataHash
    );
    event ServiceUpdated(uint64 indexed serviceId, address fulfiller, uint96 price, uint32 timeout, bool active, bytes32 metadataHash);
    event PurchaseLocked(
        bytes32 indexed purchaseId,
        uint64 indexed serviceId,
        address indexed payer,
        address buyer,
        uint96 amount,
        uint64 deadline,
        bytes32 inputHash
    );
    event PurchaseFulfilled(bytes32 indexed purchaseId, bytes32 resultHash, uint96 merchantAmount, uint96 feeAmount);
    event PurchaseRefunded(bytes32 indexed purchaseId, address indexed payer, uint96 amount, bool early);
    event AgentBudgetSet(address indexed owner, address indexed agent, uint96 maxPerCall, uint96 dailyCap, bool active);
    event ProtocolFeeSet(uint16 feeBps, address feeRecipient);
    event ExcessRescued(address indexed token, address indexed to, uint256 amount);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error InvalidPrice();
    error InvalidTimeout();
    error InvalidFee();
    error InvalidHash();
    error InvalidPurchaseId();
    error UnknownService();
    error ServiceInactive();
    error NotMerchant();
    error NotFulfiller();
    error NotPayerOrBuyer();
    error NotMerchantOrFulfiller();
    error PurchaseExists();
    error NotLocked();
    error DeadlinePassed();
    error DeadlineNotReached();
    error PriceAboveMax(uint96 price, uint96 maxAmount);
    error AgentInactive();
    error OverPerCallLimit();
    error OverDailyCap();
    error SelfAgent();
    error DailyCapBelowPerCall();
    error TransferMismatch();
    error NothingToRescue();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(IERC20 usdc_, address owner_, address feeRecipient_, uint16 feeBps_) Ownable(owner_) {
        if (address(usdc_) == address(0) || feeRecipient_ == address(0)) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert InvalidFee();
        usdc = usdc_;
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
        emit ProtocolFeeSet(feeBps_, feeRecipient_);
    }

    // ---------------------------------------------------------------------
    // Merchant: services
    // ---------------------------------------------------------------------

    function registerService(address fulfiller, uint96 price, uint32 timeout, bytes32 metadataHash)
        external
        whenNotPaused
        returns (uint64 serviceId)
    {
        _validateService(fulfiller, price, timeout);
        serviceId = ++serviceCount; // ids start at 1; 0 means "none"
        services[serviceId] = Service({
            merchant: msg.sender,
            fulfiller: fulfiller,
            price: price,
            timeout: timeout,
            active: true,
            metadataHash: metadataHash
        });
        emit ServiceRegistered(serviceId, msg.sender, fulfiller, price, timeout, metadataHash);
    }

    function updateService(uint64 serviceId, address fulfiller, uint96 price, uint32 timeout, bool active, bytes32 metadataHash)
        external
    {
        Service storage s = services[serviceId];
        if (s.merchant == address(0)) revert UnknownService();
        if (s.merchant != msg.sender) revert NotMerchant();
        _validateService(fulfiller, price, timeout);
        s.fulfiller = fulfiller;
        s.price = price;
        s.timeout = timeout;
        s.active = active;
        s.metadataHash = metadataHash;
        emit ServiceUpdated(serviceId, fulfiller, price, timeout, active, metadataHash);
    }

    // ---------------------------------------------------------------------
    // Buyer: pay
    // ---------------------------------------------------------------------

    /// @notice Lock `price` USDC for one call. Caller must have approved this contract.
    /// @param maxAmount Slippage guard: reverts if the merchant raised the price above this.
    function pay(uint64 serviceId, bytes32 purchaseId, bytes32 inputHash, uint96 maxAmount)
        external
        nonReentrant
        whenNotPaused
    {
        _lock(msg.sender, msg.sender, serviceId, purchaseId, inputHash, maxAmount);
    }

    /// @notice An agent spends from `owner`'s USDC allowance, bounded by the owner's caps.
    function payAsAgent(address owner, uint64 serviceId, bytes32 purchaseId, bytes32 inputHash, uint96 maxAmount)
        external
        nonReentrant
        whenNotPaused
    {
        AgentBudget storage b = agentBudgets[owner][msg.sender];
        if (!b.active) revert AgentInactive();

        uint96 price = _activeService(serviceId).price;
        if (price > b.maxPerCall) revert OverPerCallLimit();

        uint32 today = uint32(block.timestamp / 1 days);
        if (b.day != today) {
            b.day = today;
            b.spentToday = 0;
        }
        uint96 newSpent = b.spentToday + price;
        if (newSpent > b.dailyCap) revert OverDailyCap();
        b.spentToday = newSpent;

        _lock(owner, msg.sender, serviceId, purchaseId, inputHash, maxAmount);
    }

    /// @notice Owner sets (or disables) a spending budget for an agent address.
    /// @dev    The owner must also approve this contract for at least the intended spend.
    function setAgentBudget(address agent, uint96 maxPerCall, uint96 dailyCap, bool active) external {
        if (agent == address(0)) revert ZeroAddress();
        if (agent == msg.sender) revert SelfAgent();
        // A per-call cap above the daily cap would make the daily cap unreachable for the first call.
        if (active && maxPerCall > dailyCap) revert DailyCapBelowPerCall();
        AgentBudget storage b = agentBudgets[msg.sender][agent];
        b.maxPerCall = maxPerCall;
        b.dailyCap = dailyCap;
        b.active = active;
        emit AgentBudgetSet(msg.sender, agent, maxPerCall, dailyCap, active);
    }

    // ---------------------------------------------------------------------
    // Settlement
    // ---------------------------------------------------------------------

    /// @notice Fulfiller posts the result hash before the deadline; funds are released.
    function fulfill(bytes32 purchaseId, bytes32 resultHash) external nonReentrant {
        Purchase storage p = _purchases[purchaseId];
        if (p.status != Status.Locked) revert NotLocked();
        if (msg.sender != p.fulfiller) revert NotFulfiller();
        if (block.timestamp > p.deadline) revert DeadlinePassed();
        if (resultHash == bytes32(0)) revert InvalidHash();

        // effects
        p.status = Status.Fulfilled;
        p.resultHash = resultHash;
        uint96 amount = p.amount;
        totalLocked -= amount;
        uint96 fee = uint96((uint256(amount) * p.feeBps) / BPS);
        uint96 merchantAmount = amount - fee;

        // interactions
        usdc.safeTransfer(p.merchant, merchantAmount);
        if (fee != 0) usdc.safeTransfer(feeRecipient, fee);

        emit PurchaseFulfilled(purchaseId, resultHash, merchantAmount, fee);
    }

    /// @notice Payer or buyer reclaims funds once the deadline has passed without delivery.
    function refund(bytes32 purchaseId) external nonReentrant {
        Purchase storage p = _purchases[purchaseId];
        if (p.status != Status.Locked) revert NotLocked();
        if (msg.sender != p.payer && msg.sender != p.buyer) revert NotPayerOrBuyer();
        if (block.timestamp <= p.deadline) revert DeadlineNotReached();
        _refund(purchaseId, p, false);
    }

    /// @notice Merchant or fulfiller refunds immediately (e.g. the upstream service failed).
    function refundEarly(bytes32 purchaseId) external nonReentrant {
        Purchase storage p = _purchases[purchaseId];
        if (p.status != Status.Locked) revert NotLocked();
        if (msg.sender != p.merchant && msg.sender != p.fulfiller) revert NotMerchantOrFulfiller();
        _refund(purchaseId, p, true);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice New fee applies only to future purchases (snapshotted at lock).
    function setProtocolFee(uint16 feeBps_, address feeRecipient_) external onlyOwner {
        if (feeBps_ > MAX_FEE_BPS) revert InvalidFee();
        if (feeRecipient_ == address(0)) revert ZeroAddress();
        feeBps = feeBps_;
        feeRecipient = feeRecipient_;
        emit ProtocolFeeSet(feeBps_, feeRecipient_);
    }

    /// @notice Pausing blocks new services and new locks only. Fulfil and refund always work,
    ///         so a pause can never trap user funds.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Recover tokens sent here by mistake. For USDC, only the excess above escrowed funds.
    function rescue(IERC20 token, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = token.balanceOf(address(this));
        uint256 amount = address(token) == address(usdc) ? bal - totalLocked : bal;
        if (amount == 0) revert NothingToRescue();
        token.safeTransfer(to, amount);
        emit ExcessRescued(address(token), to, amount);
    }

    /// @dev Ownership can never be renounced: it would freeze fee config and rescue.
    function renounceOwnership() public pure override {
        revert("Stub: renounce disabled");
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getPurchase(bytes32 purchaseId) external view returns (Purchase memory) {
        return _purchases[purchaseId];
    }

    function statusOf(bytes32 purchaseId) external view returns (Status) {
        return _purchases[purchaseId].status;
    }

    /// @notice How much an agent can still spend today for `owner`.
    function remainingToday(address owner, address agent) external view returns (uint96) {
        AgentBudget memory b = agentBudgets[owner][agent];
        if (!b.active) return 0;
        uint96 spent = b.day == uint32(block.timestamp / 1 days) ? b.spentToday : 0;
        return spent >= b.dailyCap ? 0 : b.dailyCap - spent;
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    function _lock(address payer, address buyer, uint64 serviceId, bytes32 purchaseId, bytes32 inputHash, uint96 maxAmount)
        internal
    {
        if (purchaseId == bytes32(0)) revert InvalidPurchaseId();
        if (inputHash == bytes32(0)) revert InvalidHash();
        Purchase storage p = _purchases[purchaseId];
        if (p.status != Status.None) revert PurchaseExists(); // replay protection: ids are single-use forever

        Service memory s = _activeService(serviceId);
        if (s.price > maxAmount) revert PriceAboveMax(s.price, maxAmount);

        uint64 deadline = uint64(block.timestamp) + s.timeout;
        uint16 fee = feeBps;

        // effects
        p.payer = payer;
        p.buyer = buyer;
        p.amount = s.price;
        p.deadline = deadline;
        p.feeBps = fee;
        p.status = Status.Locked;
        p.merchant = s.merchant;
        p.fulfiller = s.fulfiller;
        p.serviceId = serviceId;
        p.inputHash = inputHash;
        totalLocked += s.price;

        // interaction: pull exact amount, and verify it actually arrived
        uint256 before = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(payer, address(this), s.price);
        if (usdc.balanceOf(address(this)) - before != s.price) revert TransferMismatch();

        emit PurchaseLocked(purchaseId, serviceId, payer, buyer, s.price, deadline, inputHash);
    }

    function _refund(bytes32 purchaseId, Purchase storage p, bool early) internal {
        p.status = Status.Refunded;
        uint96 amount = p.amount;
        totalLocked -= amount;
        usdc.safeTransfer(p.payer, amount);
        emit PurchaseRefunded(purchaseId, p.payer, amount, early);
    }

    function _activeService(uint64 serviceId) internal view returns (Service memory s) {
        s = services[serviceId];
        if (s.merchant == address(0)) revert UnknownService();
        if (!s.active) revert ServiceInactive();
    }

    function _validateService(address fulfiller, uint96 price, uint32 timeout) internal pure {
        if (fulfiller == address(0)) revert ZeroAddress();
        if (price == 0) revert InvalidPrice();
        if (timeout < MIN_TIMEOUT || timeout > MAX_TIMEOUT) revert InvalidTimeout();
    }
}
