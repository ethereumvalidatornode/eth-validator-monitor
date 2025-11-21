// App State
let validators = [];
let currentVersion = '1.0.0';
let autoRefreshInterval = null;
let lastRefreshTime = null;
let REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes (configurable)
let previousDashboardStats = null; // Store previous stats for trend calculation
let appSettings = {
    notifications: {
        healthDrop: true,
        healthThreshold: 85,
        offline: true,
        proposal: true,
        missRate: true,
        missRateThreshold: 2,
        balanceDrop: false
    },
    display: {
        detailedStats: true,
        compactMode: false,
        theme: 'dark'
    },
    refreshInterval: 300000,
    apiKey: ''
};

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    await initializeApp();
    setupEventListeners();
    setupMenuShortcuts();
});

// Initialize the application
async function initializeApp() {
    try {
        // Load settings first
        loadSettings();
        applyTheme(appSettings.display.theme || 'dark');
        
        // Get current version
        currentVersion = await window.electronAPI.getCurrentVersion();
        document.getElementById('versionBadge').textContent = `v${currentVersion}`;

        // Load saved validators
        const result = await window.electronAPI.getValidators();
        if (result.success) {
            validators = result.validators || [];
            renderValidatorList();
            updateDashboard();
            renderPerformanceOverview();
            updateLastRefreshTime();
            
            // Start auto-refresh
            startAutoRefresh();
        }
    } catch (error) {
        console.error('Error initializing app:', error);
    }
}

// Auto-refresh functionality
function startAutoRefresh() {
    // Clear existing interval if any
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    
    // Set up new interval
    autoRefreshInterval = setInterval(async () => {
        await refreshAllValidators();
    }, REFRESH_INTERVAL);
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

// Refresh all validator data
async function refreshAllValidators() {
    if (validators.length === 0) return;
    
    let updatedCount = 0;
    
    for (let validator of validators) {
        try {
            const result = await window.electronAPI.fetchValidatorStats(validator.index);
            if (result.success && result.data) {
                // Store old health score for comparison
                const oldHealthScore = validator.healthScore || 100;
                
                // Update validator with fresh data
                Object.assign(validator, result.data);
                
                // Recalculate health score
                validator.healthScore = calculateHealthScore(validator);
                
                // Check if health dropped significantly (use settings threshold)
                if (appSettings.notifications.healthDrop && 
                    validator.healthScore < appSettings.notifications.healthThreshold && 
                    validator.healthScore < oldHealthScore - 10) {
                    showHealthAlert(validator, oldHealthScore);
                }
                
                updatedCount++;
            }
        } catch (error) {
            console.error(`Error refreshing validator ${validator.index}:`, error);
        }
    }
    
    // Save updated validators
    if (updatedCount > 0) {
        await window.electronAPI.saveValidators(validators);
        renderValidatorList();
        updateDashboard();
        renderPerformanceOverview();
        updateLastRefreshTime();
    }
}

// Manual refresh function removed - users can configure auto-refresh in settings

// Update last refresh timestamp
function updateLastRefreshTime() {
    lastRefreshTime = new Date();
    updateLastRefreshDisplay();
    
    // Update display every minute
    setInterval(updateLastRefreshDisplay, 60000);
}

function updateLastRefreshDisplay() {
    const display = document.getElementById('lastRefreshTime');
    if (!display || !lastRefreshTime) return;
    
    const now = new Date();
    const diffMs = now - lastRefreshTime;
    const diffMins = Math.floor(diffMs / 60000);
    
    let text = 'Just now';
    if (diffMins >= 60) {
        const hours = Math.floor(diffMins / 60);
        text = `${hours}h ago`;
    } else if (diffMins > 0) {
        text = `${diffMins}m ago`;
    }
    
    display.textContent = `Last updated: ${text}`;
}

// Setup event listeners
function setupEventListeners() {
    // Add validator button
    document.getElementById('addValidatorBtn').addEventListener('click', () => {
        showModal('addValidatorModal');
    });

    // Cancel add validator
    document.getElementById('cancelAddBtn').addEventListener('click', () => {
        hideModal('addValidatorModal');
    });

    // Cancel edit validator
    document.getElementById('cancelEditBtn').addEventListener('click', () => {
        hideModal('editValidatorModal');
    });

    // Add validator form submission
    document.getElementById('addValidatorForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleAddValidator();
    });

    // Edit validator form submission
    document.getElementById('editValidatorForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleEditValidator();
    });

    // Settings button
    document.getElementById('settingsBtn').addEventListener('click', () => {
        showSettingsPage();
    });

    // Back to dashboard
    document.getElementById('backToDashboard').addEventListener('click', () => {
        hideSettingsPage();
    });

    // Save settings
    document.getElementById('saveSettingsBtn').addEventListener('click', () => {
        saveSettings();
    });

    // Reset settings
    document.getElementById('resetSettingsBtn').addEventListener('click', () => {
        resetSettings();
    });

    const themeToggleBtn = document.getElementById('themeToggleBtn');
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', toggleThemePreference);
    }
}

