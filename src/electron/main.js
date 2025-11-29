const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const Store = require('electron-store');

// Initialize electron-store for persistent settings
const store = new Store();

// Development mode detection
const isDevelopment = process.env.NODE_ENV === 'development' || process.defaultApp || /[\\/]electron-prebuilt[\\/]/.test(process.execPath) || /[\\/]electron[\\/]/.test(process.execPath);

// Conditional logging wrapper
const devLog = (...args) => {
  if (isDevelopment) {
    console.log(...args);
  }
};

const devError = (...args) => {
  // Always log errors, but with less detail in production
  if (isDevelopment) {
    console.error(...args);
  } else {
    console.error('[Error]', args[0]); // Only log first argument (error message) in production
  }
};

// Beaconcha.in API configuration
const API_ENDPOINTS = {
  mainnet: 'https://beaconcha.in/api/v1',
  holesky: 'https://hoodi.beaconcha.in/api/v1'
};

// Get current network (default: mainnet)
function getCurrentNetwork() {
  return store.get('currentNetwork') || 'mainnet';
}

// Set current network
function setCurrentNetwork(network) {
  if (network === 'mainnet' || network === 'holesky') {
    store.set('currentNetwork', network);
    return true;
  }
  return false;
}

// Get API base URL for current network
function getApiBaseUrl() {
  const network = getCurrentNetwork();
  return API_ENDPOINTS[network] || API_ENDPOINTS.mainnet;
}

// Get API key from storage, env variable, or use empty string (free tier)
function getApiKey() {
  return store.get('beaconchaApiKey') || process.env.BEACONCHAIN_API_KEY || '';
}

// Storage helper functions
function getStoragePath() {
  const network = getCurrentNetwork();
  return path.join(app.getPath('userData'), `validators_${network}.json`);
}

function readStorage() {
  try {
    const storagePath = getStoragePath();
    if (fs.existsSync(storagePath)) {
      const data = fs.readFileSync(storagePath, 'utf8');
      return JSON.parse(data);
    }
    return { validators: [] };
  } catch (error) {
    console.error('Error reading storage:', error);
    return { validators: [] };
  }
}

