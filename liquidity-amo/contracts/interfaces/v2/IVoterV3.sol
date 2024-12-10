// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IVoterV3 {
    struct GaugeInfo {
        address gauge;
        address internal_bribe;
        address external_bribe;
    }

    error AlreadyVotedOrDeposited();
    error GaugeExists();
    error GaugeNotAlive();
    error GaugeTypeNotAllowed();
    error InactivePeriod();
    error InvalidGaugeType();
    error InvalidPoolFactory();
    error InvalidRewardsDistributor();
    error InvalidVotingStage();
    error NoGauge();
    error NoWeight();
    error NotAlive();
    error NotAuthorized();
    error NotEmergencyCouncil();
    error NotGovernor();
    error NotMinter();
    error NotWhitelisted();
    error SameValue();
    error TooManyPools();
    error ZeroAddress();

    event Abstained(uint256 tokenId, uint256 weight);
    event Attach(address indexed owner, address indexed gauge, uint256 tokenId);
    event Detach(address indexed owner, address indexed gauge, uint256 tokenId);
    event DistributeReward(address indexed gauge, address indexed reward_token);
    event GaugeCreated(
        address indexed gauge,
        address creator,
        address internal_bribe,
        address external_bribe,
        address pool
    );
    event GaugeKilled(address indexed gauge);
    event GaugeRevived(address indexed gauge);
    event NotifyReward(address indexed sender, address indexed reward_token, uint256 amount);
    event VoteForGauge(uint256 time, address indexed user, uint256 tokenId, address indexed gauge, uint256 weight);
    event WhitelistToken(address indexed token, bool indexed whitelisted);

    function createGauge(address _pool, uint256 _gaugeType) external returns (address, address, address);

    function createGauges(
        address[] memory _pool,
        uint256[] memory _gaugeTypes
    ) external returns (address[] memory, address[] memory, address[] memory);

    function attachTokenToGauge(uint256 tokenId, address account) external;

    function detachTokenFromGauge(uint256 tokenId, address account) external;

    function emitDeposit(uint256 tokenId, address account, uint256 amount) external;

    function emitWithdraw(uint256 tokenId, address account, uint256 amount) external;

    function distribute(address _gauge) external;

    function notifyRewardAmount(uint256 amount) external;

    function updateAll() external;

    function updateFor(address[] memory _gauges) external;

    function updateForRange(uint256 start, uint256 end) external;

    function updateGauge(address _gauge) external;

    function vote(uint256 tokenId, address[] calldata _poolVote, uint256[] calldata _weights) external;

    function reset(uint256 _tokenId) external;

    function poke(uint256 _tokenId) external;

    function abstain(uint256 _tokenId) external;

    function whitelist(address[] memory _token) external;

    // View functions
    function gauges(address _pool) external view returns (GaugeInfo memory);

    function poolForGauge(address _gauge) external view returns (address);

    function isGauge(address _gauge) external view returns (bool);

    function isWhitelisted(address _token) external view returns (bool);

    function totalWeight() external view returns (uint256);

    function usedWeights(uint256 _tokenId) external view returns (uint256);

    function weights(address _pool) external view returns (uint256);

    function votes(uint256 _tokenId, address _pool) external view returns (uint256);

    function gaugeTypes(address _gauge) external view returns (uint256);

    function isAlive(address _gauge) external view returns (bool);

    function poolVote(uint256 _tokenId, uint256 _index) external view returns (address);

    function poolVoteLength(uint256 _tokenId) external view returns (uint256);

    function lastVoted(uint256 _tokenId) external view returns (uint256);

    function claimable(address _gauge) external view returns (uint256);
}