// Setup menu keyboard shortcuts
function setupMenuShortcuts() {
    // Listen for menu shortcuts from main process
    window.electronAPI.onShowAddValidator(() => {
        showModal('addValidatorModal');
    });
    
    window.electronAPI.onShowSettings(() => {
        showSettingsPage();
    });
}

// Calculate health score for a validator (0-100)
function calculateHealthScore(validator) {
    let score = 100;
    
    // Parse effectiveness (40% weight)
    const effectiveness = parseFloat(validator.effectiveness) || 0;
    if (effectiveness < 100) {
        score -= (100 - effectiveness) * 0.4;
    }
    
    // Parse balance to check growth (30% weight)
    const balanceEth = parseFloat(validator.balance) || 32;
    const expectedMin = 32; // Initial stake
    if (balanceEth < expectedMin) {
        score -= 30; // Penalty if balance below initial stake (slashed?)
    } else if (balanceEth < 32.1) {
        score -= 15; // Low income
    }
    
    // Estimate miss rate from attestations (30% weight)
    // If we don't have attestation data, assume 0 (neutral)
    const attestations = validator.attestations || 0;
    const proposals = validator.proposals || 0;
    // Rough estimation: if effectiveness is low, there are likely misses
    if (effectiveness < 99) {
        const estimatedMissRate = (100 - effectiveness) * 0.3;
        score -= estimatedMissRate * 0.3;
    }
    
    // Floor at 0, ceil at 100
    score = Math.max(0, Math.min(100, score));
    
    return Math.round(score);
}

// Get health status and color based on score
function getHealthStatus(score) {
    if (score >= 95) {
        return { key: 'excellent', color: 'var(--success-color)', label: 'Excellent' };
    } else if (score >= 85) {
        return { key: 'good', color: 'var(--primary-color)', label: 'Good' };
    } else if (score >= 70) {
        return { key: 'warning', color: 'var(--warning-color)', label: 'Warning' };
    } else {
        return { key: 'critical', color: 'var(--danger-color)', label: 'Critical' };
    }
}

// Show health alert notification
function showHealthAlert(validator, oldScore) {
    const health = getHealthStatus(validator.healthScore);
    
    // Desktop notification
    if (Notification.permission === 'granted') {
        new Notification('Validator Health Alert', {
            body: `${validator.name || validator.index}\nHealth dropped from ${oldScore} to ${validator.healthScore}\nStatus: ${health.label}`,
            icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M16 2L4 9.5L16 16L28 9.5L16 2Z" fill="%23627EEA"/></svg>'
        });
    }
    
    console.warn(`Health Alert: ${validator.name} dropped to ${validator.healthScore} (was ${oldScore})`);
}

// Request notification permission on startup
if (Notification.permission === 'default') {
    Notification.requestPermission();
}

// Add validator handler
async function handleAddValidator() {
    const validatorIndex = document.getElementById('validatorIndex').value.trim();
    const validatorName = document.getElementById('validatorName').value.trim() || `Validator ${validators.length + 1}`;

    if (!validatorIndex) {
        alert('Please enter a validator index or public key');
        return;
    }

    // Fetch validator stats
    const result = await window.electronAPI.fetchValidatorStats(validatorIndex);
    
    if (result.success) {
        const newValidator = {
            id: Date.now(),
            index: validatorIndex,
            name: validatorName,
            ...result.data
        };
        
        // Calculate initial health score
        newValidator.healthScore = calculateHealthScore(newValidator);

        validators.push(newValidator);
        await window.electronAPI.saveValidators(validators);
        
        renderValidatorList();
        updateDashboard();
        renderPerformanceOverview();
        
        // Reset form and close modal
        document.getElementById('addValidatorForm').reset();
        hideModal('addValidatorModal');
    } else {
        alert('Error fetching validator data: ' + result.error);
    }
}

