// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/access/AccessControlEnumerableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "./interfaces/IMasterVoter.sol";
import "./interfaces/IBribe.sol";
import "./interfaces/Ive.sol";

contract MasterUtils is AccessControlEnumerableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    address public voter;
    uint256 public activePeriod;
    uint256 public bribeTimesPerWeek;
    mapping(uint256 => uint256) public bribeTimes;
    mapping(address => uint256) public bribeAmountLimit;
    address public ve;
    address public msig;
    uint256 public maxtime;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant SETTER_ROLE = keccak256("SETTER_ROLE");
    bytes32 public constant WITHDRAWER_ROLE = keccak256("WITHDRAWER_ROLE");

    event Voted(uint256 indexed tokenId, address[] poolVote, uint256[] weights);
    event Poked(uint256 indexed tokenId);
    event BribesClaimed(uint256 indexed tokenId, address[] bribes, address[][] tokens);
    event FeesClaimed(uint256 indexed tokenId, address[] fees, address[][] tokens);
    event RewardAmountsNotified(address[] bribes, address[] rewards, uint256[] amounts);
    event ERC20Withdrawn(address indexed token, address indexed to, uint256 amount);
    event ERC721Withdrawn(address indexed token, address indexed to, uint256 tokenId);
    event SwapperWithdrawn(address indexed token, address indexed to, uint256 amount);
    event VoterSet(address indexed oldVoter, address indexed newVoter);
    event MsigSet(address indexed oldMsig, address indexed newMsig);
    event VeSet(address indexed oldVe, address indexed newVe);
    event MaxtimeSet(uint256 oldMaxtime, uint256 newMaxtime);
    event BribeTimesPerWeekSet(uint256 oldTimes, uint256 newTimes);
    event BribeAmountLimitSet(address bribe, uint256 amount);

    error ZeroAddress();
    error CantIncreaseUnlockTime();
    error ArrayLengthsMismatch();
    error BribeTimesPerWeekLimitExceeded();
    error BribeAmountLimitExceeded(uint256 bribeAmount, uint256 limitAmount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address voter_,
        address admin,
        address operator,
        address msig_,
        uint256 maxtime_
    ) public initializer {
        if (voter_ == address(0) || admin == address(0) || operator == address(0) || msig_ == address(0))
            revert ZeroAddress();

        __AccessControlEnumerable_init();
        __ReentrancyGuard_init();

        voter = voter_;
        ve = getVoterVe(voter);
        msig = msig_;
        maxtime = maxtime_;
        activePeriod = (block.timestamp / 1 weeks) * 1 weeks;

        _setupRole(DEFAULT_ADMIN_ROLE, admin);
        _setupRole(OPERATOR_ROLE, operator);
        _setupRole(SETTER_ROLE, admin);
        _setupRole(WITHDRAWER_ROLE, admin);
    }

    function checkIncreaseUnlockTime(uint256 tokenId, uint256 lockDuration) public view virtual returns (bool) {
        Ive.LockedBalance memory currentLocked = Ive(ve).locked(tokenId);
        uint256 unlockTime = ((block.timestamp + lockDuration) / 1 weeks) * 1 weeks;
        return unlockTime > currentLocked.end;
    }

    function _increaseUnlockTime(uint256 tokenId, uint256 lockDuration) internal virtual {
        Ive(ve).increase_unlock_time(tokenId, lockDuration);
    }

    function increaseUnlockTime(uint256 tokenId, uint256 lockDuration) external nonReentrant onlyRole(OPERATOR_ROLE) {
        if (!checkIncreaseUnlockTime(tokenId, lockDuration)) revert CantIncreaseUnlockTime();
        _increaseUnlockTime(tokenId, lockDuration);
    }

    function vote(
        uint256 tokenId,
        address[] calldata poolVote,
        uint256[] calldata weights
    ) external nonReentrant onlyRole(OPERATOR_ROLE) {
        if (checkIncreaseUnlockTime(tokenId, maxtime)) _increaseUnlockTime(tokenId, maxtime);
        IMasterVoter(voter).vote(tokenId, poolVote, weights);
        emit Voted(tokenId, poolVote, weights);
    }

    function poke(uint256 tokenId) external nonReentrant onlyRole(OPERATOR_ROLE) {
        if (checkIncreaseUnlockTime(tokenId, maxtime)) _increaseUnlockTime(tokenId, maxtime);
        IMasterVoter(voter).poke(tokenId);
        emit Poked(tokenId);
    }

    function claimBribes(
        address[] calldata bribes,
        address[][] calldata tokens,
        uint256 tokenId
    ) external nonReentrant onlyRole(OPERATOR_ROLE) {
        IMasterVoter(voter).claimBribes(bribes, tokens, tokenId);
        emit BribesClaimed(tokenId, bribes, tokens);
    }

    function claimFees(
        address[] calldata fees,
        address[][] calldata tokens,
        uint256 tokenId
    ) external nonReentrant onlyRole(OPERATOR_ROLE) {
        IMasterVoter(voter).claimFees(fees, tokens, tokenId);
        emit FeesClaimed(tokenId, fees, tokens);
    }

    function notifyRewardAmounts(
        address[] calldata bribes,
        address[] calldata rewards,
        uint256[] calldata amounts
    ) external nonReentrant onlyRole(OPERATOR_ROLE) {
        if (bribes.length != rewards.length || bribes.length != amounts.length) revert ArrayLengthsMismatch();

        uint256 currentPeriod = (block.timestamp / 1 weeks) * 1 weeks;

        if (currentPeriod > activePeriod) {
            activePeriod = currentPeriod;
            bribeTimes[activePeriod] = 0;
        }

        if (bribeTimes[activePeriod] + bribes.length > bribeTimesPerWeek) revert BribeTimesPerWeekLimitExceeded();

        for (uint i = 0; i < bribes.length; i++) {
            if (amounts[i] > bribeAmountLimit[bribes[i]])
                revert BribeAmountLimitExceeded({bribeAmount: amounts[i], limitAmount: bribeAmountLimit[bribes[i]]});
            IERC20(rewards[i]).forceApprove(bribes[i], amounts[i]);
            IBribe(bribes[i]).notifyRewardAmount(rewards[i], amounts[i]);
        }

        bribeTimes[activePeriod] += bribes.length;

        emit RewardAmountsNotified(bribes, rewards, amounts);
    }

    function setVoter(address voter_) external onlyRole(SETTER_ROLE) {
        if (voter_ == address(0)) revert ZeroAddress();

        address ve_ = getVoterVe(voter_);
        emit VoterSet(voter, voter_);
        emit VeSet(ve, ve_);
        voter = voter_;
        ve = ve_;
    }

    function setMsig(address msig_) external onlyRole(SETTER_ROLE) {
        if (msig_ == address(0)) revert ZeroAddress();

        emit MsigSet(msig, msig_);
        msig = msig_;
    }

    function setMaxtime(uint256 maxtime_) external onlyRole(SETTER_ROLE) {
        emit MaxtimeSet(maxtime, maxtime_);
        maxtime = maxtime_;
    }

    function setBribeTimesPerWeek(uint256 newBribeTimesPerWeek) external onlyRole(SETTER_ROLE) {
        emit BribeTimesPerWeekSet(bribeTimesPerWeek, newBribeTimesPerWeek);
        bribeTimesPerWeek = newBribeTimesPerWeek;
    }

    function setBribeAmountLimit(address bribe, uint256 amount) external onlyRole(SETTER_ROLE) {
        bribeAmountLimit[bribe] = amount;
        emit BribeAmountLimitSet(bribe, amount);
    }

    function msigWithdrawERC20(address token, uint256 amount) external onlyRole(WITHDRAWER_ROLE) {
        if (token == address(0)) revert ZeroAddress();

        IERC20(token).safeTransfer(msig, amount);
        emit ERC20Withdrawn(token, msig, amount);
    }

    function msigWithdrawERC721(address token, uint256 tokenId) external onlyRole(WITHDRAWER_ROLE) {
        if (token == address(0)) revert ZeroAddress();

        IERC721(token).safeTransferFrom(address(this), msig, tokenId);
        emit ERC721Withdrawn(token, msig, tokenId);
    }

    function swapperWithdraw(address token, uint256 amount) external onlyRole(OPERATOR_ROLE) {
        if (token == address(0)) revert ZeroAddress();

        IERC20(token).safeTransfer(msg.sender, amount);
        emit SwapperWithdrawn(token, msg.sender, amount);
    }

    function increaseAmount(uint256 tokenId, uint256 value) external virtual nonReentrant onlyRole(OPERATOR_ROLE) {
        Ive(ve).increase_amount(tokenId, value);
    }

    function merge(uint256 from, uint256 to) external nonReentrant onlyRole(OPERATOR_ROLE) {
        Ive(ve).merge(from, to);
    }

    function getVoterVe(address voter_) public view virtual returns (address) {
        return IMasterVoter(voter_)._ve();
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
