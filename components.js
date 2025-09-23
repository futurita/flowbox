// Simple design-system components for this project
// Exposes window.Components with render helpers

window.Components = window.Components || {};

window.Components.renderContentNavbar = function renderContentNavbar(mountId, title = 'Cover') {
    try {
        const mount = typeof mountId === 'string' ? document.getElementById(mountId) : mountId;
        if (!mount) return null;
        
        // Determine the left control group based on title
        let leftControlGroup = '';
        if (title === 'Persona') {
            leftControlGroup = `
                <div class="control-group">
                    <button class="btn btn-secondary icon-only" id="addPersonaBoardBtn" title="Add Persona Board" aria-label="Add Persona Board">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <circle cx="12" cy="12" r="9" stroke="#333" stroke-width="1.5" fill="none"/>
                            <path d="M12 8v8M8 12h8" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>
                        </svg>
                    </button>
                </div>
            `;
        } else {
            leftControlGroup = `
                <div class="control-group">
                    <button class="btn btn-secondary icon-only" id="addColumnBtn" title="Add column" aria-label="Add column">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <circle cx="12" cy="12" r="9" stroke="#333" stroke-width="1.5" fill="none"/>
                            <path d="M12 8v8M8 12h8" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>
                        </svg>
                    </button>
                </div>
            `;
        }
        
        mount.innerHTML = `
            <div class="table-controls nav-bar">
                ${leftControlGroup}
                <div class="nav-title">
                    <h2>${title}</h2>
                </div>
                <div class="control-group" style="margin-left:auto; gap: 0.5rem;">
                    <button class="btn btn-secondary icon-only" id="saveVersionBtn" title="Save version" aria-label="Save version">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" stroke="#333" stroke-width="1.5" fill="none"/>
                            <path d="M8 2v6h8V2" stroke="#333" stroke-width="1.5" fill="none"/>
                            <rect x="8" y="13" width="8" height="7" rx="1" stroke="#333" stroke-width="1.5" fill="none"/>
                        </svg>
                    </button>
                    <button class="btn btn-secondary icon-only" id="historyBtn" title="History" aria-label="History">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M3 12a9 9 0 1 0 3-6.708" stroke="#333" stroke-width="1.5" fill="none"/>
                            <path d="M3 3v5h5" stroke="#333" stroke-width="1.5" fill="none"/>
                            <path d="M12 7v6l4 2" stroke="#333" stroke-width="1.5" fill="none"/>
                        </svg>
                    </button>
                    <button class="btn btn-secondary icon-only" id="importCsvBtn" title="Import CSV" aria-label="Import CSV">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M12 21V9" stroke="#333" stroke-width="1.5"/>
                            <path d="M16 13l-4 4-4-4" stroke="#333" stroke-width="1.5" fill="none"/>
                            <rect x="4" y="3" width="16" height="6" rx="2" stroke="#333" stroke-width="1.5" fill="none"/>
                        </svg>
                    </button>
                    <input type="file" id="csvFileInput" accept=".csv,text/csv" style="display:none" />
                    <div class="export-dropdown" data-context="${title.toLowerCase()}">
                        <button class="btn btn-secondary icon-only" id="${title === 'Persona' ? 'personaExportBtn' : 'exportBtn'}" title="Export" aria-label="Export">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                <path d="M12 3v12" stroke="#333" stroke-width="1.5"/>
                                <path d="M8 7l4-4 4 4" stroke="#333" stroke-width="1.5" fill="none"/>
                                <rect x="4" y="15" width="16" height="6" rx="2" stroke="#333" stroke-width="1.5" fill="none"/>
                            </svg>
                        </button>
                        <div class="export-menu" id="${title === 'Persona' ? 'personaExportMenu' : 'exportMenu'}">
                            <button class="export-option" data-format="pdf"><span class="material-icons-outlined" style="font-size:18px; vertical-align:middle; margin-right:6px;">picture_as_pdf</span>Export as PDF</button>
                            <button class="export-option" data-format="png"><span class="material-icons-outlined" style="font-size:18px; vertical-align:middle; margin-right:6px;">image</span>Export as PNG</button>
                            <button class="export-option" data-format="jpeg"><span class="material-icons-outlined" style="font-size:18px; vertical-align:middle; margin-right:6px;">image</span>Export as JPEG</button>
                            <button class="export-option" data-format="csv">📊 Export as CSV</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        return mount.firstElementChild;
    } catch (err) {
        console.warn('Failed to render content navbar:', err);
        return null;
    }
};

window.Components.renderJourney = function renderJourney(mountId) {
    try {
        const mount = typeof mountId === 'string' ? document.getElementById(mountId) : mountId;
        if (!mount) return null;
        mount.innerHTML = `
            <div class="journey-container">
                <div class="journey-table" id="journeyTable"></div>
            </div>
        `;
        return mount.firstElementChild;
    } catch (err) {
        console.warn('Failed to render journey component:', err);
        return null;
    }
};

window.Components.renderCover = function renderCover(mountId) {
    try {
        const mount = typeof mountId === 'string' ? document.getElementById(mountId) : mountId;
        if (!mount) return null;
        mount.innerHTML = `
            <div class="cover-container" id="coverContainer">
                <div class="cover-hero" id="coverHero">
                    <input type="file" id="coverImageInput" accept="image/*" style="display: none;">
                    <div class="file-upload-area" id="coverUploadArea">
                        <div class="file-upload-content">
                            <div class="upload-icon"><span class="material-icons-outlined" aria-hidden="true">image</span></div>
                            <p>Click to upload a cover image</p>
                            <small>Supports JPG, PNG, GIF, WebP (Max 5MB)</small>
                        </div>
                    </div>
                    <div class="image-preview" id="coverImagePreview" style="display: none;">
                        <img id="coverImageEl" alt="Cover Preview">
                        <button type="button" class="hover-remove-icon" id="hoverRemoveCoverImageBtn" title="Remove image">×</button>
                    </div>
                </div>
                <div class="cover-input-card">
                    <div class="input-section">
                        <label for="coverTitle" class="input-label">title</label>
                        <input type="text" id="coverTitle" class="modern-input" placeholder="Enter your project title">
                    </div>
                    <div class="input-section">
                        <label for="coverDescription" class="input-label">description</label>
                        <textarea id="coverDescription" class="modern-textarea" rows="4" placeholder="Describe your project"></textarea>
                    </div>
                </div>
            </div>
        `;
        return mount.firstElementChild;
    } catch (err) {
        console.warn('Failed to render cover component:', err);
        return null;
    }
};


window.Components.renderFlow = function renderFlow(mountId) {
    try {
        const mount = typeof mountId === 'string' ? document.getElementById(mountId) : mountId;
        if (!mount) return null;
        
        // Load the current flow data to get the saved title
        const flowData = window.loadFlowData ? window.loadFlowData() : { title: 'Flow 1' };
        const title = flowData.title || 'Flow 1';
        
        mount.innerHTML = `
            <div class="flow-area" id="flowArea">
                <div class="flow-container" id="flowContainer">
                    <div class="flow-boards" id="flowBoards"></div>
                </div>
            </div>
        `;
        
        
        return mount.firstElementChild;
    } catch (err) {
        console.warn('Failed to render flow component:', err);
        return null;
    }
};

window.Components.renderFlowNavbar = function renderFlowNavbar(mountId, flowType = null) {
    try {
        const mount = typeof mountId === 'string' ? document.getElementById(mountId) : mountId;
        if (!mount) return null;
        
        // Determine the current flow type to show the correct title
        let flowTitle = 'Flow';
        
        // If flowType is provided directly, use it
        if (flowType) {
            if (flowType === 'as-is') {
                flowTitle = 'As-is Flow';
            } else if (flowType === 'to-be') {
                flowTitle = 'To-be Flow';
            }
        } else {
            // Fallback to DOM detection
            const activeFlowBtn = document.querySelector('[data-target="as-is-flow"].active, [data-target="to-be-flow"].active');
            if (activeFlowBtn) {
                const target = activeFlowBtn.getAttribute('data-target');
                if (target === 'as-is-flow') {
                    flowTitle = 'As-is Flow';
                } else if (target === 'to-be-flow') {
                    flowTitle = 'To-be Flow';
                }
            }
        }
        
        mount.innerHTML = `
            <div class="table-controls nav-bar" id="flowNav">
                <div class="control-group">
                    <button class="btn btn-secondary icon-only" id="flowNavAdd" title="Add flow area below" aria-label="Add flow area below">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <circle cx="12" cy="12" r="9" stroke="#333" stroke-width="1.5" fill="none"/>
                            <path d="M12 8v8M8 12h8" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>
                        </svg>
                    </button>
                </div>
                <div class="nav-title">
                    <h2>${flowTitle}</h2>
                </div>
                <div class="control-group" style="margin-left:auto; gap: 0.5rem;">
                    <button class="btn btn-secondary icon-only" id="flowNavSave" title="Save version" aria-label="Save version">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" stroke="#333" stroke-width="1.5" fill="none"/>
                            <path d="M8 2v6h8V2" stroke="#333" stroke-width="1.5" fill="none"/>
                            <rect x="8" y="13" width="8" height="7" rx="1" stroke="#333" stroke-width="1.5" fill="none"/>
                        </svg>
                    </button>
                    <button class="btn btn-secondary icon-only" id="flowNavHistory" title="History" aria-label="History">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M3 12a9 9 0 1 0 3-6.708" stroke="#333" stroke-width="1.5" fill="none"/>
                            <path d="M3 3v5h5" stroke="#333" stroke-width="1.5" fill="none"/>
                            <path d="M12 7v6l4 2" stroke="#333" stroke-width="1.5" fill="none"/>
                        </svg>
                    </button>
                    <button class="btn btn-secondary icon-only" id="flowImportBtn" title="Import JSON" aria-label="Import JSON">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M12 21V9" stroke="#333" stroke-width="1.5"/>
                            <path d="M16 13l-4 4-4-4" stroke="#333" stroke-width="1.5" fill="none"/>
                            <rect x="4" y="3" width="16" height="6" rx="2" stroke="#333" stroke-width="1.5" fill="none"/>
                        </svg>
                    </button>
                    <input type="file" id="flowImportFile" accept="application/json,.json" style="display:none" />
                    <div class="export-dropdown">
                        <button class="btn btn-secondary icon-only" id="flowExportBtn" title="Export" aria-label="Export">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                <path d="M12 3v12" stroke="#333" stroke-width="1.5"/>
                                <path d="M8 7l4-4 4 4" stroke="#333" stroke-width="1.5" fill="none"/>
                                <rect x="4" y="15" width="16" height="6" rx="2" stroke="#333" stroke-width="1.5" fill="none"/>
                            </svg>
                        </button>
                        <div class="export-menu" id="flowExportMenu">
                            <button class="export-option" data-format="pdf"><span class="material-icons-outlined" style="font-size:18px; vertical-align:middle; margin-right:6px;">picture_as_pdf</span>Export as PDF</button>
                            <button class="export-option" data-format="jpeg"><span class="material-icons-outlined" style="font-size:18px; vertical-align:middle; margin-right:6px;">image</span>Export as JPEG</button>
                            <button class="export-option" data-format="png"><span class="material-icons-outlined" style="font-size:18px; vertical-align:middle; margin-right:6px;">image</span>Export as PNG</button>
                            <button class="export-option" data-format="json">🧾 Export as JSON</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        return mount.firstElementChild;
    } catch (err) {
        console.warn('Failed to render flow navbar:', err);
        return null;
    }
};

// (removed renderRules; see data-rules.html for standalone doc)

// Legacy renderPersonas function removed - using simplified system in script.js