// Render validator list in sidebar
function renderValidatorList() {
    const listContainer = document.getElementById('validatorList');

    if (validators.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <p>No validators added yet</p>
                <p class="text-muted">Click "Add Validator" to get started</p>
            </div>
        `;
        return;
    }

    let html = '';
    validators.forEach(validator => {
        // Calculate health score if not present
        if (!validator.healthScore) {
            validator.healthScore = calculateHealthScore(validator);
        }
        
        const health = getHealthStatus(validator.healthScore);
        
        // Beaconcha.in active statuses: active_ongoing, active_exiting, active_slashed
        const isActive = validator.status && validator.status.toLowerCase().startsWith('active');
        const statusClass = isActive ? 'active' : 'inactive';
        
        // Format status text for display
        let statusText = 'Inactive';
        if (validator.status) {
            if (validator.status.startsWith('active_')) {
                statusText = 'Active';
            } else if (validator.status.startsWith('pending_')) {
                statusText = 'Pending';
            } else if (validator.status.startsWith('exited_')) {
                statusText = 'Exited';
            } else if (validator.status.startsWith('withdrawal_')) {
                statusText = 'Withdrawing';
            }
        }
        
        html += `
            <div class="validator-item" data-id="${validator.id}">
                <div class="validator-info">
                    <div class="validator-name">${validator.name}</div>
                    <div class="validator-index">#${validator.index}</div>
                </div>
                <div class="validator-health">
                    <div class="health-label">Health</div>
                    <div class="health-pill health-${health.key}">
                        <span class="health-value">${validator.healthScore}</span>
                        <span class="health-label-text">${health.label}</span>
                    </div>
                    <span class="validator-status ${statusClass}">${statusText}</span>
                </div>
            </div>
        `;
    });

    listContainer.innerHTML = html;

    // Add click handlers
    document.querySelectorAll('.validator-item').forEach(item => {
        item.addEventListener('click', () => {
            const id = parseInt(item.dataset.id);
            selectValidator(id);
        });
    });
}

// Select a validator to view details
async function selectValidator(id) {
    const validator = validators.find(v => v.id === id);
    if (!validator) return;

    // Update active state in UI
    document.querySelectorAll('.validator-item').forEach(item => {
        item.classList.remove('active');
    });
    document.querySelector(`[data-id="${id}"]`).classList.add('active');

    // Calculate health score if not present
    if (!validator.healthScore) {
        validator.healthScore = calculateHealthScore(validator);
    }
    const health = getHealthStatus(validator.healthScore);

    // Render validator details with loading state
    const detailsContainer = document.getElementById('validatorDetails');
    detailsContainer.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between;">
            <h3>Validator Details: ${validator.name}</h3>
            <div style="display: flex; gap: 8px;">
                <button class="btn-secondary" style="padding: 6px 10px; font-size: 11px;" onclick="openEditValidator(${validator.id})">
                    Edit
                </button>
                <button class="btn-secondary" style="padding: 6px 10px; font-size: 11px;" onclick="removeValidator(${validator.id})">
                    Remove
                </button>
            </div>
        </div>
        
        <!-- Health Score Banner -->
        <div class="health-banner health-${health.key}">
            <div class="health-banner-header">
                <div class="health-banner-title">Health score</div>
                <div class="health-banner-tag">${health.label}</div>
            </div>
            <div class="health-banner-main">
                <div class="health-banner-score">${validator.healthScore}</div>
                <div class="health-banner-meter">
                    <div class="health-banner-meter-fill" style="width: ${validator.healthScore}%; background: ${health.color};"></div>
                </div>
            </div>
        </div>
        
        <div style="margin-top: 20px;">
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;">
                <div>
                    <p class="stat-label">Index</p>
                    <p style="color: var(--text-primary); font-size: 18px; font-weight: 600;">${validator.index}</p>
                </div>
                <div>
                    <p class="stat-label">Balance</p>
                    <p style="color: var(--text-primary); font-size: 18px; font-weight: 600;">${validator.balance}</p>
                </div>
                <div>
                    <p class="stat-label">Effectiveness</p>
                    <p style="color: var(--success-color); font-size: 18px; font-weight: 600;">${validator.effectiveness}</p>
                </div>
                <div>
                    <p class="stat-label">Uptime</p>
                    <p style="color: var(--success-color); font-size: 18px; font-weight: 600;">${validator.uptime}</p>
                </div>
                <div>
                    <p class="stat-label">Attestations</p>
                    <p style="color: var(--text-primary); font-size: 18px; font-weight: 600;">${validator.attestations}</p>
                </div>
                <div>
                    <p class="stat-label">Proposals</p>
                    <p style="color: var(--text-primary); font-size: 18px; font-weight: 600;">${validator.proposals}</p>
                </div>
            </div>
        </div>
        <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border-color);">
            <h4 style="color: var(--text-primary); margin-bottom: 16px; font-size: 14px;">Income & Rewards</h4>
            <div id="incomeData" style="color: var(--text-muted); font-size: 13px;">Loading income data...</div>
        </div>
        <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border-color);">
            <h4 style="color: var(--text-primary); margin-bottom: 16px; font-size: 14px;">Attestation Performance</h4>
            <div id="attestationData" style="color: var(--text-muted); font-size: 13px;">Loading attestation data...</div>
        </div>
        <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border-color);">
            <h4 style="color: var(--text-primary); margin-bottom: 16px; font-size: 14px;">Block Proposals & Rewards</h4>
            <div id="proposalData" style="color: var(--text-muted); font-size: 13px;">Loading proposal data...</div>
        </div>
    `;

    // Fetch income data asynchronously
    try {
        const result = await window.electronAPI.fetchValidatorIncome(validator.index);
        const incomeContainer = document.getElementById('incomeData');
        
        if (result.success && result.data) {
            const income = result.data;
            incomeContainer.innerHTML = `
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
                    <div>
                        <p class="stat-label" style="font-size: 11px;">Total Income</p>
                        <p style="color: var(--success-color); font-size: 16px; font-weight: 600;">${income.total} ETH</p>
                    </div>
                    <div>
                        <p class="stat-label" style="font-size: 11px;">From Attestations</p>
                        <p style="color: var(--text-primary); font-size: 16px; font-weight: 600;">${income.attestations} ETH</p>
                    </div>
                    <div>
                        <p class="stat-label" style="font-size: 11px;">From Proposals</p>
                        <p style="color: var(--text-primary); font-size: 16px; font-weight: 600;">${income.proposals} ETH</p>
                    </div>
                    <div>
                        <p class="stat-label" style="font-size: 11px;">Sync Committee</p>
                        <p style="color: var(--text-primary); font-size: 16px; font-weight: 600;">${income.syncCommittee} ETH</p>
                    </div>
                </div>
            `;
        } else {
            incomeContainer.innerHTML = `<p style="color: var(--text-muted);">Unable to fetch income data</p>`;
        }
    } catch (error) {
        console.error('Error fetching income:', error);
        document.getElementById('incomeData').innerHTML = `<p style="color: var(--danger-color);">Error loading income data</p>`;
    }

    // Fetch attestation performance data
    try {
        const attestResult = await window.electronAPI.fetchValidatorAttestations(validator.index);
        const attestContainer = document.getElementById('attestationData');
        
        if (attestResult.success && attestResult.data) {
            const attest = attestResult.data;
            const missRate = parseFloat(attest.missRate);
            
            // Determine alert level
            let alertBadge = '';
            let alertColor = 'var(--success-color)';
            if (missRate >= 2) {
                alertBadge = '<span style="background: var(--danger-color); color: white; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; margin-left: 8px;">⚠️ HIGH MISS RATE</span>';
                alertColor = 'var(--danger-color)';
            } else if (missRate >= 1) {
                alertBadge = '<span style="background: var(--warning-color); color: white; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; margin-left: 8px;">⚠️ ATTENTION NEEDED</span>';
                alertColor = 'var(--warning-color)';
            } else if (missRate > 0) {
                alertBadge = '<span style="background: var(--success-color); color: white; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; margin-left: 8px;">✓ EXCELLENT</span>';
            }
            
            attestContainer.innerHTML = `
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px;">
                    <div>
                        <p class="stat-label" style="font-size: 11px;">Miss Rate ${alertBadge}</p>
                        <p style="color: ${alertColor}; font-size: 20px; font-weight: 700;">${attest.missRate}%</p>
                    </div>
                    <div>
                        <p class="stat-label" style="font-size: 11px;">Successful / Missed</p>
                        <p style="color: var(--text-primary); font-size: 16px; font-weight: 600;">${attest.successful} / <span style="color: var(--danger-color);">${attest.missed}</span></p>
                    </div>
                    <div>
                        <p class="stat-label" style="font-size: 11px;">Total Attestations</p>
                        <p style="color: var(--text-primary); font-size: 16px; font-weight: 600;">${attest.total}</p>
                    </div>
                    <div>
                        <p class="stat-label" style="font-size: 11px;">Last Missed</p>
                        <p style="color: var(--text-secondary); font-size: 16px; font-weight: 600;">${attest.lastMissed}</p>
                    </div>
                </div>
                ${attest.recent && attest.recent.length > 0 ? `
                    <div style="margin-top: 12px;">
                        <p class="stat-label" style="font-size: 11px; margin-bottom: 8px;">Recent Activity (Last 20)</p>
                        <div style="display: flex; gap: 3px; flex-wrap: wrap;">
                            ${attest.recent.map(att => `
                                <div style="width: 12px; height: 12px; border-radius: 2px; background: ${att.status === 'success' ? 'var(--success-color)' : 'var(--danger-color)'};" title="Epoch ${att.epoch}: ${att.status}"></div>
                            `).join('')}
                        </div>
                        <p style="font-size: 10px; color: var(--text-muted); margin-top: 6px;">Green = Success, Red = Missed</p>
                    </div>
                ` : ''}
            `;
        } else {
            attestContainer.innerHTML = `<p style="color: var(--text-muted);">Unable to fetch attestation data</p>`;
        }
    } catch (error) {
        console.error('Error fetching attestations:', error);
        document.getElementById('attestationData').innerHTML = `<p style="color: var(--danger-color);">Error loading attestation data</p>`;
    }

    // Fetch proposal history data
    try {
        const proposalResult = await window.electronAPI.fetchValidatorProposals(validator.index);
        const proposalContainer = document.getElementById('proposalData');
        
        if (proposalResult.success && proposalResult.data) {
            const prop = proposalResult.data;
            const totalProposals = parseInt(prop.total);
            
            // Celebration badge for proposals (they're rare and valuable!)
            let celebrationBadge = '';
            if (totalProposals > 0) {
                celebrationBadge = '<span style="background: var(--warning-color); color: white; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; margin-left: 8px;">🎉 BLOCK PRODUCER</span>';
            } else {
                celebrationBadge = '<span style="background: var(--text-muted); color: white; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; margin-left: 8px;">⏳ WAITING</span>';
            }
            
            proposalContainer.innerHTML = `
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px;">
                    <div>
                        <p class="stat-label" style="font-size: 11px;">Total Proposals ${celebrationBadge}</p>
                        <p style="color: var(--warning-color); font-size: 20px; font-weight: 700;">${prop.total}</p>
                    </div>
                    <div>
                        <p class="stat-label" style="font-size: 11px;">Total Rewards</p>
                        <p style="color: var(--success-color); font-size: 16px; font-weight: 600;">${prop.totalRewards} ETH</p>
                    </div>
                    <div>
                        <p class="stat-label" style="font-size: 11px;">Avg Reward per Block</p>
                        <p style="color: var(--text-primary); font-size: 16px; font-weight: 600;">${prop.avgReward} ETH</p>
                    </div>
                    <div>
                        <p class="stat-label" style="font-size: 11px;">Last Proposal</p>
                        <p style="color: var(--text-secondary); font-size: 16px; font-weight: 600;">${prop.lastProposal}</p>
                    </div>
                </div>
                ${prop.proposals && prop.proposals.length > 0 ? `
                    <div style="margin-top: 16px; padding: 12px; background: var(--surface-elevated); border-radius: 8px;">
                        <p class="stat-label" style="font-size: 11px; margin-bottom: 8px;">Recent Proposals (Last 10)</p>
                        <div style="display: flex; flex-direction: column; gap: 6px;">
                            ${prop.proposals.map(p => `
                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; background: var(--surface); border-radius: 4px; border-left: 3px solid ${p.status === 'proposed' ? 'var(--success-color)' : 'var(--danger-color)'};">
                                    <span style="color: var(--text-secondary); font-size: 12px;">
                                        Slot ${p.slot} ${p.epoch ? `(Epoch ${p.epoch})` : ''}
                                    </span>
                                    <span style="color: var(--success-color); font-size: 12px; font-weight: 600;">
                                        +${p.reward} ETH
                                    </span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : totalProposals === 0 ? `
                    <div style="margin-top: 12px; padding: 12px; background: var(--surface-elevated); border-radius: 8px; text-align: center;">
                        <p style="color: var(--text-muted); font-size: 12px;">
                            No proposals yet. Block proposals are randomly assigned and earn ~0.05 ETH+ each!
                        </p>
                    </div>
                ` : ''}
            `;
        } else {
            proposalContainer.innerHTML = `<p style="color: var(--text-muted);">Unable to fetch proposal data</p>`;
        }
    } catch (error) {
        console.error('Error fetching proposals:', error);
        document.getElementById('proposalData').innerHTML = `<p style="color: var(--danger-color);">Error loading proposal data</p>`;
    }
}

// Remove validator by id
function removeValidator(id) {
    const index = validators.findIndex(v => v.id === id);
    if (index === -1) return;

    const validator = validators[index];
    const confirmed = confirm(`Remove validator "${validator.name}" (#${validator.index})?`);
    if (!confirmed) return;

    validators.splice(index, 1);
    window.electronAPI.saveValidators(validators).then(() => {
        renderValidatorList();
        updateDashboard();
        renderPerformanceOverview();

        const detailsContainer = document.getElementById('validatorDetails');
        if (validators.length === 0) {
            detailsContainer.innerHTML = `
                <h3>Validator Details</h3>
                <p class="text-muted">Select a validator to view details</p>
            `;
        } else {
            // Select first remaining validator
            selectValidator(validators[0].id);
        }
    });
}

// Open edit modal for a validator
function openEditValidator(id) {
    const validator = validators.find(v => v.id === id);
    if (!validator) return;

    document.getElementById('editValidatorId').value = String(id);
    document.getElementById('editValidatorName').value = validator.name || '';

    showModal('editValidatorModal');
}

// Handle edit validator save
async function handleEditValidator() {
    const id = parseInt(document.getElementById('editValidatorId').value, 10);
    const newName = document.getElementById('editValidatorName').value.trim();

    if (!newName) {
        alert('Please enter a name');
        return;
    }

    const idx = validators.findIndex(v => v.id === id);
    if (idx === -1) {
        hideModal('editValidatorModal');
        return;
    }

    validators[idx].name = newName;
    await window.electronAPI.saveValidators(validators);

    renderValidatorList();
    updateDashboard();
    renderPerformanceOverview();
    selectValidator(id);

    hideModal('editValidatorModal');
}

// Update dashboard statistics
function updateDashboard() {
    if (validators.length === 0) {
        document.getElementById('totalBalance').textContent = '0 ETH';
        document.getElementById('activeValidators').textContent = '0';
        document.getElementById('avgEffectiveness').textContent = '0%';
        document.getElementById('avgUptime').textContent = '0%';
        
        // Reset trends
        document.getElementById('balanceTrend').textContent = 'No data';
        document.getElementById('balanceTrend').className = 'stat-trend neutral';
        document.getElementById('activeValidatorsTrend').textContent = '0 offline';
        document.getElementById('activeValidatorsTrend').className = 'stat-trend neutral';
        document.getElementById('effectivenessTrend').textContent = 'No data';
        document.getElementById('effectivenessTrend').className = 'stat-trend neutral';
        document.getElementById('uptimeTrend').textContent = 'Range: 0-0%';
        document.getElementById('uptimeTrend').className = 'stat-trend neutral';
        
        previousDashboardStats = null;
        return;
    }

    // Calculate totals
    let totalBalance = 0;
    let activeCount = 0;
    let totalEffectiveness = 0;
    let totalUptime = 0;
    let minUptime = 100;
    let maxUptime = 0;
    let uptimeValues = [];

    validators.forEach(validator => {
        // Parse balance (e.g., "32.5 ETH" -> 32.5)
        const balance = parseFloat(validator.balance);
        if (!isNaN(balance)) totalBalance += balance;

        // Count all active statuses (active_ongoing, active_exiting, active_slashed)
        if (validator.status && validator.status.toLowerCase().startsWith('active')) activeCount++;

        // Parse percentages
        const effectiveness = parseFloat(validator.effectiveness);
        if (!isNaN(effectiveness)) totalEffectiveness += effectiveness;

        const uptime = parseFloat(validator.uptime);
        if (!isNaN(uptime)) {
            totalUptime += uptime;
            uptimeValues.push(uptime);
            minUptime = Math.min(minUptime, uptime);
            maxUptime = Math.max(maxUptime, uptime);
        }
    });

    const avgEffectiveness = totalEffectiveness / validators.length;
    const avgUptime = totalUptime / validators.length;
    const offlineCount = validators.length - activeCount;

    // Update main values
    document.getElementById('totalBalance').textContent = `${totalBalance.toFixed(2)} ETH`;
    document.getElementById('activeValidators').textContent = activeCount;
    document.getElementById('avgEffectiveness').textContent = `${avgEffectiveness.toFixed(1)}%`;
    document.getElementById('avgUptime').textContent = `${avgUptime.toFixed(1)}%`;

    // Calculate and display trends
    const currentStats = {
        totalBalance,
        activeCount,
        avgEffectiveness,
        avgUptime,
        minUptime,
        maxUptime,
        offlineCount,
        validatorCount: validators.length
    };

    // Balance trend - show change since last update
    const balanceTrendEl = document.getElementById('balanceTrend');
    if (previousDashboardStats && previousDashboardStats.totalBalance !== undefined) {
        const balanceChange = totalBalance - previousDashboardStats.totalBalance;
        if (Math.abs(balanceChange) < 0.0001) {
            balanceTrendEl.textContent = 'No change';
            balanceTrendEl.className = 'stat-trend neutral';
        } else if (balanceChange > 0) {
            balanceTrendEl.textContent = `+${balanceChange.toFixed(4)} ETH`;
            balanceTrendEl.className = 'stat-trend positive';
        } else {
            balanceTrendEl.textContent = `${balanceChange.toFixed(4)} ETH`;
            balanceTrendEl.className = 'stat-trend negative';
        }
    } else {
        // First load - estimate daily income (rough: ~0.00005 ETH per validator per epoch, ~225 epochs/day)
        const estimatedDailyIncome = validators.length * 0.0113; // Rough estimate: 0.0113 ETH/day per validator
        balanceTrendEl.textContent = `Est. ~${estimatedDailyIncome.toFixed(4)} ETH/day`;
        balanceTrendEl.className = 'stat-trend positive';
    }

    // Active validators trend - show offline count
    const activeValidatorsTrendEl = document.getElementById('activeValidatorsTrend');
    if (offlineCount === 0) {
        activeValidatorsTrendEl.textContent = 'All online';
        activeValidatorsTrendEl.className = 'stat-trend positive';
    } else if (offlineCount === 1) {
        activeValidatorsTrendEl.textContent = '1 offline';
        activeValidatorsTrendEl.className = 'stat-trend negative';
    } else {
        activeValidatorsTrendEl.textContent = `${offlineCount} offline`;
        activeValidatorsTrendEl.className = 'stat-trend negative';
    }

    // Effectiveness trend - show change since last update
    const effectivenessTrendEl = document.getElementById('effectivenessTrend');
    if (previousDashboardStats && previousDashboardStats.avgEffectiveness !== undefined) {
        const effectivenessChange = avgEffectiveness - previousDashboardStats.avgEffectiveness;
        if (Math.abs(effectivenessChange) < 0.05) {
            effectivenessTrendEl.textContent = 'Stable';
            effectivenessTrendEl.className = 'stat-trend neutral';
        } else if (effectivenessChange > 0) {
            effectivenessTrendEl.textContent = `+${effectivenessChange.toFixed(1)}%`;
            effectivenessTrendEl.className = 'stat-trend positive';
        } else {
            effectivenessTrendEl.textContent = `${effectivenessChange.toFixed(1)}%`;
            effectivenessTrendEl.className = 'stat-trend negative';
        }
    } else {
        // First load - show status based on current effectiveness
        if (avgEffectiveness >= 99.5) {
            effectivenessTrendEl.textContent = 'Excellent';
            effectivenessTrendEl.className = 'stat-trend positive';
        } else if (avgEffectiveness >= 98) {
            effectivenessTrendEl.textContent = 'Good';
            effectivenessTrendEl.className = 'stat-trend positive';
        } else if (avgEffectiveness >= 95) {
            effectivenessTrendEl.textContent = 'Fair';
            effectivenessTrendEl.className = 'stat-trend neutral';
        } else {
            effectivenessTrendEl.textContent = 'Needs attention';
            effectivenessTrendEl.className = 'stat-trend negative';
        }
    }

    // Uptime trend - show min-max range from REAL data
    const uptimeTrendEl = document.getElementById('uptimeTrend');
    if (uptimeValues.length > 1) {
        uptimeTrendEl.textContent = `Range: ${minUptime.toFixed(1)}-${maxUptime.toFixed(1)}%`;
        if (minUptime >= 99) {
            uptimeTrendEl.className = 'stat-trend positive';
        } else if (minUptime >= 95) {
            uptimeTrendEl.className = 'stat-trend neutral';
        } else {
            uptimeTrendEl.className = 'stat-trend negative';
        }
    } else if (uptimeValues.length === 1) {
        // Single validator - show actual uptime value
        uptimeTrendEl.textContent = `Current: ${uptimeValues[0].toFixed(1)}%`;
        if (uptimeValues[0] >= 99) {
            uptimeTrendEl.className = 'stat-trend positive';
        } else if (uptimeValues[0] >= 95) {
            uptimeTrendEl.className = 'stat-trend neutral';
        } else {
            uptimeTrendEl.className = 'stat-trend negative';
        }
    } else {
        uptimeTrendEl.textContent = 'No data';
        uptimeTrendEl.className = 'stat-trend neutral';
    }

    // Store current stats for next comparison
    previousDashboardStats = currentStats;
}

// Render compact performance overview stats
function renderPerformanceOverview() {
    const avgEffValueEl = document.getElementById('perfAvgEffectivenessValue');
    const avgEffBarEl = document.getElementById('perfAvgEffectivenessBar');
    const avgUpValueEl = document.getElementById('perfAvgUptimeValue');
    const avgUpBarEl = document.getElementById('perfAvgUptimeBar');
    const bestValValueEl = document.getElementById('perfBestValidatorValue');
    const bestValNameEl = document.getElementById('perfBestValidatorName');
    const validatorCountEl = document.getElementById('perfValidatorCount');
    const activeSummaryEl = document.getElementById('perfActiveSummary');

    if (!avgEffValueEl) return; // performance module not present

    if (!validators || validators.length === 0) {
        avgEffValueEl.textContent = '0%';
        if (avgEffBarEl) avgEffBarEl.style.width = '0%';
        avgUpValueEl.textContent = '0%';
        if (avgUpBarEl) avgUpBarEl.style.width = '0%';
        bestValValueEl.textContent = '-';
        bestValNameEl.textContent = 'No data yet';
        validatorCountEl.textContent = '0';
        activeSummaryEl.textContent = '0 active';
        return;
    }

    let totalEff = 0;
    let totalUp = 0;
    let activeCount = 0;
    let bestEff = -1;
    let bestValidator = null;

    validators.forEach(v => {
        const eff = parseFloat(v.effectiveness);
        const up = parseFloat(v.uptime);

        if (!isNaN(eff)) {
            totalEff += eff;
            if (eff > bestEff) {
                bestEff = eff;
                bestValidator = v;
            }
        }

        if (!isNaN(up)) {
            totalUp += up;
        }

        if (v.status && v.status.toLowerCase().startsWith('active')) {
            activeCount++;
        }
    });

    const avgEff = validators.length > 0 ? totalEff / validators.length : 0;
    const avgUp = validators.length > 0 ? totalUp / validators.length : 0;

    avgEffValueEl.textContent = `${avgEff.toFixed(1)}%`;
    if (avgEffBarEl) {
        avgEffBarEl.style.width = `${Math.min(100, Math.max(0, avgEff))}%`;
    }

    avgUpValueEl.textContent = `${avgUp.toFixed(1)}%`;
    if (avgUpBarEl) {
        avgUpBarEl.style.width = `${Math.min(100, Math.max(0, avgUp))}%`;
    }

    if (bestValidator && bestEff >= 0) {
        bestValValueEl.textContent = `${bestEff.toFixed(1)}%`;
        bestValNameEl.textContent = bestValidator.name || `#${bestValidator.index}`;
    } else {
        bestValValueEl.textContent = '-';
        bestValNameEl.textContent = 'No data yet';
    }

    validatorCountEl.textContent = validators.length.toString();
    activeSummaryEl.textContent = `${activeCount} active`;
}

// Theme handling
function toggleThemePreference() {
    ensureDisplaySettings();
    const newTheme = appSettings.display.theme === 'light' ? 'dark' : 'light';
    applyTheme(newTheme);
    localStorage.setItem('appSettings', JSON.stringify(appSettings));
}

function applyTheme(preferredTheme) {
    ensureDisplaySettings();
    const theme = preferredTheme === 'light' ? 'light' : 'dark';
    const root = document.documentElement;
    if (root) {
        root.setAttribute('data-theme', theme);
    }
    
    appSettings.display.theme = theme;
    
    const toggleBtn = document.getElementById('themeToggleBtn');
    if (toggleBtn) {
        toggleBtn.setAttribute('aria-pressed', theme === 'light' ? 'true' : 'false');
        toggleBtn.title = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
    }
    
    const toggleLabel = document.getElementById('themeToggleLabel');
    if (toggleLabel) {
        toggleLabel.textContent = theme === 'light' ? 'Light' : 'Dark';
    }
}

function ensureDisplaySettings() {
    if (!appSettings.display) {
        appSettings.display = {
            detailedStats: true,
            compactMode: false,
            theme: 'dark'
        };
        return;
    }
    
    if (typeof appSettings.display.detailedStats === 'undefined') {
        appSettings.display.detailedStats = true;
    }
    
    if (typeof appSettings.display.compactMode === 'undefined') {
        appSettings.display.compactMode = false;
    }
    
    if (!appSettings.display.theme) {
        appSettings.display.theme = 'dark';
    }
}

// Modal utilities
function showModal(modalId) {
    document.getElementById(modalId).style.display = 'flex';
}

function hideModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// Settings Page Functions
async function showSettingsPage() {
    // Load API key from main process
    const apiKey = await window.electronAPI.getApiKey();
    if (apiKey) {
        appSettings.apiKey = apiKey;
    }
    
    // Load current settings into UI
    document.getElementById('notifyHealthDrop').checked = appSettings.notifications.healthDrop;
    document.getElementById('healthThreshold').value = appSettings.notifications.healthThreshold;
    document.getElementById('notifyOffline').checked = appSettings.notifications.offline;
    document.getElementById('notifyProposal').checked = appSettings.notifications.proposal;
    document.getElementById('notifyMissRate').checked = appSettings.notifications.missRate;
    document.getElementById('missRateThreshold').value = appSettings.notifications.missRateThreshold;
    document.getElementById('notifyBalanceDrop').checked = appSettings.notifications.balanceDrop;
    document.getElementById('refreshInterval').value = appSettings.refreshInterval;
    document.getElementById('showDetailedStats').checked = appSettings.display.detailedStats;
    document.getElementById('compactMode').checked = appSettings.display.compactMode;
    document.getElementById('beaconchaApiKey').value = appSettings.apiKey;
    
    // Show settings page
    document.getElementById('settingsPage').style.display = 'block';
}

function hideSettingsPage() {
    document.getElementById('settingsPage').style.display = 'none';
}

async function saveSettings() {
    // Read values from UI
    appSettings.notifications.healthDrop = document.getElementById('notifyHealthDrop').checked;
    appSettings.notifications.healthThreshold = parseInt(document.getElementById('healthThreshold').value);
    appSettings.notifications.offline = document.getElementById('notifyOffline').checked;
    appSettings.notifications.proposal = document.getElementById('notifyProposal').checked;
    appSettings.notifications.missRate = document.getElementById('notifyMissRate').checked;
    appSettings.notifications.missRateThreshold = parseFloat(document.getElementById('missRateThreshold').value);
    appSettings.notifications.balanceDrop = document.getElementById('notifyBalanceDrop').checked;
    appSettings.refreshInterval = parseInt(document.getElementById('refreshInterval').value);
    appSettings.display.detailedStats = document.getElementById('showDetailedStats').checked;
    appSettings.display.compactMode = document.getElementById('compactMode').checked;
    appSettings.apiKey = document.getElementById('beaconchaApiKey').value.trim();
    
    // Save API key to main process
    await window.electronAPI.setApiKey(appSettings.apiKey);
    
    // Update refresh interval
    REFRESH_INTERVAL = appSettings.refreshInterval;
    
    // Restart auto-refresh with new interval
    stopAutoRefresh();
    startAutoRefresh();
    
    // Save to localStorage
    localStorage.setItem('appSettings', JSON.stringify(appSettings));
    
    console.log('Settings saved:', appSettings);
    
    // Show success message and close
    alert('Settings saved successfully!');
    hideSettingsPage();
}

async function resetSettings() {
    if (!confirm('Reset all settings to defaults?')) return;
    
    // Reset to defaults
    appSettings = {
        notifications: {
            healthDrop: true,
            healthThreshold: 85,
            offline: true,
            proposal: true,
            missRate: true,
            missRateThreshold: 2,
            balanceDrop: false
        },
        display: {
            detailedStats: true,
            compactMode: false,
            theme: 'dark'
        },
        refreshInterval: 300000,
        apiKey: ''
    };
    
    // Clear API key from main process
    await window.electronAPI.setApiKey('');
    
    // Update UI
    showSettingsPage();
    
    // Save
    localStorage.setItem('appSettings', JSON.stringify(appSettings));
    
    console.log('Settings reset to defaults');
    
    applyTheme('dark');
}

// Load settings from localStorage on app start
function loadSettings() {
    const saved = localStorage.getItem('appSettings');
    if (saved) {
        try {
            appSettings = JSON.parse(saved);
            ensureDisplaySettings();
            REFRESH_INTERVAL = appSettings.refreshInterval;
            console.log('Settings loaded:', appSettings);
        } catch (e) {
            console.error('Error loading settings:', e);
        }
    }
    
    ensureDisplaySettings();
}

