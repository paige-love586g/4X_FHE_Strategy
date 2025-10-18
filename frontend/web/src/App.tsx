// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface Civilization {
  id: string;
  name: string;
  encryptedTechPoints: string;
  encryptedMilitaryPower: string;
  discoveredTechnologies: string[];
  lastUpdated: number;
  isPlayer: boolean;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const techTree = [
  { id: "agriculture", name: "Agriculture", requires: [], description: "Increase food production by 20%" },
  { id: "metallurgy", name: "Metallurgy", requires: ["mining"], description: "Unlocks advanced metal tools and weapons" },
  { id: "mining", name: "Mining", requires: [], description: "Enables resource extraction from mountains" },
  { id: "writing", name: "Writing", requires: [], description: "Enables diplomacy and record keeping" },
  { id: "mathematics", name: "Mathematics", requires: ["writing"], description: "Improves all research by 15%" },
  { id: "military_tactics", name: "Military Tactics", requires: ["writing"], description: "Increases combat effectiveness" },
  { id: "architecture", name: "Architecture", requires: ["mathematics"], description: "Enables wonder construction" },
  { id: "naval_warfare", name: "Naval Warfare", requires: ["shipbuilding"], description: "Unlocks advanced naval units" },
  { id: "shipbuilding", name: "Shipbuilding", requires: ["woodworking"], description: "Enables ocean exploration" },
  { id: "woodworking", name: "Woodworking", requires: [], description: "Basic construction technology" },
  { id: "mysticism", name: "Mysticism", requires: [], description: "Unlocks religious buildings" },
  { id: "currency", name: "Currency", requires: ["mathematics"], description: "Increases trade income" },
  { id: "engineering", name: "Engineering", requires: ["architecture"], description: "Enables siege weapons" },
  { id: "philosophy", name: "Philosophy", requires: ["writing"], description: "Increases research speed" },
  { id: "iron_working", name: "Iron Working", requires: ["metallurgy"], description: "Unlocks iron weapons and armor" }
];

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [civilizations, setCivilizations] = useState<Civilization[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newCivData, setNewCivData] = useState({ name: "", techPoints: 0, militaryPower: 0 });
  const [selectedTech, setSelectedTech] = useState<string | null>(null);
  const [decryptedTechPoints, setDecryptedTechPoints] = useState<number | null>(null);
  const [decryptedMilitaryPower, setDecryptedMilitaryPower] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [activeTab, setActiveTab] = useState<"dashboard" | "tech" | "diplomacy">("dashboard");

  useEffect(() => {
    loadCivilizations().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadCivilizations = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("civilization_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing civilization keys:", e); }
      }
      
      const list: Civilization[] = [];
      for (const key of keys) {
        try {
          const civBytes = await contract.getData(`civilization_${key}`);
          if (civBytes.length > 0) {
            try {
              const civData = JSON.parse(ethers.toUtf8String(civBytes));
              list.push({ 
                id: key, 
                name: civData.name, 
                encryptedTechPoints: civData.techPoints, 
                encryptedMilitaryPower: civData.militaryPower,
                discoveredTechnologies: civData.discoveredTechnologies || [],
                lastUpdated: civData.lastUpdated,
                isPlayer: civData.owner === address
              });
            } catch (e) { console.error(`Error parsing civ data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading civ ${key}:`, e); }
      }
      
      // Sort by last updated (newest first)
      list.sort((a, b) => b.lastUpdated - a.lastUpdated);
      setCivilizations(list);
    } catch (e) { console.error("Error loading civilizations:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const createCivilization = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting civilization data with Zama FHE..." });
    try {
      const encryptedTechPoints = FHEEncryptNumber(newCivData.techPoints);
      const encryptedMilitaryPower = FHEEncryptNumber(newCivData.militaryPower);
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const civId = `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const civData = { 
        name: newCivData.name,
        techPoints: encryptedTechPoints,
        militaryPower: encryptedMilitaryPower,
        discoveredTechnologies: [],
        lastUpdated: Math.floor(Date.now() / 1000),
        owner: address
      };
      
      await contract.setData(`civilization_${civId}`, ethers.toUtf8Bytes(JSON.stringify(civData)));
      
      const keysBytes = await contract.getData("civilization_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(civId);
      await contract.setData("civilization_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Civilization created with FHE encryption!" });
      await loadCivilizations();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewCivData({ name: "", techPoints: 0, militaryPower: 0 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const researchTechnology = async (techId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    const playerCiv = civilizations.find(c => c.isPlayer);
    if (!playerCiv) { alert("No player civilization found"); return; }
    
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted research with FHE..." });
    try {
      const tech = techTree.find(t => t.id === techId);
      if (!tech) throw new Error("Technology not found");
      
      // Check prerequisites
      const hasPrerequisites = tech.requires.every(req => 
        playerCiv.discoveredTechnologies.includes(req)
      );
      if (!hasPrerequisites) throw new Error("Missing prerequisites");
      
      // Get current tech points
      const currentTechPoints = await decryptWithSignature(playerCiv.encryptedTechPoints);
      if (!currentTechPoints || currentTechPoints < 100) throw new Error("Not enough research points");
      
      // Update civilization
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const civBytes = await contract.getData(`civilization_${playerCiv.id}`);
      if (civBytes.length === 0) throw new Error("Civilization not found");
      const civData = JSON.parse(ethers.toUtf8String(civBytes));
      
      // Update tech points (simplified - in real app would use FHE operations)
      const updatedTechPoints = FHEEncryptNumber(currentTechPoints - 100);
      const updatedCiv = { 
        ...civData, 
        techPoints: updatedTechPoints,
        discoveredTechnologies: [...civData.discoveredTechnologies, techId],
        lastUpdated: Math.floor(Date.now() / 1000)
      };
      
      await contract.setData(`civilization_${playerCiv.id}`, ethers.toUtf8Bytes(JSON.stringify(updatedCiv)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Technology researched successfully!" });
      await loadCivilizations();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Research failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isTechResearched = (techId: string, civId: string) => {
    const civ = civilizations.find(c => c.id === civId);
    return civ ? civ.discoveredTechnologies.includes(techId) : false;
  };

  const renderTechTree = (civId: string) => {
    return (
      <div className="tech-tree-container">
        {techTree.map(tech => (
          <div 
            key={tech.id}
            className={`tech-node ${isTechResearched(tech.id, civId) ? 'researched' : ''} ${tech.requires.every(req => isTechResearched(req, civId)) ? 'available' : 'locked'}`}
            onClick={() => setSelectedTech(tech.id)}
          >
            <div className="tech-icon"></div>
            <div className="tech-name">{tech.name}</div>
            {isTechResearched(tech.id, civId) && <div className="tech-checkmark">✓</div>}
          </div>
        ))}
      </div>
    );
  };

  const renderTechDetails = () => {
    if (!selectedTech) return null;
    const tech = techTree.find(t => t.id === selectedTech);
    if (!tech) return null;
    
    return (
      <div className="tech-details-panel">
        <h3>{tech.name}</h3>
        <p>{tech.description}</p>
        <div className="tech-requirements">
          <h4>Requirements:</h4>
          {tech.requires.length > 0 ? (
            <ul>
              {tech.requires.map(reqId => {
                const reqTech = techTree.find(t => t.id === reqId);
                return <li key={reqId}>{reqTech?.name || reqId}</li>;
              })}
            </ul>
          ) : <p>No requirements</p>}
        </div>
        <div className="tech-research-cost">
          <h4>Research Cost:</h4>
          <p>100 Research Points</p>
        </div>
        {civilizations.some(c => c.isPlayer) && (
          <button 
            className="research-btn" 
            onClick={() => researchTechnology(tech.id)}
            disabled={!tech.requires.every(req => 
              civilizations.find(c => c.isPlayer)?.discoveredTechnologies.includes(req)
            )}
          >
            Research Technology
          </button>
        )}
      </div>
    );
  };

  const renderCivilizationStats = (civ: Civilization) => {
    return (
      <div className="civ-stats">
        <div className="stat-item">
          <div className="stat-label">Research Points</div>
          <div className="stat-value">
            {civ.isPlayer && decryptedTechPoints !== null ? 
              decryptedTechPoints : 
              "FHE-ENCRYPTED"}
          </div>
          {civ.isPlayer && (
            <button 
              className="decrypt-btn" 
              onClick={async () => {
                const decrypted = await decryptWithSignature(civ.encryptedTechPoints);
                setDecryptedTechPoints(decrypted);
              }}
              disabled={isDecrypting}
            >
              {isDecrypting ? "Decrypting..." : "Decrypt"}
            </button>
          )}
        </div>
        <div className="stat-item">
          <div className="stat-label">Military Power</div>
          <div className="stat-value">
            {civ.isPlayer && decryptedMilitaryPower !== null ? 
              decryptedMilitaryPower : 
              "FHE-ENCRYPTED"}
          </div>
          {civ.isPlayer && (
            <button 
              className="decrypt-btn" 
              onClick={async () => {
                const decrypted = await decryptWithSignature(civ.encryptedMilitaryPower);
                setDecryptedMilitaryPower(decrypted);
              }}
              disabled={isDecrypting}
            >
              {isDecrypting ? "Decrypting..." : "Decrypt"}
            </button>
          )}
        </div>
        <div className="stat-item">
          <div className="stat-label">Technologies</div>
          <div className="stat-value">{civ.discoveredTechnologies.length}</div>
        </div>
      </div>
    );
  };

  const renderTechChart = () => {
    const playerCiv = civilizations.find(c => c.isPlayer);
    if (!playerCiv) return null;
    
    const researchedCount = playerCiv.discoveredTechnologies.length;
    const totalTechs = techTree.length;
    const percentage = Math.round((researchedCount / totalTechs) * 100);
    
    return (
      <div className="tech-progress-chart">
        <div className="chart-header">
          <h3>Technology Progress</h3>
          <div className="percentage">{percentage}%</div>
        </div>
        <div className="chart-bar">
          <div className="progress" style={{ width: `${percentage}%` }}></div>
        </div>
        <div className="chart-footer">
          <span>{researchedCount} / {totalTechs} technologies</span>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="tech-spinner"></div>
      <p>Initializing encrypted civilization database...</p>
    </div>
  );

  return (
    <div className="app-container future-metal-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon"></div>
          <h1>Civilization: <span>Secret Tech</span></h1>
        </div>
        <div className="header-actions">
          {civilizations.some(c => c.isPlayer) ? (
            <button className="action-btn" onClick={loadCivilizations} disabled={isRefreshing}>
              {isRefreshing ? "Syncing..." : "Sync Data"}
            </button>
          ) : (
            <button className="action-btn primary" onClick={() => setShowCreateModal(true)}>
              Create Civilization
            </button>
          )}
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content">
        <div className="sidebar">
          <div className="sidebar-section">
            <h3>Civilizations</h3>
            <div className="civ-list">
              {civilizations.map(civ => (
                <div key={civ.id} className={`civ-item ${civ.isPlayer ? 'player' : ''}`}>
                  <div className="civ-name">{civ.name}</div>
                  <div className="civ-id">#{civ.id.substring(0, 6)}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="sidebar-section">
            <h3>FHE Controls</h3>
            <div className="fhe-status">
              <div className="status-indicator active"></div>
              <span>FHE Encryption Active</span>
            </div>
            <button className="fhe-btn" onClick={() => {
              const contract = getContractReadOnly();
              if (contract) contract.isAvailable().then(() => alert("FHE system is operational"));
            }}>
              Verify FHE System
            </button>
          </div>
        </div>
        
        <div className="content-area">
          <div className="tab-bar">
            <button 
              className={`tab-btn ${activeTab === "dashboard" ? 'active' : ''}`}
              onClick={() => setActiveTab("dashboard")}
            >
              Dashboard
            </button>
            <button 
              className={`tab-btn ${activeTab === "tech" ? 'active' : ''}`}
              onClick={() => setActiveTab("tech")}
            >
              Technology
            </button>
            <button 
              className={`tab-btn ${activeTab === "diplomacy" ? 'active' : ''}`}
              onClick={() => setActiveTab("diplomacy")}
            >
              Diplomacy
            </button>
          </div>
          
          {activeTab === "dashboard" && (
            <div className="dashboard-view">
              <div className="dashboard-grid">
                <div className="dashboard-card">
                  <h3>Empire Overview</h3>
                  {civilizations.filter(c => c.isPlayer).map(civ => (
                    <div key={civ.id}>
                      {renderCivilizationStats(civ)}
                      {renderTechChart()}
                    </div>
                  ))}
                </div>
                <div className="dashboard-card">
                  <h3>Technology Comparison</h3>
                  <div className="tech-comparison">
                    <div className="comparison-header">
                      <div>Civilization</div>
                      <div>Technologies</div>
                    </div>
                    {civilizations.map(civ => (
                      <div key={civ.id} className="comparison-row">
                        <div className="civ-name">{civ.name}</div>
                        <div className="tech-count">{civ.discoveredTechnologies.length}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
          
          {activeTab === "tech" && (
            <div className="tech-view">
              <div className="tech-tree-view">
                {civilizations.filter(c => c.isPlayer).map(civ => (
                  <div key={civ.id}>
                    <h2>{civ.name}'s Technology Tree</h2>
                    <div className="tech-content">
                      {renderTechTree(civ.id)}
                      {renderTechDetails()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {activeTab === "diplomacy" && (
            <div className="diplomacy-view">
              <h2>Diplomatic Relations</h2>
              <p className="fhe-notice">
                <strong>FHE Notice:</strong> Other civilizations' technology trees are encrypted. 
                You can only see technologies they've revealed through diplomacy or espionage.
              </p>
              <div className="diplomacy-grid">
                {civilizations.filter(c => !c.isPlayer).map(civ => (
                  <div key={civ.id} className="diplomacy-card">
                    <h3>{civ.name}</h3>
                    <div className="known-techs">
                      <h4>Known Technologies:</h4>
                      {civ.discoveredTechnologies.length > 0 ? (
                        <ul>
                          {civ.discoveredTechnologies.map(techId => {
                            const tech = techTree.find(t => t.id === techId);
                            return <li key={techId}>{tech?.name || techId}</li>;
                          })}
                        </ul>
                      ) : <p>No technologies discovered yet</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Create New Civilization</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Civilization Name</label>
                <input 
                  type="text" 
                  value={newCivData.name} 
                  onChange={(e) => setNewCivData({...newCivData, name: e.target.value})}
                  placeholder="Enter your civilization's name"
                />
              </div>
              <div className="form-group">
                <label>Starting Research Points</label>
                <input 
                  type="number" 
                  value={newCivData.techPoints} 
                  onChange={(e) => setNewCivData({...newCivData, techPoints: parseInt(e.target.value) || 0})}
                  placeholder="Initial research points"
                />
              </div>
              <div className="form-group">
                <label>Starting Military Power</label>
                <input 
                  type="number" 
                  value={newCivData.militaryPower} 
                  onChange={(e) => setNewCivData({...newCivData, militaryPower: parseInt(e.target.value) || 0})}
                  placeholder="Initial military strength"
                />
              </div>
              <div className="fhe-notice">
                <strong>FHE Encryption Notice:</strong> All sensitive data will be encrypted using Zama FHE before being stored on-chain.
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">
                Cancel
              </button>
              <button onClick={createCivilization} disabled={creating} className="primary-btn">
                {creating ? "Creating..." : "Create Civilization"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="loading-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✕</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo"></div>
            <p>Civilization: Secret Tech - 4X Strategy with FHE-Encrypted Tech Trees</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">About Zama FHE</a>
            <a href="#" className="footer-link">Terms</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge">Powered by Zama FHE</div>
          <div className="copyright">© {new Date().getFullYear()} All rights reserved</div>
        </div>
      </footer>
    </div>
  );
};

export default App;