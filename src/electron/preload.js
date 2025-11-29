const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Version API
  getCurrentVersion: () => ipcRenderer.invoke('get-current-version'),
  
  // API Key Management
  getApiKey: () => ipcRenderer.invoke('get-api-key'),
  setApiKey: (apiKey) => ipcRenderer.invoke('set-api-key', apiKey),
  
  // Network Management
  getNetwork: () => ipcRenderer.invoke('get-network'),
  setNetwork: (network) => ipcRenderer.invoke('set-network', network),
  
  // Validator Management APIs
  saveValidators: (validators) => ipcRenderer.invoke('save-validators', validators),
  getValidators: () => ipcRenderer.invoke('get-validators'),
  fetchValidatorStats: (validatorIndex) => ipcRenderer.invoke('fetch-validator-stats', validatorIndex),
  fetchValidatorIncome: (validatorIndex) => ipcRenderer.invoke('fetch-validator-income', validatorIndex),
  fetchValidatorAttestations: (validatorIndex) => ipcRenderer.invoke('fetch-validator-attestations', validatorIndex),
  fetchValidatorProposals: (validatorIndex) => ipcRenderer.invoke('fetch-validator-proposals', validatorIndex),
  
  // Menu shortcuts
  onShowAddValidator: (callback) => {
    ipcRenderer.on('show-add-validator', () => callback());
  },
  onShowSettings: (callback) => {
    ipcRenderer.on('show-settings', () => callback());
  }
});

