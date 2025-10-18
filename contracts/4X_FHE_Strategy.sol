pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract FourXFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    error NotOwner();
    error NotProvider();
    error Paused();
    error InvalidBatch();
    error CooldownActive();
    error StaleWrite();
    error InvalidStateHash();
    error AlreadyProcessed();
    error InvalidRequest();

    event TechResearchSubmitted(address indexed player, uint256 techId, bytes32 encryptedValue);
    event BatchOpened(uint256 batchId);
    event BatchClosed(uint256 batchId);
    event DecryptionRequested(uint256 indexed requestId, uint256 batchId, bytes32 stateHash);
    event DecryptionComplete(uint256 indexed requestId, uint256 batchId, uint256 totalResearch);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event CooldownUpdated(uint256 newCooldown);
    event BatchSizeUpdated(uint256 newBatchSize);

    struct ResearchEntry {
        euint32 encryptedResearch;
        uint256 version;
    }

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }

    struct Batch {
        uint256 totalResearchEncrypted;
        uint256 version;
        bool active;
    }

    // Access control
    address public owner;
    mapping(address => bool) public providers;
    bool public paused;
    uint256 public cooldownSeconds = 30;
    uint256 public maxBatchSize = 100;

    // State
    mapping(address => uint256) public lastActionAt;
    mapping(uint256 => Batch) public batches;
    mapping(uint256 => mapping(address => ResearchEntry)) public researchEntries;
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!providers[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier respectCooldown() {
        if (block.timestamp < lastActionAt[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        lastActionAt[msg.sender] = block.timestamp;
        _;
    }

    constructor() {
        owner = msg.sender;
        providers[owner] = true;
        emit ProviderAdded(owner);
    }

    function setCooldown(uint256 newCooldown) external onlyOwner {
        cooldownSeconds = newCooldown;
        emit CooldownUpdated(newCooldown);
    }

    function setMaxBatchSize(uint256 newBatchSize) external onlyOwner {
        maxBatchSize = newBatchSize;
        emit BatchSizeUpdated(newBatchSize);
    }

    function addProvider(address provider) external onlyOwner {
        providers[provider] = true;
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) external onlyOwner {
        providers[provider] = false;
        emit ProviderRemoved(provider);
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function openBatch(uint256 batchId) external onlyProvider whenNotPaused respectCooldown {
        if (batches[batchId].active) revert InvalidBatch();
        batches[batchId] = Batch({ totalResearchEncrypted: FHE.asEuint32(0), version: 0, active: true });
        emit BatchOpened(batchId);
    }

    function closeBatch(uint256 batchId) external onlyProvider whenNotPaused respectCooldown {
        if (!batches[batchId].active) revert InvalidBatch();
        batches[batchId].active = false;
        emit BatchClosed(batchId);
    }

    function submitResearch(
        uint256 batchId,
        uint256 techId,
        euint32 encryptedResearch
    ) external onlyProvider whenNotPaused respectCooldown {
        if (!batches[batchId].active) revert InvalidBatch();
        ResearchEntry storage entry = researchEntries[batchId][msg.sender];
        if (entry.version != 0) {
            revert StaleWrite();
        }
        entry.encryptedResearch = encryptedResearch;
        entry.version = block.timestamp;
        emit TechResearchSubmitted(msg.sender, techId, FHE.toBytes32(encryptedResearch));
    }

    function aggregateBatch(uint256 batchId) external onlyProvider whenNotPaused respectCooldown {
        if (batches[batchId].active) revert InvalidBatch();
        Batch storage batch = batches[batchId];
        euint32 memory acc = batch.totalResearchEncrypted;
        for (uint256 i = 0; i < maxBatchSize; ) {
            ResearchEntry memory entry = researchEntries[batchId][address(uint160(i))];
            if (FHE.isInitialized(entry.encryptedResearch)) {
                acc = FHE.add(acc, entry.encryptedResearch);
            }
            unchecked { i++; }
        }
        batch.totalResearchEncrypted = acc;
        batch.version++;
    }

    function requestBatchDecryption(uint256 batchId) external onlyProvider whenNotPaused respectCooldown returns (uint256) {
        Batch storage batch = batches[batchId];
        if (batch.version == 0) revert InvalidBatch();
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(batch.totalResearchEncrypted);
        bytes32 stateHash = keccak256(abi.encode(cts, address(this)));
        uint256 requestId = FHE.requestDecryption(cts, this.onDecryptionComplete.selector);
        decryptionContexts[requestId] = DecryptionContext(batchId, stateHash, false);
        emit DecryptionRequested(requestId, batchId, stateHash);
        return requestId;
    }

    function onDecryptionComplete(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        if (decryptionContexts[requestId].processed) revert AlreadyProcessed();
        DecryptionContext storage ctx = decryptionContexts[requestId];
        Batch storage batch = batches[ctx.batchId];
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(batch.totalResearchEncrypted);
        bytes32 currHash = keccak256(abi.encode(cts, address(this)));
        if (currHash != ctx.stateHash) revert InvalidStateHash();
        FHE.checkSignatures(requestId, cleartexts, proof);
        uint256 totalResearch = abi.decode(cleartexts, (uint256));
        ctx.processed = true;
        emit DecryptionComplete(requestId, ctx.batchId, totalResearch);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 x) internal pure returns (euint32) {
        if (!FHE.isInitialized(x)) {
            return FHE.asEuint32(0);
        }
        return x;
    }

    function _requireInitialized(euint32 x, string memory tag) internal pure {
        if (!FHE.isInitialized(x)) {
            revert(string(abi.encodePacked(tag, " not initialized")));
        }
    }
}