function writeStorage(data) {
  try {
    const storagePath = getStoragePath();
    fs.writeFileSync(storagePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error writing storage:', error);
    return false;
  }
}

let mainWindow;
let tray = null;
let currentVersion = '1.0.0'; // This should match package.json version

// Create the main application window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      devTools: isDevelopment // Disable DevTools in production
    },
    icon: path.join(__dirname, '../../assets/icon.png')
  });

  mainWindow.loadFile(path.join(__dirname, '../ui/index.html'));
  
  // Set custom menu (removes DevTools in production)
  setupApplicationMenu();
  
  // Only open DevTools automatically in development
  if (isDevelopment) {
    mainWindow.webContents.openDevTools();
  }

  // Handle window close - minimize to tray on Windows/Linux, normal close on macOS
  mainWindow.on('close', (event) => {
    if (process.platform !== 'darwin' && !app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  
  // Create system tray
  createTray();
}

// Setup application menu (removes DevTools in production)
function setupApplicationMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Add Validator',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('show-add-validator');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('show-settings');
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.isQuitting = true;
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: async () => {
            const { shell } = require('electron');
            await shell.openExternal('https://ethvalidatormonitor.com/docs');
          }
        },
        { type: 'separator' },
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About ETH Validator Monitor',
              message: 'ETH Validator Monitor',
              detail: `Version: ${currentVersion}\nMonitor your Ethereum validators with real-time data from Beaconcha.in`,
              buttons: ['OK']
            });
          }
        }
      ]
    }
  ];

  // Add DevTools option ONLY in development
  if (isDevelopment) {
    template[2].submenu.push(
      { type: 'separator' },
      { role: 'toggleDevTools' }
    );
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// IPC Handlers
ipcMain.handle('get-current-version', () => {
  return currentVersion;
});

// API Key Management
ipcMain.handle('get-api-key', () => {
  return getApiKey();
});

ipcMain.handle('set-api-key', (event, apiKey) => {
  store.set('beaconchaApiKey', apiKey);
  return true;
});

// Network Management
ipcMain.handle('get-network', () => {
  return getCurrentNetwork();
});

ipcMain.handle('set-network', (event, network) => {
  return setCurrentNetwork(network);
});

// Validator Node Management
ipcMain.handle('save-validators', async (event, validators) => {
  try {
    // Save validators to persistent storage
    const success = writeStorage({ validators });
      if (success) {
        devLog(`Saved ${validators.length} validators to storage`);
      return { success: true };
    } else {
      return { success: false, error: 'Failed to write to storage' };
    }
  } catch (error) {
    console.error('Error saving validators:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-validators', async () => {
  try {
    // Retrieve saved validators from storage
    const data = readStorage();
    const validators = data.validators || [];
    devLog(`Retrieved ${validators.length} validators from storage`);
    return {
      success: true,
      validators: validators
    };
  } catch (error) {
    console.error('Error retrieving validators:', error);
    return { success: false, error: error.message, validators: [] };
  }
});

ipcMain.handle('fetch-validator-stats', async (event, validatorId) => {
  try {
    // Allow user to enter validator index or public key
    const id = String(validatorId).trim();

    // Build request
    const apiBase = getApiBaseUrl();
    const url = `${apiBase}/validator/${encodeURIComponent(id)}`;
    const headers = {};
    const apiKey = getApiKey();
    if (apiKey) {
      // As per docs: header name is `apikey`
      // https://docs.beaconcha.in/api/overview
      headers.apikey = apiKey;
    }

    const response = await axios.get(url, { headers });

    const data = response.data && response.data.data
      ? Array.isArray(response.data.data)
        ? response.data.data[0]
        : response.data.data
      : null;

    if (!data) {
      throw new Error('Validator not found on beaconcha.in');
    }

    // Log the raw API data to help debug (dev only)
    devLog('Raw validator data from Beaconcha.in API:', JSON.stringify(data, null, 2));

    // Beaconcha returns balances in gwei – convert to ETH when possible
    const balanceGwei = data.balance ?? data.currentbalance;
    const effectiveGwei = data.effectivebalance ?? data.balance;

    const balanceEth =
      typeof balanceGwei === 'number'
        ? balanceGwei / 1e9
        : parseFloat(balanceGwei) / 1e9;

    const effectiveEth =
      typeof effectiveGwei === 'number'
        ? effectiveGwei / 1e9
        : parseFloat(effectiveGwei) / 1e9;

    // Map API fields into UI-friendly structure
    // Beaconcha.in status values: active_ongoing, active_exiting, active_slashed, 
    // pending_initialized, pending_queued, exited_unslashed, exited_slashed, withdrawal_possible, withdrawal_done
    const rawStatus = data.status || 'unknown';
    devLog('Raw validator status from API:', rawStatus);
    
    // Calculate uptime from attestation data (Beaconcha.in doesn't provide direct uptime field)
    const totalAttestations = data.attestationscount || data.attestations || data.attestation_count || 0;
    const missedAttestations = data.missedattestations || data.attestations_missed || data.attester_slashings || 0;
    let uptimePercentage = 'N/A';
    
    if (totalAttestations > 0) {
      const successfulAttestations = totalAttestations - missedAttestations;
      uptimePercentage = ((successfulAttestations / totalAttestations) * 100).toFixed(2) + '%';
      devLog(`Uptime calculated: ${successfulAttestations}/${totalAttestations} = ${uptimePercentage}`);
    } else if (rawStatus && rawStatus.toLowerCase().startsWith('active')) {
      // If no attestation data but validator is active, assume 100% (probably new validator)
      uptimePercentage = '100.00%';
      devLog('No attestation data yet, assuming 100% for active validator');
    }
    
    const stats = {
      index: data.validatorindex ?? id,
      balance: isFinite(balanceEth) ? `${balanceEth.toFixed(4)} ETH` : 'N/A',
      status: rawStatus,
      // Rough effectiveness proxy: effective balance vs 32 ETH
      effectiveness:
        isFinite(effectiveEth) && effectiveEth > 0
          ? `${Math.min(100, (effectiveEth / 32) * 100).toFixed(1)}%`
          : 'N/A',
      // These fields may differ by API version – fall back gracefully
      attestations:
        data.attestationscount ||
        data.attestations ||
        data.attestation_count ||
        0,
      proposals:
        data.proposalscount ||
        data.proposals ||
        data.proposal_count ||
        0,
      uptime: uptimePercentage
    };

    return { success: true, data: stats };
  } catch (error) {
    devError('Error fetching validator stats from beaconcha.in:', error.response?.data || error.message);
    const message =
      (error.response && error.response.data && error.response.data.message) ||
      error.message ||
      'Failed to fetch validator stats';
    return { success: false, error: message };
  }
});

// Fetch validator income/earnings data
ipcMain.handle('fetch-validator-income', async (event, validatorIndex) => {
  try {
    const index = String(validatorIndex).trim();
    
    // Try multiple approaches since Beaconcha.in API might vary
    const apiBase = getApiBaseUrl();
    const headers = {};
    const apiKey = getApiKey();
    if (apiKey) {
      headers.apikey = apiKey;
    }

    devLog(`Fetching income for validator ${index}`);
    
    // Approach 1: Try the income endpoint (might be for premium users)
    try {
      const incomeUrl = `${apiBase}/validator/${encodeURIComponent(index)}/income`;
      const incomeResponse = await axios.get(incomeUrl, { headers });
      
      if (incomeResponse.data && incomeResponse.data.data) {
        const data = Array.isArray(incomeResponse.data.data) 
          ? incomeResponse.data.data[0] 
          : incomeResponse.data.data;
        
        const totalIncome = data.total_income ?? data.total ?? 0;
        const attestationIncome = data.attestation_income ?? data.attestations ?? 0;
        const proposalIncome = data.proposal_income ?? data.proposals ?? 0;
        const syncCommitteeIncome = data.sync_committee_income ?? data.sync ?? 0;
        
        return { 
          success: true, 
          data: {
            total: (totalIncome / 1e9).toFixed(4),
            attestations: (attestationIncome / 1e9).toFixed(4),
            proposals: (proposalIncome / 1e9).toFixed(4),
            syncCommittee: (syncCommitteeIncome / 1e9).toFixed(4),
            dailyAverage: 'N/A'
          }
        };
      }
    } catch (incomeError) {
      devLog('Income endpoint not available, calculating from balance...');
    }
    
    // Approach 2: Calculate income from current balance - 32 ETH (initial deposit)
    const validatorUrl = `${apiBase}/validator/${encodeURIComponent(index)}`;
    const validatorResponse = await axios.get(validatorUrl, { headers });
    
    const data = validatorResponse.data && validatorResponse.data.data
      ? Array.isArray(validatorResponse.data.data)
        ? validatorResponse.data.data[0]
        : validatorResponse.data.data
      : null;

    if (!data) {
      throw new Error('Validator data not found');
    }

    // Calculate estimated income from balance
    const balanceGwei = data.balance ?? data.currentbalance ?? 0;
    const balanceEth = balanceGwei / 1e9;
    const initialStake = 32; // Standard stake amount
    const estimatedIncome = Math.max(0, balanceEth - initialStake);
    
    // Get proposal count for estimated proposal income (rough estimate: ~0.05 ETH per proposal)
    const proposalCount = data.proposalscount || data.proposals || 0;
    const estimatedProposalIncome = proposalCount * 0.05;
    const estimatedAttestationIncome = Math.max(0, estimatedIncome - estimatedProposalIncome);

    const income = {
      total: estimatedIncome.toFixed(4),
      attestations: estimatedAttestationIncome.toFixed(4),
      proposals: estimatedProposalIncome.toFixed(4),
      syncCommittee: '0.0000', // Can't estimate this
      dailyAverage: 'N/A',
      note: 'Estimated from balance'
    };

    devLog('Estimated income data:', income);
    return { success: true, data: income };
  } catch (error) {
    devError('Error fetching validator income:', error.response?.data || error.message);
    return { 
      success: false, 
      error: error.message,
      data: {
        total: '0.0000',
        attestations: '0.0000',
        proposals: '0.0000',
        syncCommittee: '0.0000',
        dailyAverage: 'N/A',
        note: 'Unable to fetch data'
      }
    };
  }
});

// Fetch validator attestations history (for missed attestation tracking)
ipcMain.handle('fetch-validator-attestations', async (event, validatorIndex) => {
  try {
    const index = String(validatorIndex).trim();
    
    const apiBase = getApiBaseUrl();
    const headers = {};
    const apiKey = getApiKey();
    if (apiKey) {
      headers.apikey = apiKey;
    }

    devLog(`Fetching attestation history for validator ${index}`);
    
    // Get attestation performance data
    const url = `${apiBase}/validator/${encodeURIComponent(index)}/attestations`;
    const response = await axios.get(url, { headers });

    const attestations = response.data && response.data.data
      ? Array.isArray(response.data.data)
        ? response.data.data
        : [response.data.data]
      : [];

    if (attestations.length === 0) {
      // Fallback: get stats from main validator endpoint
      const validatorUrl = `${apiBase}/validator/${encodeURIComponent(index)}`;
      const validatorResponse = await axios.get(validatorUrl, { headers });
      const data = validatorResponse.data && validatorResponse.data.data
        ? Array.isArray(validatorResponse.data.data)
          ? validatorResponse.data.data[0]
          : validatorResponse.data.data
        : null;

      if (data) {
        // Calculate from overall stats
        const totalAttestations = data.attestationscount || data.attestations || 0;
        const missedAttestations = data.missedattestations || data.attestations_missed || 0;
        const successfulAttestations = totalAttestations - missedAttestations;
        const missRate = totalAttestations > 0 ? (missedAttestations / totalAttestations * 100) : 0;

        return {
          success: true,
          data: {
            total: totalAttestations,
            successful: successfulAttestations,
            missed: missedAttestations,
            missRate: missRate.toFixed(2),
            recent: [],
            lastMissed: missedAttestations > 0 ? 'Unknown' : 'Never',
            status: missRate < 1 ? 'excellent' : missRate < 2 ? 'good' : 'warning'
          }
        };
      }
    }

    // Process attestation data if available
    let missed = 0;
    let successful = 0;
    let lastMissedEpoch = null;
    const recentAttestations = [];

    attestations.slice(0, 100).forEach(att => {
      const status = att.status || att.inclusionslot;
      const isMissed = status === 0 || status === 'missed' || att.missed === true;
      
      if (isMissed) {
        missed++;
        if (!lastMissedEpoch) {
          lastMissedEpoch = att.epoch || att.attestation_epoch;
        }
      } else {
        successful++;
      }

      recentAttestations.push({
        epoch: att.epoch || att.attestation_epoch,
        slot: att.slot || att.attestation_slot,
        status: isMissed ? 'missed' : 'success'
      });
    });

    const total = missed + successful;
    const missRate = total > 0 ? (missed / total * 100) : 0;
    const status = missRate < 1 ? 'excellent' : missRate < 2 ? 'good' : 'warning';

    devLog(`Attestation stats: ${successful} successful, ${missed} missed (${missRate.toFixed(2)}%)`);

    return {
      success: true,
      data: {
        total,
        successful,
        missed,
        missRate: missRate.toFixed(2),
        recent: recentAttestations.slice(0, 20),
        lastMissed: lastMissedEpoch ? `Epoch ${lastMissedEpoch}` : 'Never',
        status
      }
    };
  } catch (error) {
    devError('Error fetching validator attestations:', error.response?.data || error.message);
    return {
      success: false,
      error: error.message,
      data: {
        total: 0,
        successful: 0,
        missed: 0,
        missRate: '0.00',
        recent: [],
        lastMissed: 'Unknown',
        status: 'unknown'
      }
    };
  }
});

// Fetch validator proposal history (block proposals = big rewards)
ipcMain.handle('fetch-validator-proposals', async (event, validatorIndex) => {
  try {
    const index = String(validatorIndex).trim();
    
    const apiBase = getApiBaseUrl();
    const headers = {};
    const apiKey = getApiKey();
    if (apiKey) {
      headers.apikey = apiKey;
    }

    devLog(`Fetching proposal history for validator ${index}`);
    
    // Get proposal data from Beaconcha.in
    const url = `${apiBase}/validator/${encodeURIComponent(index)}/proposals`;
    devLog(`Proposals API URL: ${url}`);
    
    const response = await axios.get(url, { headers });
    devLog(`Proposals API response status: ${response.status}`);
    devLog(`Proposals API raw response:`, JSON.stringify(response.data, null, 2));

    const proposals = response.data && response.data.data
      ? Array.isArray(response.data.data)
        ? response.data.data
        : [response.data.data]
      : [];

    devLog(`Parsed proposals array length: ${proposals.length}`);

    if (proposals.length === 0) {
      devLog('No proposals found in /proposals endpoint, falling back to main validator endpoint...');
      
      // Fallback: get count from main validator endpoint
      const validatorUrl = `${apiBase}/validator/${encodeURIComponent(index)}`;
      const validatorResponse = await axios.get(validatorUrl, { headers });
      const data = validatorResponse.data && validatorResponse.data.data
        ? Array.isArray(validatorResponse.data.data)
          ? validatorResponse.data.data[0]
          : validatorResponse.data.data
        : null;

      if (data) {
        devLog('Validator data for proposals check:', {
          proposalscount: data.proposalscount,
          proposals: data.proposals,
          proposerslashings: data.proposerslashings,
          executedproposals: data.executedproposals
        });
        
        const proposalCount = data.proposalscount || data.proposals || data.executedproposals || 0;
        const estimatedRewards = proposalCount * 0.05; // Rough estimate: 0.05 ETH per proposal

        devLog(`Found ${proposalCount} proposals in fallback, estimated rewards: ${estimatedRewards.toFixed(4)} ETH`);

        return {
          success: true,
          data: {
            total: proposalCount,
            totalRewards: estimatedRewards.toFixed(4),
            avgReward: proposalCount > 0 ? (estimatedRewards / proposalCount).toFixed(4) : '0.0000',
            proposals: [],
            lastProposal: proposalCount > 0 ? 'Unknown' : 'Never',
            status: proposalCount > 0 ? 'has_proposed' : 'waiting'
          }
        };
      } else {
        devLog('No validator data found in fallback');
      }
    }

    // Process proposal data if available
    devLog(`Processing ${proposals.length} proposals from API...`);
    
    let totalRewards = 0;
    const processedProposals = [];
    let lastProposalSlot = null;

    proposals.slice(0, 50).forEach((prop, idx) => {
      if (idx === 0) {
        devLog('First proposal structure:', JSON.stringify(prop, null, 2));
      }
      
      const slot = prop.slot || prop.exec_block_number;
      const epoch = prop.epoch;
      const status = prop.status === 1 || prop.status === 'proposed' ? 'proposed' : 'missed';
      
      // Try to get reward amount (in gwei)
      const rewardGwei = prop.attestationscount || prop.proposerreward || prop.blockroot || 50000000; // Default ~0.05 ETH
      const rewardEth = rewardGwei / 1e9;
      
      if (status === 'proposed') {
        totalRewards += rewardEth;
        if (!lastProposalSlot || slot > lastProposalSlot) {
          lastProposalSlot = slot;
        }
      }

      processedProposals.push({
        slot,
        epoch,
        status,
        reward: rewardEth.toFixed(4)
      });
    });

    const avgReward = processedProposals.length > 0 ? (totalRewards / processedProposals.length).toFixed(4) : '0.0000';

    devLog(`Proposal stats: ${processedProposals.length} proposals, ${totalRewards.toFixed(4)} ETH total rewards, avg: ${avgReward} ETH`);

    return {
      success: true,
      data: {
        total: processedProposals.length,
        totalRewards: totalRewards.toFixed(4),
        avgReward,
        proposals: processedProposals.slice(0, 10), // Show last 10
        lastProposal: lastProposalSlot ? `Slot ${lastProposalSlot}` : 'Never',
        status: processedProposals.length > 0 ? 'has_proposed' : 'waiting'
      }
    };
  } catch (error) {
    devError('Error fetching validator proposals:', error.response?.data || error.message);
    return {
      success: false,
      error: error.message,
      data: {
        total: 0,
        totalRewards: '0.0000',
        avgReward: '0.0000',
        proposals: [],
        lastProposal: 'Unknown',
        status: 'unknown'
      }
    };
  }
});

// Create system tray
function createTray() {
  // Create tray icon from base64 SVG (Ethereum logo)
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(`
    <svg width="16" height="16" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 2L4 9.5L16 16L28 9.5L16 2Z" fill="#627EEA"/>
      <path d="M4 9.5L16 16V30L4 9.5Z" fill="#627EEA" opacity="0.6"/>
      <path d="M28 9.5L16 16V30L28 9.5Z" fill="#627EEA" opacity="0.8"/>
    </svg>
  `).toString('base64')}`);
  
  tray = new Tray(icon);
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show App',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip('ETH Validator Monitor');
  tray.setContextMenu(contextMenu);
  
  // Click tray icon to show window
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// App lifecycle
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // On macOS, quit when all windows closed
  // On Windows/Linux, keep running in tray
  if (process.platform === 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else if (mainWindow) {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('will-quit', () => {
  if (tray) {
    tray.destroy();
  }
});

