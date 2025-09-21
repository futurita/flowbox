// Data storage helpers (localStorage-backed) with per-project scoping
const PROJECTS_KEY = 'jmProjects';
const CURRENT_PROJECT_KEY = 'jmCurrentProjectId';
const BASE_STORAGE_KEY = 'journeyData';
const BASE_VERSIONS_KEY = 'journeyVersions';
const BASE_CHANGES_KEY = 'journeyChanges';
const BASE_COVER_KEY = 'coverData';
const BASE_SETTINGS_KEY = 'appSettings';
const BASE_FLOW_KEY = 'userFlowData';
const BASE_FLOW_VERSIONS_KEY = 'flowVersions';
const BASE_ACTIVE_TAB_KEY = 'activeTab';

// --- Device storage helpers (export/import to JSON on disk) ---
async function exportAllAppDataToDevice() {
    try {
        const exportPayload = buildExportPayload();
        const json = JSON.stringify(exportPayload, null, 2);

        // Try File System Access API first
        if (window.showSaveFilePicker) {
            const handle = await window.showSaveFilePicker({
                suggestedName: `flowbox-data-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
                types: [{ description: 'Flowbox Data', accept: { 'application/json': ['.json'] } }]
            });
            const writable = await handle.createWritable();
            await writable.write(new Blob([json], { type: 'application/json' }));
            await writable.close();
            alert('Data saved to device.');
            return;
        }

        // Fallback: trigger download via anchor (works without HTTPS)
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `flowbox-data-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Export failed', err);
        alert('Failed to save data to device.');
    }
}

function buildExportPayload() {
    const prefixes = [
        PROJECTS_KEY,
        CURRENT_PROJECT_KEY,
        BASE_STORAGE_KEY,
        BASE_VERSIONS_KEY,
        BASE_CHANGES_KEY,
        BASE_COVER_KEY,
        BASE_SETTINGS_KEY,
        BASE_FLOW_KEY,
        BASE_FLOW_VERSIONS_KEY,
        BASE_ACTIVE_TAB_KEY
    ];
    const storage = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (prefixes.some(p => key === p || key.startsWith(p + ':'))) {
            storage[key] = localStorage.getItem(key);
        }
    }
    return {
        meta: {
            app: 'flowbox',
            version: '1.6.1',
            exportedAt: new Date().toISOString()
        },
        storage
    };
}

async function importAllAppDataFromDevice() {
    try {
        let file;
        if (window.showOpenFilePicker) {
            const [handle] = await window.showOpenFilePicker({
                multiple: false,
                types: [{ description: 'Flowbox Data', accept: { 'application/json': ['.json'] } }]
            });
            const f = await handle.getFile();
            file = f;
        } else {
            // Fallback input element
            file = await pickFileViaInput();
        }
        if (!file) return;
        const text = await file.text();
        const payload = JSON.parse(text);
        if (!payload || typeof payload !== 'object' || !payload.storage) {
            alert('Invalid data file.');
            return;
        }

        if (!confirm('Import will replace existing Flowbox data for this app. Continue?')) return;

        // Clear existing matching keys
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;
            if (key === PROJECTS_KEY || key === CURRENT_PROJECT_KEY || key.startsWith(BASE_STORAGE_KEY + ':') ||
                key.startsWith(BASE_VERSIONS_KEY + ':') || key.startsWith(BASE_CHANGES_KEY + ':') ||
                key.startsWith(BASE_COVER_KEY + ':') || key.startsWith(BASE_SETTINGS_KEY + ':') ||
                key.startsWith(BASE_FLOW_KEY + ':') || key.startsWith(BASE_FLOW_VERSIONS_KEY + ':') || key.startsWith(BASE_ACTIVE_TAB_KEY + ':')) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));

        // Write imported storage
        Object.entries(payload.storage).forEach(([k, v]) => {
            try { localStorage.setItem(k, v); } catch {}
        });

        alert('Data imported. Reloading...');
        location.reload();
    } catch (err) {
        console.error('Import failed', err);
        alert('Failed to load data from device.');
    }
}

function pickFileViaInput() {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = () => {
            resolve(input.files && input.files[0] ? input.files[0] : null);
        };
        input.click();
    });
}

// Expose for inline settings script
window.flowboxExportAllAppDataToDevice = exportAllAppDataToDevice;
window.flowboxImportAllAppDataFromDevice = importAllAppDataFromDevice;

// Prompt SW to activate immediately on updates and reload
if ('serviceWorker' in navigator) {
    try {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            // Reload to get fresh assets when a new SW takes control
            window.location.reload();
        });
        navigator.serviceWorker.ready.then((reg) => {
            if (reg && reg.active) {
                reg.active.postMessage({ type: 'SKIP_WAITING' });
            }
        }).catch(() => {});
    } catch {}
}

function generateId(prefix = 'p') {
    return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
}

function loadProjects() {
    try {
        const raw = localStorage.getItem(PROJECTS_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

function saveProjects(projects) {
    try {
        localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects || []));
        updateStorageUsage();
    } catch {}
}

function getCurrentProjectId() {
    return localStorage.getItem(CURRENT_PROJECT_KEY) || '';
}

function setCurrentProjectId(projectId) {
    if (projectId) localStorage.setItem(CURRENT_PROJECT_KEY, projectId);
}

function ensureProjectsInitialized() {
    let projects = loadProjects();
    if (!projects.length) {
        const id = generateId('proj');
        const project = { id, name: 'My First Project', createdAt: new Date().toISOString() };
        projects = [project];
        saveProjects(projects);
        setCurrentProjectId(id);
        // initialize default journey data for first project
        localStorage.setItem(getScopedKey(BASE_STORAGE_KEY, id), JSON.stringify([]));
        // initialize default cover data for first project
        localStorage.setItem(getScopedKey(BASE_COVER_KEY, id), JSON.stringify({ image: '', title: '', description: '' }));
        // initialize default flow data for first project
        localStorage.setItem(getScopedKey(BASE_FLOW_KEY, id), JSON.stringify({ nodes: [], edges: [] }));
    } else if (!getCurrentProjectId()) {
        setCurrentProjectId(projects[0].id);
    }
}

function getScopedKey(base, projectId = getCurrentProjectId()) {
    return `${base}:${projectId}`;
}

// --- Flow storage ---
function loadFlowData() {
    try {
        const raw = localStorage.getItem(getScopedKey(BASE_FLOW_KEY));
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === 'object') {
            if (!Array.isArray(parsed.sections)) parsed.sections = [];
            return parsed;
        }
        return { nodes: [], edges: [], sections: [] };
    } catch { return { nodes: [], edges: [] }; }
}

function saveFlowData(data) {
    try {
        const payload = {
            nodes: Array.isArray(data?.nodes) ? data.nodes : [],
            edges: Array.isArray(data?.edges) ? data.edges : [],
            sections: Array.isArray(data?.sections) ? data.sections : [],
            gridSize: data?.gridSize || 20,
            columnWidth: data?.columnWidth || 200,
            gridEnabled: data?.gridEnabled !== undefined ? data.gridEnabled : true
        };
        localStorage.setItem(getScopedKey(BASE_FLOW_KEY), JSON.stringify(payload));
        updateStorageUsage();
    } catch {}
}

function loadSettings() {
    try {
        const raw = localStorage.getItem(getScopedKey(BASE_SETTINGS_KEY));
        return raw ? JSON.parse(raw) : { statusActive: false, profileName: 'You' };
    } catch {
        return { statusActive: false, profileName: 'You' };
    }
}

function saveSettings(settings) {
    try {
        const current = loadSettings();
        const merged = { ...current, ...(settings || {}) };
        localStorage.setItem(getScopedKey(BASE_SETTINGS_KEY), JSON.stringify(merged));
        updateStorageUsage();
        renderSidebarBottom();
    } catch {}
}

function getDefaultCoverData() {
    return { image: '', title: '', description: '' };
}

function loadCoverData() {
    try {
        const raw = localStorage.getItem(getScopedKey(BASE_COVER_KEY));
        if (!raw) return getDefaultCoverData();
        const parsed = JSON.parse(raw);
        return {
            image: typeof parsed?.image === 'string' ? parsed.image : '',
            title: typeof parsed?.title === 'string' ? parsed.title : '',
            description: typeof parsed?.description === 'string' ? parsed.description : ''
        };
    } catch {
        return getDefaultCoverData();
    }
}

function saveCoverData(data) {
    try {
        const payload = {
            image: typeof data?.image === 'string' ? data.image : '',
            title: typeof data?.title === 'string' ? data.title : '',
            description: typeof data?.description === 'string' ? data.description : ''
        };
        localStorage.setItem(getScopedKey(BASE_COVER_KEY), JSON.stringify(payload));
        updateStorageUsage();
    } catch {}
}

function loadJourneyData() {
    try {
        const raw = localStorage.getItem(getScopedKey(BASE_STORAGE_KEY));
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
        return [];
    } catch (err) {
        console.warn('Failed to load journey data from localStorage:', err);
        return [];
    }
}

function saveJourneyData(data) {
    try {
        localStorage.setItem(getScopedKey(BASE_STORAGE_KEY), JSON.stringify(data || []));
        logChange('Data updated');
        updateStorageUsage();
    } catch (err) {
        console.warn('Failed to save journey data to localStorage:', err);
    }
}

function loadVersions() {
    try {
        const raw = localStorage.getItem(getScopedKey(BASE_VERSIONS_KEY));
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveVersions(versions) {
    try {
        localStorage.setItem(getScopedKey(BASE_VERSIONS_KEY), JSON.stringify(versions || []));
        updateStorageUsage();
    } catch {}
}

function loadChanges() {
    try {
        const raw = localStorage.getItem(getScopedKey(BASE_CHANGES_KEY));
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
}

function saveChanges(changes) {
    try {
        localStorage.setItem(getScopedKey(BASE_CHANGES_KEY), JSON.stringify(changes || []));
        updateStorageUsage();
    } catch {}
}

function logChange(action, meta = {}) {
    const changes = loadChanges();
    changes.unshift({ action, meta, at: new Date().toISOString() });
    // keep last 200
    if (changes.length > 200) changes.length = 200;
    saveChanges(changes);
}

class JourneyMap {
    constructor(options = {}) {
        this.root = options.root || document;
        this.currentEditingColumn = null;
        this.draggedElement = null;
        this.draggedColumn = null;
        this.currentImageData = null;
        this.journeyData = loadJourneyData();
        this.init();
    }

    getTable() {
        const rootEl = this.root && this.root.querySelector ? this.root : document;
        return rootEl.querySelector('.journey-table') || document.getElementById('journeyTable');
    }

    init() {
        this.renderJourneyMap();
        this.setupEventListeners();
        this.setupDragAndDrop();
        this.setupTableControls();
        this.setupHistory();
    }

    renderJourneyMap() {
        const table = this.getTable();
        table.innerHTML = '';

        // Update grid template columns dynamically
        const numColumns = this.journeyData.length;
        table.style.gridTemplateColumns = `200px repeat(${numColumns}, 200px)`;
        table.style.gridTemplateRows = 'auto auto auto auto auto auto auto'; // 7 rows: Headers, Stage, Touch Point, Image, Activities, Feelings, Mood Visual, Opportunities
        table.style.minWidth = `${200 + (numColumns * 200)}px`;


        // Create column headers for each stage
        this.journeyData.forEach((column, colIndex) => {
            const header = document.createElement('div');
            header.className = 'column-header';
            header.dataset.column = colIndex;
            header.innerHTML = `
                <div class="column-drag-handle" title="Drag to reorder column">
                    <span class="drag-icon">⋮⋮</span>
                </div>
                <div class="column-title">Stage ${colIndex + 1}</div>
                <div class="column-edit-hint" title="Click to edit column">
                    <span class="edit-icon">✏️</span>
                </div>
            `;
            header.style.gridColumn = `${colIndex + 2}`; // Headers start at column 2
            header.style.gridRow = '1'; // Headers in row 1
            header.draggable = false; // Make header not draggable by default
            header.setAttribute('tabindex', '-1'); // Make focusable for keyboard navigation
            header.setAttribute('role', 'button');
            header.setAttribute('aria-label', `Stage ${colIndex + 1} column. Click to edit or use drag handle to reorder.`);
            // Add column clarity helper classes
            if ((colIndex % 2) === 1) header.classList.add('col-odd');
            if (((colIndex + 1) % 5) === 0) header.classList.add('col-milestone');

            // Column hover -> highlight entire column
            header.addEventListener('mouseenter', () => this.highlightColumn(colIndex, true));
            header.addEventListener('mouseleave', () => this.highlightColumn(colIndex, false));
            
            // Make the drag handle draggable
            const dragHandle = header.querySelector('.column-drag-handle');
            dragHandle.draggable = true;
            
            table.appendChild(header);
        });

        // Create row labels and cells
        const rowLabels = ['Stage of Journey', 'Touch Point', 'Image', 'Activities', 'Feelings and Needs', 'Mood Visual', 'Opportunities'];
        const rowClasses = ['stage', 'touch-point', 'image', 'activities', 'feelings', 'mood-visual', 'opportunities'];

        rowLabels.forEach((label, rowIndex) => {
            // Create row label
            const rowLabel = document.createElement('div');
            rowLabel.className = `row-label ${rowClasses[rowIndex]}`;
            
            // Add edit icon to stage label row
            rowLabel.textContent = label;
            
            rowLabel.style.gridColumn = '1'; // Row labels in column 1
            rowLabel.style.gridRow = `${rowIndex + 2}`; // Row labels in rows 2-7
            table.appendChild(rowLabel);
            
            // No edit icon on Stage of Journey row label

            // Create cells for each column
            this.journeyData.forEach((column, colIndex) => {
                const cell = document.createElement('div');
                cell.className = 'table-cell';
                cell.dataset.row = rowIndex;
                cell.dataset.column = colIndex;
                cell.draggable = true;
                cell.style.gridColumn = `${colIndex + 2}`; // Content cells start at column 2
                cell.style.gridRow = `${rowIndex + 2}`; // Content cells in rows 2-7
                cell.style.position = 'relative'; // Ensure proper positioning context
                // Add column clarity helper classes (match header)
                if ((colIndex % 2) === 1) cell.classList.add('col-odd');
                if (((colIndex + 1) % 5) === 0) cell.classList.add('col-milestone');

                if (rowIndex === 0) { // Stage of Journey row
                    const stageText = column.stage || '';
                    cell.innerHTML = `<div class="cell-content stage-content">${stageText}</div>`;
                    cell.classList.add('stage-cell'); // Add specific class for stage cells
                    
                    // Apply stage color if specified
                    if (column.stageColor) {
                        cell.classList.add(`color-${column.stageColor}`);
                    }
                } else if (rowIndex === 1) { // Touch Point row
                    cell.innerHTML = `<div class="cell-content">${column.touchPoint || ''}</div>`;
                    cell.classList.add('touch-point-cell');
                } else if (rowIndex === 2) { // Image row
                    cell.innerHTML = `
                        <div class="image-cell-content">
                            ${column.image ? `<img src="${column.image}" alt="Stage ${colIndex + 1} image" class="stage-image">` : ''}
                        </div>
                    `;
                    cell.classList.add('image-cell');
                    // Add has-image class if there's already an image
                    if (column.image) {
                        cell.classList.add('has-image');
                    }
                    cell.addEventListener('click', () => this.openImageModal(colIndex));
                } else if (rowIndex === 3) { // Activities row
                    cell.innerHTML = `<div class="cell-content">${column.activities}</div>`;
                } else if (rowIndex === 4) { // Feelings row
                    cell.innerHTML = `<div class="cell-content">${column.feelings}</div>`;
                } else if (rowIndex === 5) { // Mood Visual row
                    cell.innerHTML = `
                        <div class="mood-line"></div>
                        <div class="mood-point ${column.mood}">${this.getMoodEmoji(column.mood)}</div>
                    `;
                    cell.classList.add(column.mood); // Add mood class to cell for background color
                    cell.addEventListener('click', () => this.changeMood(colIndex));
                } else if (rowIndex === 6) { // Opportunities row
                    cell.innerHTML = `<div class="cell-content">${column.opportunities}</div>`;
                }

                table.appendChild(cell);
            });
        });
        
    }

    getMoodEmoji(mood) {
        const emojis = {
            'happy': '😊',
            'sad': '😔',
            'neutral': '😐',
            'angry': '😠'
        };
        return emojis[mood] || '😐';
    }

    changeMood(columnIndex) {
        const moods = ['happy', 'sad', 'neutral', 'angry'];
        const currentMood = this.journeyData[columnIndex].mood;
        const currentIndex = moods.indexOf(currentMood);
        const nextIndex = (currentIndex + 1) % moods.length;
        const newMood = moods[nextIndex];
        
        // Update the data
        this.journeyData[columnIndex].mood = newMood;
        saveJourneyData(this.journeyData);
        logChange('Change mood', { columnIndex, mood: newMood });
        
        // Re-render the table to update the visual
        this.renderJourneyMap();
    }

    getMoodText(mood) {
        const texts = {
            'happy': '😊',
            'sad': '😔',
            'neutral': '😐'
        };
        return texts[mood] || '😐';
    }

    setupEventListeners() {
        // Column header click to edit
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('column-header') && !e.target.classList.contains('column-drag-handle') && !e.target.closest('.column-drag-handle')) {
                this.openColumnEditModal(parseInt(e.target.dataset.column));
            }
        });

        // Keyboard accessibility for column reordering
        document.addEventListener('keydown', (e) => {
            if (e.target.classList.contains('column-header')) {
                this.handleColumnKeyboardNavigation(e);
            }
        });

        // Modal close events
        document.getElementById('closeColumnModal').addEventListener('click', () => {
            this.closeColumnEditModal();
        });

        document.getElementById('cancelColumnEdit').addEventListener('click', () => {
            this.closeColumnEditModal();
        });

        // Delete column
        const deleteBtn = document.getElementById('deleteColumnBtn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                this.deleteCurrentColumn();
            });
        }

        // Form submission
        document.getElementById('columnForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveColumnEdit();
        });

        // Close modal when clicking outside
        document.getElementById('columnModal').addEventListener('click', (e) => {
            if (e.target.id === 'columnModal') {
                this.closeColumnEditModal();
            }
        });

        // Image modal events
        document.getElementById('closeImageModal').addEventListener('click', () => {
            this.closeImageModal();
        });

        document.getElementById('cancelImageEdit').addEventListener('click', () => {
            this.closeImageModal();
        });

        document.getElementById('saveImage').addEventListener('click', () => {
            this.saveImage();
        });

        // Close image modal when clicking outside
        document.getElementById('imageModal').addEventListener('click', (e) => {
            if (e.target.id === 'imageModal') {
                this.closeImageModal();
            }
        });

        // Setup file upload events
        this.setupFileUploadEvents();
        
        // Setup color picker events
        this.setupColorPickerEvents();
    }

    setupDragAndDrop() {
        const table = this.getTable();
        
        table.addEventListener('dragstart', (e) => {
            // Handle column header dragging - only when dragging from the drag handle
            if (e.target.classList.contains('column-drag-handle') || e.target.closest('.column-drag-handle')) {
                const header = e.target.closest('.column-header');
                if (header) {
                    this.draggedColumn = header;
                    this.draggedElement = null; // Clear cell dragging
                    header.classList.add('column-dragging');
                    
                    // Create column drag ghost
                    const ghost = this.createColumnGhost(header);
                    document.body.appendChild(ghost);
                    
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', header.dataset.column);
                    
                    // Add visual feedback to all cells in this column
                    this.highlightColumn(parseInt(header.dataset.column), true);
                }
            }
            // Handle cell dragging (existing functionality)
            else if (e.target.classList.contains('table-cell')) {
                this.draggedElement = e.target;
                this.draggedColumn = null; // Clear column dragging
                e.target.classList.add('dragging');
                
                // Create drag ghost
                const ghost = e.target.cloneNode(true);
                ghost.classList.add('drag-ghost');
                ghost.style.width = e.target.offsetWidth + 'px';
                ghost.style.height = e.target.offsetHeight + 'px';
                document.body.appendChild(ghost);
                
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', e.target.outerHTML);
            }
        });

        table.addEventListener('dragend', (e) => {
            // Handle column drag end
            if (e.target.classList.contains('column-drag-handle') || e.target.closest('.column-drag-handle')) {
                const header = e.target.closest('.column-header');
                if (header) {
                    header.classList.remove('column-dragging');
                    this.highlightColumn(parseInt(header.dataset.column), false);
                    this.clearColumnDropZones();
                }
            }
            // Handle cell drag end
            else if (e.target.classList.contains('table-cell')) {
                e.target.classList.remove('dragging');
            }
            
            // Remove all drag ghosts
            document.querySelectorAll('.drag-ghost, .column-drag-ghost').forEach(ghost => {
                ghost.remove();
            });
        });

        table.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            
            // Handle column dragging
            if (this.draggedColumn) {
                const targetHeader = e.target.closest('.column-header');
                if (targetHeader && targetHeader !== this.draggedColumn) {
                    this.showColumnDropZone(targetHeader);
                }
            }
            // Handle cell dragging (existing functionality)
            else if (this.draggedElement) {
            const target = e.target.closest('.table-cell');
            if (target && target !== this.draggedElement) {
                target.classList.add('drag-over');
                }
            }
        });

        table.addEventListener('dragleave', (e) => {
            // Handle cell dragging
            if (this.draggedElement) {
            const target = e.target.closest('.table-cell');
            if (target) {
                target.classList.remove('drag-over');
                }
            }
        });

        table.addEventListener('drop', (e) => {
            e.preventDefault();
            
            // Handle column drop
            if (this.draggedColumn) {
                const targetHeader = e.target.closest('.column-header');
                if (targetHeader && targetHeader !== this.draggedColumn) {
                    this.moveColumn(
                        parseInt(this.draggedColumn.dataset.column),
                        parseInt(targetHeader.dataset.column)
                    );
                }
            }
            // Handle cell drop (existing functionality)
            else if (this.draggedElement) {
            const target = e.target.closest('.table-cell');
                if (target && target !== this.draggedElement) {
                this.swapCells(this.draggedElement, target);
                }
            }
            
            // Clean up
            this.clearColumnDropZones();
            document.querySelectorAll('.table-cell').forEach(cell => {
                cell.classList.remove('drag-over');
            });
        });
    }

    swapCells(source, target) {
        const sourceRow = parseInt(source.dataset.row);
        const sourceCol = parseInt(source.dataset.column);
        const targetRow = parseInt(target.dataset.row);
        const targetCol = parseInt(target.dataset.column);

        // Swap the data
        const tempData = this.journeyData[sourceCol];
        this.journeyData[sourceCol] = this.journeyData[targetCol];
        this.journeyData[targetCol] = tempData;

        // Persist
        saveJourneyData(this.journeyData);
        logChange('Swap columns', { sourceCol, targetCol });

        // Re-render the map
        this.renderJourneyMap();
    }

    // Column dragging methods
    createColumnGhost(header) {
        const ghost = document.createElement('div');
        ghost.className = 'column-drag-ghost';
        ghost.innerHTML = `
            <div class="ghost-header">${header.querySelector('.column-title').textContent}</div>
            <div class="ghost-preview">Moving column...</div>
        `;
        ghost.style.position = 'fixed';
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '10000';
        ghost.style.opacity = '0.9';
        ghost.style.background = 'white';
        ghost.style.border = '2px solid #2196f3';
        ghost.style.borderRadius = '8px';
        ghost.style.padding = '1rem';
        ghost.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)';
        ghost.style.transform = 'rotate(2deg)';
        ghost.style.fontSize = '0.9rem';
        ghost.style.fontWeight = '600';
        ghost.style.color = '#333';
        ghost.style.minWidth = '150px';
        ghost.style.textAlign = 'center';
        
        return ghost;
    }

    highlightColumn(columnIndex, highlight) {
        const table = this.getTable();
        const cells = table.querySelectorAll(`[data-column="${columnIndex}"]`);
        const header = table.querySelector(`.column-header[data-column="${columnIndex}"]`);
        
        if (highlight) {
            // Add highlighting to all cells in the column
            cells.forEach(cell => {
                cell.classList.add('column-highlighted');
                // Force a reflow to ensure the pseudo-element is created
                cell.offsetHeight;
            });
            // Add highlighting to the header
            if (header) {
                header.classList.add('column-highlighted');
                header.offsetHeight;
            }
        } else {
            // Remove highlighting from all cells in the column
            cells.forEach(cell => {
                cell.classList.remove('column-highlighted');
            });
            // Remove highlighting from the header
            if (header) header.classList.remove('column-highlighted');
        }
    }

    showColumnDropZone(targetHeader) {
        // Clear previous drop zones
        this.clearColumnDropZones();
        
        // Add drop zone indicator
        targetHeader.classList.add('column-drop-zone');
        
        // Add simple blue line indicator between columns
        const dropIndicator = document.createElement('div');
        dropIndicator.className = 'column-drop-indicator';
        
        targetHeader.appendChild(dropIndicator);
    }

    clearColumnDropZones() {
        document.querySelectorAll('.column-drop-zone').forEach(header => {
            header.classList.remove('column-drop-zone');
        });
        document.querySelectorAll('.column-drop-indicator').forEach(indicator => {
            indicator.remove();
        });
    }

    moveColumn(fromIndex, toIndex) {
        if (fromIndex === toIndex) return;
        
        // Create a smooth animation for the move
        this.animateColumnMove(fromIndex, toIndex, () => {
            // Perform the actual data move
            const columnData = this.journeyData.splice(fromIndex, 1)[0];
            this.journeyData.splice(toIndex, 0, columnData);
            // Persist
            saveJourneyData(this.journeyData);
            logChange('Move column', { fromIndex, toIndex });
            
            // Re-render the map
            this.renderJourneyMap();
        });
    }

    animateColumnMove(fromIndex, toIndex, callback) {
        const table = this.getTable();
        const fromCells = table.querySelectorAll(`[data-column="${fromIndex}"]`);
        const toCells = table.querySelectorAll(`[data-column="${toIndex}"]`);
        
        // Add transition classes
        fromCells.forEach(cell => {
            cell.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
            cell.style.transform = 'scale(0.95)';
            cell.style.opacity = '0.7';
        });
        
        toCells.forEach(cell => {
            cell.style.transition = 'transform 0.3s ease';
            cell.style.transform = 'scale(1.05)';
        });
        
        // Execute callback after animation
        setTimeout(() => {
            callback();
        }, 300);
    }

    // Keyboard accessibility for column reordering
    handleColumnKeyboardNavigation(e) {
        const currentColumn = parseInt(e.target.dataset.column);
        let targetColumn = null;

        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                targetColumn = Math.max(0, currentColumn - 1);
                break;
            case 'ArrowRight':
                e.preventDefault();
                targetColumn = Math.min(this.journeyData.length - 1, currentColumn + 1);
                break;
            case 'Home':
                e.preventDefault();
                targetColumn = 0;
                break;
            case 'End':
                e.preventDefault();
                targetColumn = this.journeyData.length - 1;
                break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                // Toggle focus for keyboard users
                if (e.target.getAttribute('tabindex') === '0') {
                    e.target.blur();
                } else {
                    e.target.setAttribute('tabindex', '0');
                    e.target.focus();
                }
                return;
        }

        if (targetColumn !== null && targetColumn !== currentColumn) {
            this.moveColumn(currentColumn, targetColumn);
            
            // Update focus to the new position
            setTimeout(() => {
                const newHeader = document.querySelector(`.column-header[data-column="${targetColumn}"]`);
                if (newHeader) {
                    newHeader.focus();
                }
            }, 350);
        }
    }

    openColumnEditModal(columnIndex) {
        this.currentEditingColumn = columnIndex;
        this.isAddingNewColumn = false; // Ensure this is false when editing
        const column = this.journeyData[columnIndex];
        
        // Update modal title for editing
        document.querySelector('#columnModal .modal-header h3').textContent = 'Edit Column';
        
        document.getElementById('stageInput').value = column.stage;
        document.getElementById('touchPointInput').value = column.touchPoint;
        document.getElementById('activitiesInput').value = column.activities;
        document.getElementById('feelingsInput').value = column.feelings;
        document.getElementById('moodInput').value = column.mood;
        document.getElementById('opportunitiesInput').value = column.opportunities;
        
        // Set the stage color
        const colorInput = document.querySelector(`input[name="stageColor"][value="${column.stageColor || ''}"]`);
        if (colorInput) {
            colorInput.checked = true;
            // Add selected class to the color option
            colorInput.closest('.color-option').classList.add('selected');
        } else {
            // If no color is set, make sure "none" is selected
            const noneColorInput = document.querySelector(`input[name="stageColor"][value=""]`);
            if (noneColorInput) {
                noneColorInput.checked = true;
                noneColorInput.closest('.color-option').classList.add('selected');
            }
        }
        
        // Remove selected class from all other options
        document.querySelectorAll('.color-option').forEach(option => {
            if (!option.querySelector('input[type="radio"]:checked')) {
                option.classList.remove('selected');
            }
        });
        
        document.getElementById('columnModal').classList.add('show');

        // Enable delete button in edit mode
        const deleteBtn = document.getElementById('deleteColumnBtn');
        if (deleteBtn) deleteBtn.disabled = false;
    }

    closeColumnEditModal() {
        document.getElementById('columnModal').classList.remove('show');
        this.currentEditingColumn = null;
        this.isAddingNewColumn = false;
        
        // Reset the form
        document.getElementById('columnForm').reset();
        
        // Reset modal title
        document.querySelector('#columnModal .modal-header h3').textContent = 'Edit Column';
    }

    saveColumnEdit() {
        // Handle adding a new column
        if (this.isAddingNewColumn) {
            const newColumn = {
                stage: document.getElementById('stageInput').value.trim(),
                touchPoint: document.getElementById('touchPointInput').value.trim(),
                activities: document.getElementById('activitiesInput').value,
                feelings: document.getElementById('feelingsInput').value,
                mood: document.getElementById('moodInput').value,
                opportunities: document.getElementById('opportunitiesInput').value,
                stageColor: '',
                image: ""
            };
            
            // Get the selected stage color
            const selectedColor = document.querySelector('input[name="stageColor"]:checked');
            newColumn.stageColor = selectedColor ? selectedColor.value : '';
            
            // Add the new column to the data
            this.journeyData.push(newColumn);
            this.isAddingNewColumn = false;
            // Persist
            saveJourneyData(this.journeyData);
            logChange('Add column', { index: this.journeyData.length - 1 });
            
            // Re-render the map
            this.renderJourneyMap();
            
            // Auto-scroll to the new column
            this.scrollToNewColumn();
            
            this.closeColumnEditModal();
            return;
        }
        
        // Handle editing existing column
        if (this.currentEditingColumn === null) return;
        
        const column = this.journeyData[this.currentEditingColumn];
        column.stage = document.getElementById('stageInput').value.trim();
        column.touchPoint = document.getElementById('touchPointInput').value.trim();
        column.activities = document.getElementById('activitiesInput').value;
        column.feelings = document.getElementById('feelingsInput').value;
        column.mood = document.getElementById('moodInput').value;
        column.opportunities = document.getElementById('opportunitiesInput').value;
        
        // Get the selected stage color
        const selectedColor = document.querySelector('input[name="stageColor"]:checked');
        column.stageColor = selectedColor ? selectedColor.value : '';
        
        // Ensure we have a valid color value
        if (!column.stageColor) {
            column.stageColor = '';
        }
        // Persist
        saveJourneyData(this.journeyData);
        logChange('Edit column', { index: this.currentEditingColumn });
        
        this.renderJourneyMap();
        this.closeColumnEditModal();
    }

    scrollToNewColumn() {
        // Get the last column index (the newly added column)
        const newColumnIndex = this.journeyData.length - 1;
        
        // Find the new column header
        const newColumnHeader = document.querySelector(`.column-header[data-column="${newColumnIndex}"]`);
        
        if (newColumnHeader) {
            // Get the journey container for scrolling
            const journeyContainer = document.querySelector('.journey-container');
            
            // Calculate the scroll position to center the new column
            const containerRect = journeyContainer.getBoundingClientRect();
            const headerRect = newColumnHeader.getBoundingClientRect();
            
            // Calculate the scroll position needed to center the new column
            const scrollLeft = journeyContainer.scrollLeft + (headerRect.left - containerRect.left) - (containerRect.width / 2) + (headerRect.width / 2);
            
            // Smooth scroll to the new column
            journeyContainer.scrollTo({
                left: Math.max(0, scrollLeft),
                behavior: 'smooth'
            });
            
            // Add a subtle highlight effect to the new column
            setTimeout(() => {
                this.highlightNewColumn(newColumnIndex);
            }, 500); // Wait for scroll to complete
        }
    }

    highlightNewColumn(columnIndex) {
        const table = this.getTable();
        const cells = table.querySelectorAll(`[data-column="${columnIndex}"]`);
        const header = table.querySelector(`.column-header[data-column="${columnIndex}"]`);
        
        // Add highlight class to all cells in the new column
        cells.forEach(cell => {
            cell.classList.add('new-column-highlight');
        });
        if (header) {
            header.classList.add('new-column-highlight');
        }
        
        // Remove highlight after 2 seconds
        setTimeout(() => {
            cells.forEach(cell => {
                cell.classList.remove('new-column-highlight');
            });
            if (header) {
                header.classList.remove('new-column-highlight');
            }
        }, 2000);
    }

    openImageModal(columnIndex) {
        this.currentEditingColumn = columnIndex;
        const column = this.journeyData[columnIndex];
        
        // Reset the modal state
        this.resetImageModal();
        
        // If there's an existing image, show it
        if (column.image) {
            this.showImagePreview(column.image);
        }
        
        document.getElementById('imageModal').classList.add('show');
    }

    closeImageModal() {
        document.getElementById('imageModal').classList.remove('show');
        this.currentEditingColumn = null;
    }

    saveImage() {
        if (this.currentEditingColumn === null) return;
        
        const fileInput = document.getElementById('imageFileInput');
        const column = this.journeyData[this.currentEditingColumn];
        
        if (this.currentImageData) {
            // Use existing image data (already compressed if came from preview)
            column.image = this.currentImageData;
            saveJourneyData(this.journeyData);
            this.renderJourneyMap();
            this.closeImageModal();
        } else if (fileInput.files && fileInput.files[0]) {
            // Compress then save; fallback to original if compression fails
            this.compressImageFile(fileInput.files[0], { maxWidth: 1000, maxHeight: 1000, quality: 0.8, format: 'image/jpeg' })
                .then((base64) => {
                    column.image = base64;
                    saveJourneyData(this.journeyData);
                    logChange('Save image', { index: this.currentEditingColumn, compressed: true });
                    this.renderJourneyMap();
                    this.closeImageModal();
                })
                .catch(() => {
                    this.convertFileToBase64(fileInput.files[0], (base64) => {
                        column.image = base64;
                        saveJourneyData(this.journeyData);
                        logChange('Save image', { index: this.currentEditingColumn, compressed: false });
                        this.renderJourneyMap();
                        this.closeImageModal();
                    });
                });
        }
    }

    setupHistory() {
        const saveBtn = document.getElementById('saveVersionBtn');
        const historyBtn = document.getElementById('historyBtn');
        const modal = document.getElementById('historyModal');
        const close1 = document.getElementById('closeHistoryModal');
        const close2 = document.getElementById('closeHistory');

        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveVersion());
        }
        if (historyBtn) {
            historyBtn.addEventListener('click', () => this.openHistory());
        }
        if (modal) {
            close1 && close1.addEventListener('click', () => modal.classList.remove('show'));
            close2 && close2.addEventListener('click', () => modal.classList.remove('show'));
            modal.addEventListener('click', (e) => {
                if (e.target.id === 'historyModal') modal.classList.remove('show');
            });
        }
    }

    saveVersion() {
        const versions = loadVersions();
        const snapshot = JSON.parse(JSON.stringify(this.journeyData));
        const stamp = new Date().toISOString();
        const id = `${stamp}`;
        versions.unshift({ id, name: `Version ${versions.length + 1}`, at: stamp, data: snapshot });
        // Keep last 50 versions
        if (versions.length > 50) versions.length = 50;
        saveVersions(versions);
        logChange('Save version', { id });
        this.showSuccessToast('Journey saved successfully!');
    }

    showSuccessToast(message) {
        // Remove any existing toast
        const existingToast = document.querySelector('.success-toast');
        if (existingToast) {
            existingToast.remove();
        }
        
        // Create new toast
        const toast = document.createElement('div');
        toast.className = 'success-toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        
        // Trigger animation
        setTimeout(() => {
            toast.classList.add('show');
        }, 10);
        
        // Auto-remove after 3 seconds
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 3000);
    }

    openHistory() {
        const versions = loadVersions();
        const versionsList = document.getElementById('versionsList');
        const modal = document.getElementById('historyModal');
        if (!versionsList || !modal) return;

        versionsList.innerHTML = '';

        versions.forEach((v, idx) => {
            const item = document.createElement('div');
            item.style.display = 'flex';
            item.style.justifyContent = 'space-between';
            item.style.alignItems = 'center';
            item.style.border = '1px solid #eee';
            item.style.borderRadius = '8px';
            item.style.padding = '0.5rem 0.75rem';
            item.style.background = '#fff';
            item.innerHTML = `<div><strong>${v.name}</strong><br><small>${new Date(v.at).toLocaleString()}</small></div>`;

            const actions = document.createElement('div');
            const openBtn = document.createElement('button');
            openBtn.className = 'btn btn-primary';
            openBtn.textContent = 'Open';
            openBtn.addEventListener('click', () => this.openVersionPreview(v));
            actions.appendChild(openBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn btn-secondary';
            deleteBtn.style.marginLeft = '0.5rem';
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', () => this.deleteVersion(v.id));
            actions.appendChild(deleteBtn);

            item.appendChild(actions);
            versionsList.appendChild(item);
        });

        modal.classList.add('show');
    }

    deleteVersion(versionId) {
        if (!versionId) return;
        const confirmDelete = confirm('Delete this saved version? This cannot be undone.');
        if (!confirmDelete) return;
        const versions = loadVersions().filter(v => v.id !== versionId);
        saveVersions(versions);
        logChange('Delete version', { id: versionId });
        this.openHistory();
        this.toast('Version deleted');
    }

    restoreVersion(version) {
        if (!version) return;
        this.journeyData = JSON.parse(JSON.stringify(version.data));
        saveJourneyData(this.journeyData);
        logChange('Restore version', { id: version.id });
        this.renderJourneyMap();
        this.toast('Version restored');
    }

    openVersionPreview(version) {
        if (!version) return;
        // Load snapshot into main view and persist as current
        this.journeyData = JSON.parse(JSON.stringify(version.data || []));
        saveJourneyData(this.journeyData);
        logChange('Load version', { id: version.id });
        this.renderJourneyMap();
        // Close history modal if open
        const historyModal = document.getElementById('historyModal');
        if (historyModal) historyModal.classList.remove('show');
        this.toast('Version loaded');
    }

    toast(message) {
        const el = document.createElement('div');
        el.textContent = message;
        el.style.position = 'fixed';
        el.style.top = '12px';
        el.style.right = '12px';
        el.style.padding = '8px 12px';
        el.style.background = 'rgba(33, 150, 243, 0.9)';
        el.style.color = '#fff';
        el.style.borderRadius = '6px';
        el.style.zIndex = '2000';
        document.body.appendChild(el);
        setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1800);
    }

    resetImageModal() {
        const fileInput = document.getElementById('imageFileInput');
        const fileUploadArea = document.getElementById('fileUploadArea');
        const imagePreview = document.getElementById('imagePreview');
        const saveBtn = document.getElementById('saveImage');
        
        fileInput.value = '';
        fileUploadArea.style.display = 'block';
        imagePreview.style.display = 'none';
        saveBtn.disabled = true;
        this.currentImageData = null;
    }

    showImagePreview(imageData) {
        const fileUploadArea = document.getElementById('fileUploadArea');
        const imagePreview = document.getElementById('imagePreview');
        const previewImg = document.getElementById('previewImg');
        const saveBtn = document.getElementById('saveImage');
        
        fileUploadArea.style.display = 'none';
        imagePreview.style.display = 'block';
        previewImg.src = imageData;
        saveBtn.disabled = false;
        this.currentImageData = imageData;
    }

    convertFileToBase64(file, callback) {
        const reader = new FileReader();
        reader.onload = function(e) {
            callback(e.target.result);
        };
        reader.readAsDataURL(file);
    }

    // Compress image using canvas to reduce storage size
    // Options: maxWidth/maxHeight to constrain dimensions, quality (0-1), and output format
    compressImageFile(file, { maxWidth = 1000, maxHeight = 1000, quality = 0.8, format = 'image/jpeg' } = {}) {
        return new Promise((resolve, reject) => {
            try {
                const reader = new FileReader();
                reader.onload = () => {
                    const img = new Image();
                    img.onload = () => {
                        let targetWidth = img.width;
                        let targetHeight = img.height;
                        const widthRatio = maxWidth / targetWidth;
                        const heightRatio = maxHeight / targetHeight;
                        const ratio = Math.min(1, widthRatio, heightRatio);
                        targetWidth = Math.round(targetWidth * ratio);
                        targetHeight = Math.round(targetHeight * ratio);

                        const canvas = document.createElement('canvas');
                        canvas.width = targetWidth;
                        canvas.height = targetHeight;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

                        const dataUrl = canvas.toDataURL(format, quality);
                        resolve(dataUrl);
                    };
                    img.onerror = () => reject(new Error('Failed to load image for compression'));
                    img.src = reader.result;
                };
                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.readAsDataURL(file);
            } catch (err) {
                reject(err);
            }
        });
    }

    validateImageFile(file) {
        const maxSize = 5 * 1024 * 1024; // 5MB
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
        
        if (!allowedTypes.includes(file.type)) {
            alert('Please select a valid image file (JPG, PNG, GIF, or WebP).');
            return false;
        }
        
        if (file.size > maxSize) {
            alert('File size must be less than 5MB.');
            return false;
        }
        
        return true;
    }

    setupFileUploadEvents() {
        const fileInput = document.getElementById('imageFileInput');
        const fileUploadArea = document.getElementById('fileUploadArea');
        const removeBtn = document.getElementById('removeImageBtn');
        const saveBtn = document.getElementById('saveImage');

        // Click to open file dialog
        fileUploadArea.addEventListener('click', () => {
            fileInput.click();
        });

        // File input change
        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                const file = e.target.files[0];
                if (this.validateImageFile(file)) {
                    this.compressImageFile(file, { maxWidth: 1000, maxHeight: 1000, quality: 0.8, format: 'image/jpeg' })
                        .then((base64) => {
                            this.showImagePreview(base64);
                        })
                        .catch(() => {
                            this.convertFileToBase64(file, (base64) => {
                                this.showImagePreview(base64);
                            });
                        });
                } else {
                    fileInput.value = '';
                }
            }
        });

        // Drag and drop
        fileUploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            fileUploadArea.classList.add('dragover');
        });

        fileUploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            fileUploadArea.classList.remove('dragover');
        });

        fileUploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            fileUploadArea.classList.remove('dragover');
            
            const files = e.dataTransfer.files;
            if (files && files[0]) {
                const file = files[0];
                if (this.validateImageFile(file)) {
                    fileInput.files = files;
                    this.compressImageFile(file, { maxWidth: 1000, maxHeight: 1000, quality: 0.8, format: 'image/jpeg' })
                        .then((base64) => {
                            this.showImagePreview(base64);
                        })
                        .catch(() => {
                            this.convertFileToBase64(file, (base64) => {
                                this.showImagePreview(base64);
                            });
                        });
                }
            }
        });

        // Remove image
        removeBtn.addEventListener('click', () => {
            // If editing an existing column, clear the image and persist
            if (this.currentEditingColumn !== null) {
                const column = this.journeyData[this.currentEditingColumn];
                if (column && column.image) {
                    column.image = '';
                    saveJourneyData(this.journeyData);
                    logChange('Remove image', { index: this.currentEditingColumn });
                    this.renderJourneyMap();
                    this.toast('Image removed');
                }
            }
            // Reset modal UI to empty state (keeps modal open)
            this.resetImageModal();
        });
    }

    setupColorPickerEvents() {
        console.log('Setting up color picker events...');
        // Add event listeners to color picker options
        const colorRadios = document.querySelectorAll('.color-option input[type="radio"]');
        console.log('Found color radios:', colorRadios.length);
        
        colorRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                console.log('Color changed to:', e.target.value);
                // Remove selected class from all options
                document.querySelectorAll('.color-option').forEach(option => {
                    option.classList.remove('selected');
                });
                
                // Add selected class to the clicked option
                if (e.target.checked) {
                    e.target.closest('.color-option').classList.add('selected');
                    console.log('Added selected class to:', e.target.value);
                }
            });
        });
    }

    setupTableControls() {
        // Add column button (guard if navbar not rendered yet)
        const addColumnBtn = document.getElementById('addColumnBtn');
        if (addColumnBtn) {
            addColumnBtn.addEventListener('click', () => {
                this.addNewColumn();
            });
        }

        // Import CSV
        const importBtn = document.getElementById('importCsvBtn');
        const csvInput = document.getElementById('csvFileInput');
        if (importBtn && csvInput) {
            importBtn.addEventListener('click', () => csvInput.click());
            csvInput.addEventListener('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                try {
                    const text = await file.text();
                    this.importFromCSV(text);
                    e.target.value = '';
                } catch (err) {
                    console.error('Failed to read CSV:', err);
                    this.toast('Failed to read CSV file');
                }
            });
        }


        // Export dropdown
        const exportBtn = document.getElementById('exportBtn');
        const exportMenu = document.getElementById('exportMenu');
        const exportDropdown = document.querySelector('.export-dropdown');

        if (exportBtn && exportDropdown) {
            exportBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                exportDropdown.classList.toggle('active');
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (exportDropdown && !exportDropdown.contains(e.target)) {
                    exportDropdown.classList.remove('active');
                }
            });

            // Export options
            if (exportMenu) {
                exportMenu.querySelectorAll('.export-option').forEach(option => {
                    option.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const format = option.getAttribute('data-format');
                        if (format) this.exportData(format);
                        exportDropdown.classList.remove('active');
                    });
                });
            }
        }
    }

    // Parse CSV text and merge into journeyData
    importFromCSV(csvText) {
        try {
            if (!csvText || typeof csvText !== 'string') {
                this.toast('Empty CSV');
                return;
            }

            const lines = csvText.split(/\r?\n/).filter(l => l.trim().length > 0);
            // Skip metadata comment lines starting with #
            const dataLines = lines.filter(l => !/^\s*#/.test(l));
            if (dataLines.length === 0) {
                this.toast('No CSV rows found');
                return;
            }
            // First non-comment line should be header
            const headerLine = dataLines[0];
            const rows = dataLines.slice(1);

            const headers = this.parseCsvLine(headerLine).map(h => h.trim().toLowerCase());
            // Expected columns
            const expected = ['stage','touch point','activities','feelings and needs','mood','opportunities'];
            const isHeaderOk = expected.every(col => headers.includes(col));
            if (!isHeaderOk) {
                this.toast('CSV headers not recognized');
                return;
            }

            const idx = (name) => headers.indexOf(name);
            const stageIdx = idx('stage');
            const touchIdx = idx('touch point');
            const actIdx = idx('activities');
            const feelIdx = idx('feelings and needs');
            const moodIdx = idx('mood');
            const oppIdx = idx('opportunities');

            const imported = [];
            for (const line of rows) {
                if (!line.trim()) continue;
                const cols = this.parseCsvLine(line);
                // Guard for short rows
                if (cols.length < headers.length) continue;
                const stage = (cols[stageIdx] || '').trim();
                if (!stage) continue; // require a stage
                const touchPoint = (cols[touchIdx] || '').trim();
                const activities = (cols[actIdx] || '').trim();
                const feelings = (cols[feelIdx] || '').trim();
                const moodRaw = (cols[moodIdx] || '').trim().toLowerCase();
                const opportunities = (cols[oppIdx] || '').trim();
                const mood = ['happy','neutral','sad','angry'].includes(moodRaw) ? moodRaw : 'neutral';
                imported.push({
                    stage,
                    touchPoint,
                    activities,
                    feelings,
                    mood,
                    opportunities,
                    stageColor: ''
                });
            }

            if (imported.length === 0) {
                this.toast('No valid rows to import');
                return;
            }

            // Replace current data with imported data
            this.journeyData = imported;
            saveJourneyData(this.journeyData);
            logChange('Import CSV', { count: imported.length });
            this.renderJourneyMap();
            this.toast(`Imported ${imported.length} columns`);
        } catch (err) {
            console.error('Error importing CSV:', err);
            alert('Error importing CSV');
        }
    }

    // Robust CSV line parser supporting quoted fields and commas
    parseCsvLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (line[i + 1] === '"') { // escaped quote
                        current += '"';
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    current += ch;
                }
            } else {
                if (ch === '"') {
                    inQuotes = true;
                } else if (ch === ',') {
                    result.push(current);
                    current = '';
                } else {
                    current += ch;
                }
            }
        }
        result.push(current);
        return result;
    }

    addNewColumn() {
        // Set up for adding a new column
        this.currentEditingColumn = null; // This will be set to the new column index after creation
        this.isAddingNewColumn = true;
        
        // Reset the form with default values
        document.getElementById('stageInput').value = `New Stage ${this.journeyData.length + 1}`;
        document.getElementById('touchPointInput').value = "";
        document.getElementById('activitiesInput').value = "";
        document.getElementById('feelingsInput').value = "";
        document.getElementById('moodInput').value = "neutral";
        document.getElementById('opportunitiesInput').value = "";
        
        // Set default color (none selected)
        const noneColorInput = document.querySelector(`input[name="stageColor"][value=""]`);
        if (noneColorInput) {
            noneColorInput.checked = true;
            // Remove selected class from all options first
            document.querySelectorAll('.color-option').forEach(option => {
                option.classList.remove('selected');
            });
            // Add selected class to none option
            noneColorInput.closest('.color-option').classList.add('selected');
        }
        
        // Update modal title
        document.querySelector('#columnModal .modal-header h3').textContent = 'Add New Column';
        
        // Show the modal
        document.getElementById('columnModal').classList.add('show');

        // Disable delete button while adding
        const deleteBtn = document.getElementById('deleteColumnBtn');
        if (deleteBtn) deleteBtn.disabled = true;
    }

    deleteCurrentColumn() {
        if (this.currentEditingColumn === null || this.isAddingNewColumn) return;
        const index = this.currentEditingColumn;
        const confirmDelete = confirm('Delete this column? This cannot be undone.');
        if (!confirmDelete) return;
        this.journeyData.splice(index, 1);
        saveJourneyData(this.journeyData);
        logChange('Delete column', { index });
        this.closeColumnEditModal();
        this.renderJourneyMap();
    }

    deleteCurrentProject() {
        const currentId = getCurrentProjectId();
        const projects = loadProjects();
        const current = projects.find(p => p.id === currentId);
        const name = current ? current.name : 'this project';
        const confirmDel = confirm(`Delete ${name}? This will remove its journey data, versions, and history.`);
        if (!confirmDel) return;
        let list = projects.filter(p => p.id !== currentId);
        saveProjects(list);
        // clear scoped storage for that project
        localStorage.removeItem(getScopedKey(BASE_STORAGE_KEY, currentId));
        localStorage.removeItem(getScopedKey(BASE_VERSIONS_KEY, currentId));
        localStorage.removeItem(getScopedKey(BASE_CHANGES_KEY, currentId));
        localStorage.removeItem(getScopedKey(BASE_COVER_KEY, currentId));
        localStorage.removeItem(getScopedKey(BASE_FLOW_KEY, currentId));
        localStorage.removeItem(getScopedKey(BASE_FLOW_VERSIONS_KEY, currentId));
        if (list.length) setCurrentProjectId(list[0].id);
        else {
            localStorage.removeItem(CURRENT_PROJECT_KEY);
            ensureProjectsInitialized();
        }
        // refresh view
        window.journey.journeyData = loadJourneyData();
        window.journey.renderJourneyMap();
        // rerender sidebar and update heading/storage
        const sidebarList = document.getElementById('projectList');
        if (sidebarList) {
            // Re-run sidebar setup render function safely by clicking addProjectBtn noop
            // Instead, call setupProjectSidebar() to rebuild
            setupProjectSidebar();
        }
        updateProjectNameHeading();
        updateStorageUsage();
        this.toast('Project deleted');
    }







    async exportData(format) {
        switch (format) {
            case 'pdf':
                await this.exportToPDF();
                break;
            case 'jpeg':
                await this.exportToJPEGAsZIP(); // Use the new ZIP method
                break;
            case 'csv':
                this.exportToCSV();
                break;
        }
    }

    async exportToPDF() {
        try {
            console.log('Starting PDF export...');
            console.log('Current journey data length:', this.journeyData.length);
            
            // Check if jsPDF is available
            if (typeof window.jspdf === 'undefined') {
                throw new Error('jsPDF library not loaded');
            }
            
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('l', 'mm', 'a4'); // landscape orientation
            
            const maxColumnsPerPage = 10;
            const totalColumns = this.journeyData.length;
            const totalPages = Math.ceil(totalColumns / maxColumnsPerPage);
            
            console.log(`Exporting ${totalColumns} columns in ${totalPages} pages`);
            
            // Always use pagination approach to ensure consistent 10-column width
            for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
                const startColumn = pageIndex * maxColumnsPerPage;
                const endColumn = Math.min(startColumn + maxColumnsPerPage, totalColumns);
                
                console.log(`Creating page ${pageIndex + 1}/${totalPages} (columns ${startColumn + 1}-${endColumn})`);
                
                // Create a temporary table element for this page
                const { container, tableElement } = await this.createPageTableElement(startColumn, endColumn, pageIndex + 1, totalPages);
                
                try {
                    // Make the table visible temporarily for html2canvas
                    container.style.position = 'absolute';
                    container.style.left = '0px';
                    container.style.top = '0px';
                    container.style.visibility = 'visible';
                    container.style.zIndex = '9999';
                    
                    // Wait a moment for the element to be rendered
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    // Capture the page table as canvas
                    console.log('Capturing canvas...');
            const canvas = await html2canvas(tableElement, {
                        scale: 1.5,
                useCORS: true,
                allowTaint: true,
                        backgroundColor: '#ffffff',
                        logging: true // Enable logging to see what's happening
            });
                    
                    console.log('Canvas captured, adding to PDF...');
                    console.log('Canvas dimensions:', canvas.width, 'x', canvas.height);
            
            const imgData = canvas.toDataURL('image/png');
            // Fit image within page with margins while preserving aspect ratio
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 10; // mm
            let imgWidth = pageWidth - (2 * margin);
            let imgHeight = (canvas.height * imgWidth) / canvas.width;

            if (imgHeight > pageHeight - (2 * margin)) {
                imgHeight = pageHeight - (2 * margin);
                imgWidth = (canvas.width * imgHeight) / canvas.height;
            }

            const x = (pageWidth - imgWidth) / 2; // center horizontally
            const y = (pageHeight - imgHeight) / 2; // center vertically

            // Add image to PDF
                    if (pageIndex > 0) {
                doc.addPage();
                    }
                    doc.addImage(imgData, 'PNG', x, y, imgWidth, imgHeight);
                    
                    console.log(`Page ${pageIndex + 1} added to PDF`);
                    
                } catch (canvasError) {
                    console.error('Error capturing canvas:', canvasError);
                    throw new Error(`Failed to capture page ${pageIndex + 1}: ${canvasError.message}`);
                } finally {
                    // Clean up the temporary element
                    if (container && container.parentNode) {
                        container.remove();
                    }
                }
            }
            
            console.log('Saving PDF...');
            // Save the PDF
            doc.save('journey-map.pdf');
            console.log('PDF export completed successfully');
            
        } catch (error) {
            console.error('Error exporting to PDF:', error);
            alert(`Error exporting to PDF: ${error.message}`);
        }
    }

    async createPageTableElement(startColumn, endColumn, pageNumber, totalPages) {
        // Create a temporary container
        const tempContainer = document.createElement('div');
        tempContainer.style.position = 'absolute';
        tempContainer.style.left = '-9999px';
        tempContainer.style.top = '0';
        tempContainer.style.visibility = 'hidden';
        document.body.appendChild(tempContainer);
        
        // Create the page table - always use 10 columns for consistent width
        const pageTable = document.createElement('div');
        pageTable.className = 'journey-table';
        pageTable.style.display = 'grid';
        pageTable.style.gridTemplateColumns = '200px repeat(10, 200px)'; // Always 10 columns
        pageTable.style.gridTemplateRows = 'auto auto auto auto auto auto auto';
        pageTable.style.minWidth = '2200px'; // Fixed width for 10 columns (200px + 10*200px)
        pageTable.style.width = 'max-content';
        pageTable.style.gap = '0';
        
        // Add page header
        const pageHeader = document.createElement('div');
        pageHeader.style.gridColumn = '1 / -1';
        pageHeader.style.gridRow = '1';
        pageHeader.style.padding = '1rem';
        pageHeader.style.textAlign = 'center';
        pageHeader.style.fontWeight = 'bold';
        pageHeader.style.fontSize = '1.2rem';
        pageHeader.style.borderBottom = '2px solid #333';
        pageHeader.style.backgroundColor = '#f8f9fa';
        pageHeader.textContent = `Journey Map - Page ${pageNumber} of ${totalPages} (Columns ${startColumn + 1}-${endColumn})`;
        pageTable.appendChild(pageHeader);
        
        // Create column headers for this page - always create 10 headers
        for (let i = 0; i < 10; i++) {
            const header = document.createElement('div');
            header.className = 'column-header';
            header.style.gridColumn = `${i + 2}`; // Start from column 2 (after row labels)
            header.style.gridRow = '2';
            
            const colIndex = startColumn + i;
            if (colIndex < endColumn && colIndex < this.journeyData.length) {
                // This column has data
                header.innerHTML = `
                    <div class="column-title">Stage ${colIndex + 1}</div>
                `;
            } else {
                // This is an empty column - make it invisible but maintain grid structure
                header.innerHTML = `
                    <div class="column-title" style="opacity: 0;">&nbsp;</div>
                `;
                header.style.visibility = 'hidden';
            }
            pageTable.appendChild(header);
        }
        
        // Create row labels and cells
        const rowLabels = ['Stage of Journey', 'Touch Point', 'Image', 'Activities', 'Feelings and Needs', 'Mood Visual', 'Opportunities'];
        const rowClasses = ['stage', 'touch-point', 'image', 'activities', 'feelings', 'mood-visual', 'opportunities'];
        
        rowLabels.forEach((label, rowIndex) => {
            // Create row label
            const rowLabel = document.createElement('div');
            rowLabel.className = `row-label ${rowClasses[rowIndex]}`;
            rowLabel.textContent = label;
            rowLabel.style.gridColumn = '1';
            rowLabel.style.gridRow = `${rowIndex + 3}`;
            
            // Apply proper styling to match the original
            rowLabel.style.background = '#fff';
            rowLabel.style.padding = '1rem';
            rowLabel.style.fontWeight = '600';
            rowLabel.style.color = '#000';
            rowLabel.style.borderRight = '1px solid #e0e0e0';
            rowLabel.style.borderBottom = '1px solid #e0e0e0';
            rowLabel.style.display = 'flex';
            rowLabel.style.alignItems = 'center';
            rowLabel.style.minHeight = '120px';
            
            pageTable.appendChild(rowLabel);
            
            // Create cells for each column in this page - always create 10 cells
            for (let i = 0; i < 10; i++) {
                const cell = document.createElement('div');
                cell.className = 'table-cell';
                cell.style.gridColumn = `${i + 2}`; // Start from column 2 (after row labels)
                cell.style.gridRow = `${rowIndex + 3}`;
                
                // Apply proper styling to match the original
                cell.style.padding = '1rem';
                cell.style.minHeight = '120px';
                cell.style.display = 'flex';
                cell.style.flexDirection = 'column';
                cell.style.gap = '0.5rem';
                cell.style.position = 'relative';
                cell.style.background = '#fff';
                cell.style.borderRight = '1px solid #e0e0e0';
                cell.style.borderBottom = '1px solid #e0e0e0';
                
                const colIndex = startColumn + i;
                if (colIndex < endColumn && colIndex < this.journeyData.length) {
                    // This cell has data
                    const column = this.journeyData[colIndex];
                    
                    if (rowIndex === 0) { // Stage of Journey row
                        const stageText = column.stage || '';
                        cell.innerHTML = `<div class="cell-content stage-content" style="flex: 1; white-space: pre-wrap; word-break: break-word; color: #000; font-weight: 600; text-align: center; padding: 0.5rem; background: transparent; border: none; position: relative; display: flex; align-items: center; justify-content: center; min-height: 2rem;">${stageText}</div>`;
                        cell.classList.add('stage-cell');
                        
                        // Apply stage color if specified
                        if (column.stageColor) {
                            cell.classList.add(`color-${column.stageColor}`);
                        }
                    } else if (rowIndex === 1) { // Touch Point row
                        cell.innerHTML = `<div class="cell-content" style="flex: 1; white-space: pre-wrap; word-break: break-word;">${column.touchPoint || ''}</div>`;
                        cell.classList.add('touch-point-cell');
                    } else if (rowIndex === 2) { // Image row
                        cell.innerHTML = `
                            <div class="image-cell-content" style="display: flex; align-items: center; justify-content: center; min-height: 80px; text-align: center; position: relative;">
                                ${column.image ? `<img src="${column.image}" alt="Stage ${colIndex + 1} image" class="stage-image" style="max-width: 100%; max-height: 80px; border: 1px solid #e0e0e0;">` : ''}
                            </div>
                        `;
                        cell.classList.add('image-cell');
                    } else if (rowIndex === 3) { // Activities row
                        cell.innerHTML = `<div class="cell-content" style="flex: 1; white-space: pre-wrap; word-break: break-word;">${column.activities}</div>`;
                    } else if (rowIndex === 4) { // Feelings row
                        cell.innerHTML = `<div class="cell-content" style="flex: 1; white-space: pre-wrap; word-break: break-word;">${column.feelings}</div>`;
                    } else if (rowIndex === 5) { // Mood Visual row
                        cell.innerHTML = `
                            <div class="mood-line" style="position: absolute; top: 50%; left: 0; right: 0; height: 1px; background: #e0e0e0; z-index: 1;"></div>
                            <div class="mood-point ${column.mood}" style="position: relative; z-index: 2; display: flex; align-items: center; justify-content: center; font-size: 48px; transition: all 0.2s ease; background: transparent; border: none; width: 100%; height: 100%;">${this.getMoodEmoji(column.mood)}</div>
                        `;
                        cell.classList.add(column.mood);
                    } else if (rowIndex === 6) { // Opportunities row
                        cell.innerHTML = `<div class="cell-content" style="flex: 1; white-space: pre-wrap; word-break: break-word;">${column.opportunities}</div>`;
                    }
                } else {
                    // This is an empty cell - make it invisible but maintain grid structure
                    cell.innerHTML = `<div class="cell-content" style="opacity: 0; flex: 1; white-space: pre-wrap; word-break: break-word;">&nbsp;</div>`;
                    cell.style.visibility = 'hidden';
                }
                
                pageTable.appendChild(cell);
            }
        });
        
        tempContainer.appendChild(pageTable);
        
        // Copy all necessary styles from the original table
        const originalTable = this.getTable();
        const computedStyle = window.getComputedStyle(originalTable);
        const styleProps = [
            'font-family', 'font-size', 'color', 'background-color',
            'border', 'border-collapse', 'border-spacing', 'line-height'
        ];
        
        styleProps.forEach(prop => {
            pageTable.style[prop] = computedStyle[prop];
        });
        
        // Ensure the table is visible and properly sized
        pageTable.style.visibility = 'visible';
        pageTable.style.opacity = '1';
        pageTable.style.position = 'static';
        pageTable.style.left = 'auto';
        pageTable.style.top = 'auto';
        
        return { container: tempContainer, tableElement: pageTable };
    }

    // Test method to debug table creation
    async testTableCreation() {
        console.log('Testing table creation...');
        const { container, tableElement } = await this.createPageTableElement(0, 3, 1, 1);
        
        // Make it visible for testing
        container.style.position = 'fixed';
        container.style.top = '10px';
        container.style.left = '10px';
        container.style.zIndex = '10000';
        container.style.visibility = 'visible';
        container.style.backgroundColor = 'white';
        container.style.border = '2px solid red';
        container.style.padding = '10px';
        
        console.log('Test table created and made visible');
        console.log('Table element:', tableElement);
        console.log('Container:', container);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (container.parentNode) {
                container.remove();
                console.log('Test table removed');
            }
        }, 5000);
    }

    // Test method specifically for JPEG export
    async testJPEGTableCreation() {
        console.log('Testing JPEG table creation...');
        const { container, tableElement } = await this.createPageTableElement(0, 3, 1, 1);
        
        // Make it visible for testing
        container.style.position = 'fixed';
        container.style.top = '10px';
        container.style.left = '10px';
        container.style.zIndex = '10000';
        container.style.visibility = 'visible';
        container.style.backgroundColor = 'white';
        container.style.border = '2px solid blue';
        container.style.padding = '10px';
        
        console.log('JPEG test table created and made visible');
        console.log('Table element:', tableElement);
        console.log('Table HTML preview:', tableElement.outerHTML.substring(0, 1000));
        
        // Test html2canvas capture
        try {
            console.log('Testing html2canvas capture...');
            const canvas = await html2canvas(tableElement, {
                scale: 1,
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#ffffff',
                logging: true
            });
            
            console.log('Canvas captured successfully:', canvas.width, 'x', canvas.height);
            
            // Create a preview image
            const previewImg = document.createElement('img');
            previewImg.src = canvas.toDataURL('image/png');
            previewImg.style.position = 'fixed';
            previewImg.style.top = '200px';
            previewImg.style.left = '10px';
            previewImg.style.border = '2px solid green';
            previewImg.style.maxWidth = '400px';
            previewImg.style.zIndex = '10001';
            document.body.appendChild(previewImg);
            
            // Auto-remove after 10 seconds
            setTimeout(() => {
                if (container.parentNode) {
                    container.remove();
                }
                if (previewImg.parentNode) {
                    previewImg.remove();
                }
                console.log('JPEG test elements removed');
            }, 10000);
            
        } catch (error) {
            console.error('Error testing html2canvas:', error);
            if (container.parentNode) {
                container.remove();
            }
        }
    }

    // Test pagination calculation
    testPaginationCalculation() {
        const maxColumnsPerPage = 10;
        const totalColumns = this.journeyData.length;
        const totalPages = Math.ceil(totalColumns / maxColumnsPerPage);
        
        console.log('=== PAGINATION TEST ===');
        console.log(`Total columns: ${totalColumns}`);
        console.log(`Max columns per page: ${maxColumnsPerPage}`);
        console.log(`Total pages: ${totalPages}`);
        console.log(`Calculation: Math.ceil(${totalColumns} / ${maxColumnsPerPage}) = ${totalPages}`);
        
        for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
            const startColumn = pageIndex * maxColumnsPerPage;
            const endColumn = Math.min(startColumn + maxColumnsPerPage, totalColumns);
            console.log(`Page ${pageIndex + 1}: columns ${startColumn + 1} to ${endColumn} (${endColumn - startColumn} columns)`);
        }
        console.log('=== END PAGINATION TEST ===');
    }

    // Simple test to verify loop execution
    testLoopExecution() {
        console.log('=== LOOP EXECUTION TEST ===');
        const totalPages = 2; // Simulate 2 pages
        
        for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
            console.log(`Loop iteration ${pageIndex + 1} of ${totalPages}`);
            console.log(`Page index: ${pageIndex}`);
            
            // Simulate download
            const filename = `test-page-${pageIndex + 1}-of-${totalPages}.jpeg`;
            console.log(`Would download: ${filename}`);
            
            if (pageIndex < totalPages - 1) {
                console.log('Would wait 2 seconds before next iteration...');
            }
        }
        console.log('=== END LOOP EXECUTION TEST ===');
    }

    // Simple test to verify download mechanism works
    testDownloadMechanism() {
        console.log('=== TESTING DOWNLOAD MECHANISM ===');
        
        // Create a simple test image
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 100;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'lightblue';
        ctx.fillRect(0, 0, 200, 100);
        ctx.fillStyle = 'black';
        ctx.font = '16px Arial';
        ctx.fillText('Test Image 1', 50, 50);
        
        // Create download link
        const link1 = document.createElement('a');
        link1.download = 'test-download-1.jpeg';
        link1.href = canvas.toDataURL('image/jpeg', 0.9);
        link1.style.display = 'none';
        document.body.appendChild(link1);
        
        console.log('Created test download 1, clicking...');
        link1.click();
        
        // Clean up
        setTimeout(() => {
            if (link1.parentNode) {
                document.body.removeChild(link1);
            }
        }, 1000);
        
        console.log('Test download 1 completed');
        console.log('=== END DOWNLOAD MECHANISM TEST ===');
    }

    // Test multiple downloads with simple images
    testMultipleDownloads() {
        console.log('=== TESTING MULTIPLE DOWNLOADS ===');
        
        for (let i = 1; i <= 3; i++) {
            setTimeout(() => {
                console.log(`Creating test download ${i}...`);
                
                // Create a simple test image
                const canvas = document.createElement('canvas');
                canvas.width = 200;
                canvas.height = 100;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = i === 1 ? 'lightblue' : i === 2 ? 'lightgreen' : 'lightcoral';
                ctx.fillRect(0, 0, 200, 100);
                ctx.fillStyle = 'black';
                ctx.font = '16px Arial';
                ctx.fillText(`Test Image ${i}`, 50, 50);
                
                // Create download link
                const link = document.createElement('a');
                link.download = `test-multiple-${i}.jpeg`;
                link.href = canvas.toDataURL('image/jpeg', 0.9);
                link.style.display = 'none';
                document.body.appendChild(link);
                
                console.log(`Clicking download ${i}...`);
                link.click();
                
                // Clean up
                setTimeout(() => {
                    if (link.parentNode) {
                        document.body.removeChild(link);
                    }
                }, 1000);
                
                console.log(`Test download ${i} completed`);
            }, i * 1000); // 1 second delay between each
        }
        
        console.log('=== END MULTIPLE DOWNLOADS TEST ===');
    }

    // Specific test for 11 columns issue
    async test11ColumnsIssue() {
        try {
            console.log('=== TESTING 11 COLUMNS ISSUE ===');
            console.log('Current journey data length:', this.journeyData.length);
            
            const maxColumnsPerPage = 10;
            const totalColumns = this.journeyData.length;
            const totalPages = Math.ceil(totalColumns / maxColumnsPerPage);
            
            console.log(`Total columns: ${totalColumns}`);
            console.log(`Total pages: ${totalPages}`);
            console.log(`Math.ceil(${totalColumns} / ${maxColumnsPerPage}) = ${totalPages}`);
            
            if (totalColumns !== 11) {
                console.log('WARNING: This test is designed for 11 columns, but you have', totalColumns, 'columns');
            }
            
            // Test page 1 (columns 1-10)
            console.log('=== TESTING PAGE 1 (columns 1-10) ===');
            const { container1, tableElement1 } = await this.createPageTableElement(0, 10, 1, totalPages);
            
            try {
                // Make visible
                container1.style.position = 'absolute';
                container1.style.left = '0px';
                container1.style.top = '0px';
                container1.style.visibility = 'visible';
                container1.style.zIndex = '9999';
                container1.style.backgroundColor = 'white';
                container1.style.border = '2px solid blue';
                container1.style.padding = '10px';
                
                await new Promise(resolve => setTimeout(resolve, 500));
                
                console.log('Page 1 table created, testing canvas capture...');
                const canvas1 = await html2canvas(tableElement1, {
                    scale: 1,
                    useCORS: true,
                    allowTaint: true,
                    backgroundColor: '#ffffff',
                    logging: true
                });
                
                console.log('Page 1 canvas captured successfully:', canvas1.width, 'x', canvas1.height);
                
                // Test download
                const link1 = document.createElement('a');
                link1.download = 'test-page-1-of-2.jpeg';
                link1.href = canvas1.toDataURL('image/jpeg', 0.9);
                link1.style.display = 'none';
                document.body.appendChild(link1);
                link1.click();
                console.log('Page 1 download triggered');
                
                setTimeout(() => {
                    if (link1.parentNode) {
                        document.body.removeChild(link1);
                    }
                }, 1000);
                
            } catch (error) {
                console.error('Error with page 1:', error);
            } finally {
                if (container1.parentNode) {
                    container1.remove();
                }
            }
            
            // Test page 2 (column 11)
            console.log('=== TESTING PAGE 2 (column 11) ===');
            const { container2, tableElement2 } = await this.createPageTableElement(10, 11, 2, totalPages);
            
            try {
                // Make visible
                container2.style.position = 'absolute';
                container2.style.left = '0px';
                container2.style.top = '200px';
                container2.style.visibility = 'visible';
                container2.style.zIndex = '9999';
                container2.style.backgroundColor = 'white';
                container2.style.border = '2px solid red';
                container2.style.padding = '10px';
                
                await new Promise(resolve => setTimeout(resolve, 500));
                
                console.log('Page 2 table created, testing canvas capture...');
                const canvas2 = await html2canvas(tableElement2, {
                    scale: 1,
                    useCORS: true,
                    allowTaint: true,
                    backgroundColor: '#ffffff',
                    logging: true
                });
                
                console.log('Page 2 canvas captured successfully:', canvas2.width, 'x', canvas2.height);
                
                // Test download
                const link2 = document.createElement('a');
                link2.download = 'test-page-2-of-2.jpeg';
                link2.href = canvas2.toDataURL('image/jpeg', 0.9);
                link2.style.display = 'none';
                document.body.appendChild(link2);
                link2.click();
                console.log('Page 2 download triggered');
                
                setTimeout(() => {
                    if (link2.parentNode) {
                        document.body.removeChild(link2);
                    }
                }, 1000);
                
            } catch (error) {
                console.error('Error with page 2:', error);
            } finally {
                if (container2.parentNode) {
                    container2.remove();
                }
            }
            
            console.log('=== END 11 COLUMNS TEST ===');
            
        } catch (error) {
            console.error('Error in 11 columns test:', error);
        }
    }

    // Simple method to just create images without auto-download
    async createJPEGImagesOnly() {
        try {
            console.log('Creating JPEG images without auto-download...');
            console.log('Current journey data length:', this.journeyData.length);
            
            const maxColumnsPerPage = 10;
            const totalColumns = this.journeyData.length;
            const totalPages = Math.ceil(totalColumns / maxColumnsPerPage);
            
            console.log(`Will create ${totalPages} JPEG images for ${totalColumns} columns`);
            
            const imageUrls = [];
            
            for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
                const startColumn = pageIndex * maxColumnsPerPage;
                const endColumn = Math.min(startColumn + maxColumnsPerPage, totalColumns);
                
                console.log(`Creating image ${pageIndex + 1}/${totalPages} (columns ${startColumn + 1}-${endColumn})`);
                
                // Create a temporary table element for this page
                const { container, tableElement } = await this.createPageTableElement(startColumn, endColumn, pageIndex + 1, totalPages);
                
                try {
                    // Make the table visible temporarily for html2canvas
                    container.style.position = 'absolute';
                    container.style.left = '0px';
                    container.style.top = '0px';
                    container.style.visibility = 'visible';
                    container.style.zIndex = '9999';
                    
                    // Wait a moment for the element to be rendered
                    await new Promise(resolve => setTimeout(resolve, 200));
                    
                    // Capture the page table as canvas
                    const canvas = await html2canvas(tableElement, {
                        scale: 2,
                        useCORS: true,
                        allowTaint: true,
                        backgroundColor: '#ffffff',
                        logging: false
                    });
                    
                    // Create image data URL
                    const filename = `journey-map-page-${pageIndex + 1}-of-${totalPages}.jpeg`;
                    const imageDataUrl = canvas.toDataURL('image/jpeg', 0.9);
                    
                    imageUrls.push({
                        filename: filename,
                        dataUrl: imageDataUrl,
                        page: pageIndex + 1,
                        totalPages: totalPages
                    });
                    
                    console.log(`Image ${pageIndex + 1} created: ${filename}`);
                    
                } catch (canvasError) {
                    console.error('Error creating image:', canvasError);
                } finally {
                    // Clean up the temporary element
                    if (container && container.parentNode) {
                        container.remove();
                    }
                }
            }
            
            console.log(`All ${totalPages} images created successfully`);
            
            // Show the images in a new window
            const newWindow = window.open('', '_blank', 'width=1200,height=800');
            if (newWindow) {
                newWindow.document.write(`
                    <html>
                        <head>
                            <title>Journey Map Images - ${totalPages} Pages</title>
                            <style>
                                body { font-family: Arial, sans-serif; margin: 20px; }
                                .image-container { margin: 20px 0; border: 1px solid #ccc; padding: 10px; }
                                .image-container h3 { margin: 0 0 10px 0; color: #333; }
                                .image-container img { max-width: 100%; border: 1px solid #ddd; }
                                .download-btn { 
                                    background: #2196f3; 
                                    color: white; 
                                    border: none; 
                                    padding: 10px 20px; 
                                    margin: 5px; 
                                    cursor: pointer; 
                                    border-radius: 4px; 
                                }
                                .download-btn:hover { background: #1976d2; }
                            </style>
                        </head>
                        <body>
                            <h1>Journey Map Export - ${totalPages} Pages</h1>
                            <p>Click the download buttons below each image to save them.</p>
                            ${imageUrls.map(img => `
                                <div class="image-container">
                                    <h3>${img.filename}</h3>
                                    <img src="${img.dataUrl}" alt="${img.filename}">
                                    <br><br>
                                    <button class="download-btn" onclick="downloadImage('${img.dataUrl}', '${img.filename}')">Download ${img.filename}</button>
                                </div>
                            `).join('')}
                            
                            <script>
                                function downloadImage(dataUrl, filename) {
                                    const link = document.createElement('a');
                                    link.download = filename;
                                    link.href = dataUrl;
                                    link.click();
                                }
                            </script>
                        </body>
                    </html>
                `);
            }
            
            return imageUrls;
            
        } catch (error) {
            console.error('Error creating JPEG images:', error);
            alert(`Error creating JPEG images: ${error.message}`);
        }
    }

    // NEW: Smart JPEG export - single JPEG for ≤10 columns, ZIP for 11+ columns
    async exportToJPEGAsZIP() {
        try {
            console.log('Starting smart JPEG export...');
            console.log('Current journey data length:', this.journeyData.length);
            
            const maxColumnsPerPage = 10;
            const totalColumns = this.journeyData.length;
            const totalPages = Math.ceil(totalColumns / maxColumnsPerPage);
            
            // If 10 columns or less, use single JPEG export
            if (totalColumns <= 10) {
                console.log(`Single page export for ${totalColumns} columns`);
                return await this.exportToJPEGSingle();
            }
            
            // For 11+ columns, use ZIP export
            console.log(`Will create ${totalPages} JPEG images in a ZIP file for ${totalColumns} columns`);
            
            if (typeof JSZip === 'undefined') {
                throw new Error('JSZip library not loaded. Please refresh the page.');
            }
            
            // Show progress
            const progressDiv = document.createElement('div');
            progressDiv.style.cssText = `
                position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                z-index: 10000; font-family: Arial, sans-serif; text-align: center;
            `;
            progressDiv.innerHTML = `
                <h3>Creating JPEG Export...</h3>
                <p>Generating ${totalPages} images...</p>
                <div id="progressBar" style="width: 300px; height: 20px; background: #f0f0f0; border-radius: 10px; margin: 10px auto; overflow: hidden;">
                    <div id="progressFill" style="width: 0%; height: 100%; background: #2196f3; transition: width 0.3s ease;"></div>
                </div>
                <p id="progressText">Starting...</p>
            `;
            document.body.appendChild(progressDiv);
            
            const progressFill = document.getElementById('progressFill');
            const progressText = document.getElementById('progressText');
            
            const zip = new JSZip();
            
            for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
                const startColumn = pageIndex * maxColumnsPerPage;
                const endColumn = Math.min(startColumn + maxColumnsPerPage, totalColumns);
                
                // Update progress
                const progress = ((pageIndex + 1) / totalPages) * 100;
                progressFill.style.width = progress + '%';
                progressText.textContent = `Creating page ${pageIndex + 1} of ${totalPages} (columns ${startColumn + 1}-${endColumn})...`;
                
                console.log(`Creating image ${pageIndex + 1}/${totalPages} (columns ${startColumn + 1}-${endColumn})`);
                
                // Create a temporary table element for this page
                const { container, tableElement } = await this.createPageTableElement(startColumn, endColumn, pageIndex + 1, totalPages);
                
                try {
                    // Make the table visible temporarily for html2canvas
                    container.style.position = 'absolute';
                    container.style.left = '0px';
                    container.style.top = '0px';
                    container.style.visibility = 'visible';
                    container.style.zIndex = '9999';
                    
                    // Wait a moment for the element to be rendered
                    await new Promise(resolve => setTimeout(resolve, 300));
                    
                    // Capture the page table as canvas
                    const canvas = await html2canvas(tableElement, {
                        scale: 2,
                        useCORS: true,
                        allowTaint: true,
                        backgroundColor: '#ffffff',
                        logging: false
                    });
                    
                    // Convert canvas to blob
                    const filename = `journey-map-page-${pageIndex + 1}-of-${totalPages}.jpeg`;
                    const blob = await new Promise(resolve => {
                        canvas.toBlob(resolve, 'image/jpeg', 0.9);
                    });
                    
                    // Add to ZIP
                    zip.file(filename, blob);
                    
                    console.log(`Image ${pageIndex + 1} added to ZIP: ${filename}`);
                    
                } catch (canvasError) {
                    console.error('Error creating image:', canvasError);
                    throw new Error(`Failed to create image for page ${pageIndex + 1}: ${canvasError.message}`);
                } finally {
                    // Clean up the temporary element
                    if (container && container.parentNode) {
                        container.remove();
                    }
                }
            }
            
            // Update progress
            progressText.textContent = 'Creating ZIP file...';
            
            // Generate ZIP file
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            
            // Download ZIP file
            const link = document.createElement('a');
            link.download = `journey-map-${totalPages}-pages.zip`;
            link.href = URL.createObjectURL(zipBlob);
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            
            // Clean up
            setTimeout(() => {
                if (link.parentNode) {
                    document.body.removeChild(link);
                }
                URL.revokeObjectURL(link.href);
            }, 1000);
            
            // Remove progress indicator
            setTimeout(() => {
                if (progressDiv.parentNode) {
                    document.body.removeChild(progressDiv);
                }
            }, 2000);
            
            console.log(`ZIP file created successfully with ${totalPages} JPEG images`);
            alert(`Success! Downloaded ZIP file with ${totalPages} JPEG images.`);
            
        } catch (error) {
            console.error('Error creating JPEG ZIP export:', error);
            alert(`Error creating JPEG export: ${error.message}`);
            
            // Remove progress indicator on error
            const progressDiv = document.querySelector('div[style*="position: fixed"]');
            if (progressDiv && progressDiv.parentNode) {
                document.body.removeChild(progressDiv);
            }
        }
    }

    // Single JPEG export for 10 columns or less
    async exportToJPEGSingle() {
        try {
            console.log('Starting single JPEG export...');
            console.log('Current journey data length:', this.journeyData.length);
            
            const totalColumns = this.journeyData.length;
            
            // Create a temporary table element for all columns
            const { container, tableElement } = await this.createPageTableElement(0, totalColumns, 1, 1);
            
            try {
                // Make the table visible temporarily for html2canvas
                container.style.position = 'absolute';
                container.style.left = '0px';
                container.style.top = '0px';
                container.style.visibility = 'visible';
                container.style.zIndex = '9999';
                
                // Wait a moment for the element to be rendered
                await new Promise(resolve => setTimeout(resolve, 300));
                
                // Capture the table as canvas
                const canvas = await html2canvas(tableElement, {
                    scale: 2,
                    useCORS: true,
                    allowTaint: true,
                    backgroundColor: '#ffffff',
                    logging: false
                });
                
                // Convert canvas to JPEG and download
                const filename = `journey-map-${totalColumns}-columns.jpeg`;
                const link = document.createElement('a');
                link.download = filename;
                link.href = canvas.toDataURL('image/jpeg', 0.9);
                link.style.display = 'none';
                document.body.appendChild(link);
                link.click();
                
                // Clean up
                setTimeout(() => {
                    if (link.parentNode) {
                        document.body.removeChild(link);
                    }
                }, 1000);
                
                console.log(`Single JPEG exported successfully: ${filename}`);
                alert(`Success! Downloaded single JPEG file: ${filename}`);
                
            } catch (canvasError) {
                console.error('Error creating single JPEG:', canvasError);
                throw new Error(`Failed to create JPEG: ${canvasError.message}`);
            } finally {
                // Clean up the temporary element
                if (container && container.parentNode) {
                    container.remove();
                }
            }
            
        } catch (error) {
            console.error('Error in single JPEG export:', error);
            alert(`Error creating JPEG: ${error.message}`);
        }
    }

    // Alternative JPEG export using window.open approach
    async exportToJPEGSimple() {
        try {
            console.log('Starting simple JPEG export...');
            console.log('Current journey data length:', this.journeyData.length);
            
            const maxColumnsPerPage = 10;
            const totalColumns = this.journeyData.length;
            const totalPages = Math.ceil(totalColumns / maxColumnsPerPage);
            
            console.log(`Will create ${totalPages} JPEG files for ${totalColumns} columns`);
            
            // Show user what will happen
            const confirmMessage = `JPEG Export: Will create ${totalPages} files\n\n${Array.from({length: totalPages}, (_, i) => {
                const startCol = i * maxColumnsPerPage + 1;
                const endCol = Math.min((i + 1) * maxColumnsPerPage, totalColumns);
                return `Page ${i + 1}: Columns ${startCol}-${endCol}`;
            }).join('\n')}\n\nClick OK to start...`;
            
            if (!confirm(confirmMessage)) {
                console.log('User cancelled export');
                return;
            }
            
            for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
                const startColumn = pageIndex * maxColumnsPerPage;
                const endColumn = Math.min(startColumn + maxColumnsPerPage, totalColumns);
                
                console.log(`=== CREATING PAGE ${pageIndex + 1}/${totalPages} ===`);
                console.log(`Columns ${startColumn + 1}-${endColumn}`);
                
                // Create a temporary table element for this page
                const { container, tableElement } = await this.createPageTableElement(startColumn, endColumn, pageIndex + 1, totalPages);
                
                try {
                    // Make the table visible temporarily for html2canvas
                    container.style.position = 'absolute';
                    container.style.left = '0px';
                    container.style.top = '0px';
                    container.style.visibility = 'visible';
                    container.style.zIndex = '9999';
                    
                    // Wait a moment for the element to be rendered
                    await new Promise(resolve => setTimeout(resolve, 200));
                    
                    // Capture the page table as canvas
                    const canvas = await html2canvas(tableElement, {
                        scale: 2,
                        useCORS: true,
                        allowTaint: true,
                        backgroundColor: '#ffffff',
                        logging: false
                    });
                    
                    // Create image data URL
                    const filename = `journey-map-page-${pageIndex + 1}-of-${totalPages}.jpeg`;
                    const imageDataUrl = canvas.toDataURL('image/jpeg', 0.9);
                    
                    console.log(`Creating download for: ${filename}`);
                    
                    // Method 1: Try direct download
                    const link = document.createElement('a');
                    link.download = filename;
                    link.href = imageDataUrl;
                    link.style.display = 'none';
                    document.body.appendChild(link);
                    link.click();
                    
                    // Method 2: Also try window.open as backup
                    setTimeout(() => {
                        const newWindow = window.open();
                        if (newWindow) {
                            newWindow.document.write(`
                                <html>
                                    <head><title>${filename}</title></head>
                                    <body style="margin:0; padding:20px; text-align:center;">
                                        <h2>${filename}</h2>
                                        <img src="${imageDataUrl}" style="max-width:100%; border:1px solid #ccc;">
                                        <br><br>
                                        <button onclick="window.print()">Print</button>
                                        <button onclick="window.close()">Close</button>
                                    </body>
                                </html>
                            `);
                        }
                    }, 500);
                    
                    // Clean up link
                    setTimeout(() => {
                        if (link.parentNode) {
                            document.body.removeChild(link);
                        }
                    }, 1000);
                    
                    console.log(`Page ${pageIndex + 1} download created`);
                    
                } catch (canvasError) {
                    console.error('Error creating page:', canvasError);
                    alert(`Error creating page ${pageIndex + 1}: ${canvasError.message}`);
                } finally {
                    // Clean up the temporary element
                    if (container && container.parentNode) {
                        container.remove();
                    }
                }
                
                // Wait between pages (except for the last one)
                if (pageIndex < totalPages - 1) {
                    console.log(`Waiting 2 seconds before next page...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
            
            console.log(`All ${totalPages} JPEG files created successfully`);
            alert(`JPEG Export Complete!\n\nCreated ${totalPages} files:\n${Array.from({length: totalPages}, (_, i) => `• journey-map-page-${i + 1}-of-${totalPages}.jpeg`).join('\n')}\n\nCheck your downloads folder and any new browser tabs.`);
            
        } catch (error) {
            console.error('Error in simple JPEG export:', error);
            alert(`Error in JPEG export: ${error.message}`);
        }
    }

    // Simulate multiple download clicks based on column count
    async simulateMultipleDownloadClicks() {
        try {
            console.log('Starting multiple download clicks simulation...');
            console.log('Current journey data length:', this.journeyData.length);
            
            const maxColumnsPerPage = 10;
            const totalColumns = this.journeyData.length;
            const totalPages = Math.ceil(totalColumns / maxColumnsPerPage);
            
            console.log(`Will simulate ${totalPages} download clicks for ${totalColumns} columns`);
            
            // Show user what will happen
            alert(`JPEG Export: Will download ${totalPages} files automatically\n\nPage 1: Columns 1-${Math.min(10, totalColumns)}\n${totalPages > 1 ? `Page 2: Columns ${Math.min(11, totalColumns)}-${totalColumns}` : ''}\n\nClick OK to start automatic downloads...`);
            
            for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
                const startColumn = pageIndex * maxColumnsPerPage;
                const endColumn = Math.min(startColumn + maxColumnsPerPage, totalColumns);
                
                console.log(`=== DOWNLOAD CLICK ${pageIndex + 1}/${totalPages} ===`);
                console.log(`Simulating download click for page ${pageIndex + 1} (columns ${startColumn + 1}-${endColumn})`);
                
                // Create a temporary table element for this page
                const { container, tableElement } = await this.createPageTableElement(startColumn, endColumn, pageIndex + 1, totalPages);
                
                try {
                    // Make the table visible temporarily for html2canvas
                    container.style.position = 'absolute';
                    container.style.left = '0px';
                    container.style.top = '0px';
                    container.style.visibility = 'visible';
                    container.style.zIndex = '9999';
                    
                    // Wait a moment for the element to be rendered
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    // Capture the page table as canvas
                    const canvas = await html2canvas(tableElement, {
                        scale: 2,
                        useCORS: true,
                        allowTaint: true,
                        backgroundColor: '#ffffff',
                        logging: false
                    });
                    
                    // Create download link
                    const filename = `journey-map-page-${pageIndex + 1}-of-${totalPages}.jpeg`;
                    const link = document.createElement('a');
                    link.download = filename;
                    link.href = canvas.toDataURL('image/jpeg', 0.9);
                    link.style.display = 'none';
                    
                    // Add to DOM and trigger download
                    document.body.appendChild(link);
                    
                    console.log(`Triggering download click ${pageIndex + 1} for: ${filename}`);
                    
                    // Simulate user click
                    link.click();
                    
                    // Clean up
                    setTimeout(() => {
                        if (link.parentNode) {
                            document.body.removeChild(link);
                        }
                    }, 1000);
                    
                    console.log(`Download click ${pageIndex + 1} completed`);
                    
                } catch (canvasError) {
                    console.error('Error in download click:', canvasError);
                    throw new Error(`Failed to process download click ${pageIndex + 1}: ${canvasError.message}`);
                } finally {
                    // Clean up the temporary element
                    if (container && container.parentNode) {
                        container.remove();
                    }
                }
                
                // Wait between download clicks (except for the last one)
                if (pageIndex < totalPages - 1) {
                    console.log(`Waiting 1 second before next download click...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
            
            console.log(`All ${totalPages} download clicks completed successfully`);
            alert(`JPEG Export Complete!\n\nDownloaded ${totalPages} files:\n${Array.from({length: totalPages}, (_, i) => `• journey-map-page-${i + 1}-of-${totalPages}.jpeg`).join('\n')}`);
            
        } catch (error) {
            console.error('Error in multiple download clicks:', error);
            alert(`Error in JPEG export: ${error.message}`);
        }
    }

    // Alternative JPEG export that creates a single ZIP file
    async exportToJPEGAsZIP() {
        try {
            console.log('Starting JPEG ZIP export...');
            console.log('Current journey data length:', this.journeyData.length);
            
            const maxColumnsPerPage = 10;
            const totalColumns = this.journeyData.length;
            const totalPages = Math.ceil(totalColumns / maxColumnsPerPage);
            
            console.log(`Exporting ${totalColumns} columns in ${totalPages} pages as ZIP`);
            
            // Check if JSZip is available
            if (typeof JSZip === 'undefined') {
                throw new Error('JSZip library not loaded. Please include JSZip library for ZIP export.');
            }
            
            const zip = new JSZip();
            
            for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
                const startColumn = pageIndex * maxColumnsPerPage;
                const endColumn = Math.min(startColumn + maxColumnsPerPage, totalColumns);
                
                console.log(`Creating ZIP page ${pageIndex + 1}/${totalPages} (columns ${startColumn + 1}-${endColumn})`);
                
                // Create a temporary table element for this page
                const { container, tableElement } = await this.createPageTableElement(startColumn, endColumn, pageIndex + 1, totalPages);
                
                try {
                    // Make the table visible temporarily for html2canvas
                    container.style.position = 'absolute';
                    container.style.left = '0px';
                    container.style.top = '0px';
                    container.style.visibility = 'visible';
                    container.style.zIndex = '9999';
                    
                    // Wait a moment for the element to be rendered
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    // Capture the page table as canvas
                    const canvas = await html2canvas(tableElement, {
                        scale: 2,
                        useCORS: true,
                        allowTaint: true,
                        backgroundColor: '#ffffff',
                        logging: false
                    });
                    
                    // Convert canvas to JPEG and add to ZIP
                    const filename = `journey-map-page-${pageIndex + 1}-of-${totalPages}.jpeg`;
                    const imageData = canvas.toDataURL('image/jpeg', 0.9);
                    
                    // Convert data URL to blob
                    const response = await fetch(imageData);
                    const blob = await response.blob();
                    
                    // Add to ZIP
                    zip.file(filename, blob);
                    console.log(`Added ${filename} to ZIP`);
                    
                } catch (canvasError) {
                    console.error('Error capturing canvas for ZIP:', canvasError);
                    throw new Error(`Failed to capture page ${pageIndex + 1}: ${canvasError.message}`);
                } finally {
                    // Clean up the temporary element
                    if (container && container.parentNode) {
                        container.remove();
                    }
                }
            }
            
            // Generate and download ZIP
            console.log('Generating ZIP file...');
            const zipBlob = await zip.generateAsync({type: 'blob'});
            
            const link = document.createElement('a');
            link.download = 'journey-map-pages.zip';
            link.href = URL.createObjectURL(zipBlob);
            link.click();
            
            console.log('ZIP export completed successfully');
            
        } catch (error) {
            console.error('Error exporting to JPEG ZIP:', error);
            alert(`Error exporting to JPEG ZIP: ${error.message}`);
        }
    }

    async exportToJPEG() {
        try {
            console.log('Starting JPEG export...');
            console.log('Current journey data length:', this.journeyData.length);
            
            const maxColumnsPerPage = 10;
            const totalColumns = this.journeyData.length;
            const totalPages = Math.ceil(totalColumns / maxColumnsPerPage);
            
            console.log(`Exporting ${totalColumns} columns in ${totalPages} pages`);
            console.log(`Max columns per page: ${maxColumnsPerPage}`);
            console.log(`Total pages calculation: Math.ceil(${totalColumns} / ${maxColumnsPerPage}) = ${totalPages}`);
            
            // Always use pagination approach to ensure consistent 10-column width
            console.log(`Starting loop: pageIndex from 0 to ${totalPages - 1}`);
            for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
                const startColumn = pageIndex * maxColumnsPerPage;
                const endColumn = Math.min(startColumn + maxColumnsPerPage, totalColumns);
                
                console.log(`=== PAGE ${pageIndex + 1}/${totalPages} ===`);
                console.log(`Page index: ${pageIndex}`);
                console.log(`Start column: ${startColumn}`);
                console.log(`End column: ${endColumn}`);
                console.log(`Columns in this page: ${endColumn - startColumn}`);
                console.log(`Creating JPEG page ${pageIndex + 1}/${totalPages} (columns ${startColumn + 1}-${endColumn})`);
                
                // Create a temporary table element for this page (same as PDF)
                const { container, tableElement } = await this.createPageTableElement(startColumn, endColumn, pageIndex + 1, totalPages);
                
                console.log('JPEG table element created:', tableElement);
                console.log('JPEG table element HTML:', tableElement.outerHTML.substring(0, 500) + '...');
                
                try {
                    // Make the table visible temporarily for html2canvas
                    container.style.position = 'absolute';
                    container.style.left = '0px';
                    container.style.top = '0px';
                    container.style.visibility = 'visible';
                    container.style.zIndex = '9999';
                    
                    // Wait a moment for the element to be rendered
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                    // Capture the page table as canvas
                    console.log('Capturing JPEG canvas...');
            const canvas = await html2canvas(tableElement, {
                scale: 2,
                useCORS: true,
                allowTaint: true,
                        backgroundColor: '#ffffff',
                        logging: false
            });
                    
                    console.log('JPEG canvas captured, creating download...');
                    console.log('Canvas dimensions:', canvas.width, 'x', canvas.height);
            
            // Convert canvas to JPEG and download
                    const filename = `journey-map-page-${pageIndex + 1}-of-${totalPages}.jpeg`;
                    console.log(`Creating download link for: ${filename}`);
                    
                    // Create download link and trigger download
            const link = document.createElement('a');
                    link.download = filename;
            link.href = canvas.toDataURL('image/jpeg', 0.9);
                    link.style.display = 'none';
                    
                    // Add to DOM temporarily
                    document.body.appendChild(link);
                    
                    console.log(`Download link created, triggering click...`);
                    
                    // Simulate a real user click
                    const clickEvent = new MouseEvent('click', {
                        view: window,
                        bubbles: true,
                        cancelable: true
                    });
                    link.dispatchEvent(clickEvent);
                    
                    // Also trigger the click method as backup
            link.click();
                    
                    // Remove from DOM after a short delay
                    setTimeout(() => {
                        if (link.parentNode) {
                            document.body.removeChild(link);
                        }
                    }, 1000);
                    
                    console.log(`JPEG page ${pageIndex + 1} download initiated`);
                    console.log(`Expected filename: ${filename}`);
                    
                } catch (canvasError) {
                    console.error('Error capturing JPEG canvas:', canvasError);
                    throw new Error(`Failed to capture JPEG page ${pageIndex + 1}: ${canvasError.message}`);
                } finally {
                    // Clean up the temporary element
                    if (container && container.parentNode) {
                        container.remove();
                    }
                }
                
                // Shorter delay between downloads to simulate rapid clicking
                if (pageIndex < totalPages - 1) {
                    console.log(`Waiting 1000ms before next download click... (page ${pageIndex + 1} of ${totalPages})`);
                    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
                    console.log(`Delay completed, triggering next download click`);
                } else {
                    console.log(`This was the last page (${pageIndex + 1} of ${totalPages}), no more downloads needed`);
                }
                
                console.log(`=== END OF PAGE ${pageIndex + 1}/${totalPages} ===`);
            }
            
            console.log('JPEG export loop completed successfully');
            console.log(`Total pages processed: ${totalPages}`);
            
        } catch (error) {
            console.error('Error exporting to JPEG:', error);
            alert(`Error exporting to JPEG: ${error.message}`);
        }
    }

    exportToCSV() {
        try {
            const headers = ['Stage', 'Touch Point', 'Activities', 'Feelings and Needs', 'Mood', 'Opportunities'];
            
            // Add metadata comment at the top
            const totalColumns = this.journeyData.length;
            const maxColumnsPerPage = 10;
            const totalPages = Math.ceil(totalColumns / maxColumnsPerPage);
            
            const metadataComment = `# Journey Map Export\n# Total Columns: ${totalColumns}\n# Recommended Pages for PDF/JPEG Export: ${totalPages} (max 10 columns per page)\n# Generated on: ${new Date().toLocaleString()}\n\n`;
            
            const csvContent = [
                metadataComment,
                headers.join(','),
                ...this.journeyData.map(column => [
                    `"${column.stage.replace(/"/g, '""')}"`,
                    `"${(column.touchPoint || '').replace(/"/g, '""')}"`,
                    `"${column.activities.replace(/"/g, '""')}"`,
                    `"${column.feelings.replace(/"/g, '""')}"`,
                    `"${column.mood}"`,
                    `"${column.opportunities.replace(/"/g, '""')}"`
                ].join(','))
            ].join('\n');
            
            // Create and download CSV file
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', 'journey-map.csv');
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            console.error('Error exporting to CSV:', error);
            alert('Error exporting to CSV. Please try again.');
        }
    }
}

// Initialize the journey map when the page loads
document.addEventListener('DOMContentLoaded', () => {
    // Initialize projects and sidebar, then render journey map for current project
    ensureProjectsInitialized();
    setupProjectSidebar();
    setupRightTocScrollEffect();
    setupProjectCollapse();
    setupProjectNameHeading();
    setupStorageUsage();
    setupTocMenu();
    setupContentNavScrollEffect();
    setupSidebarBottom();
    setupSettingsModal();
    // Render content navbar component before initializing journey
    if (window.Components && typeof window.Components.renderContentNavbar === 'function') {
        window.Components.renderContentNavbar('contentNavMount');
        // Ensure navbar scroll blur attaches after render
        setupContentNavScrollEffect();
        setTimeout(setupContentNavScrollEffect, 0);
    }
    let journeyRoot = null;
    if (window.Components && typeof window.Components.renderJourney === 'function') {
        journeyRoot = window.Components.renderJourney('journeyMount');
    }
    window.journey = new JourneyMap({ root: journeyRoot || document.getElementById('journeyMount') });
    // Render Cover
    if (window.Components && typeof window.Components.renderCover === 'function') {
        window.Components.renderCover('coverMount');
        setupCoverFeature();
    }
    // Render Flow
    if (window.Components && typeof window.Components.renderFlow === 'function') {
        window.Components.renderFlow('flowMount');
        window.flowEditor = new FlowBoards();
    }
    setupTocNavigation();
    // Initial sync of project name heading
    updateProjectNameHeading();
    updateStorageUsage();
    // Apply persisted theme on load
    try {
        const s = loadSettings();
        applyTheme(s.theme || 'oled-dark');
    } catch {}
});

// Connection functionality removed
    constructor(flowEditor) {
        this.editor = flowEditor;
        this.connections = new Map(); // Cache for rendered connections
        this.connectionStates = new Map(); // Track connection states
        this.routingGrid = null;
        this.gridSize = 20; // Grid cell size for pathfinding
        this.connectionTypes = {
            'process': { allowedTargets: ['process', 'decision', 'end'], color: '#22c1c3' },
            'decision': { allowedTargets: ['process', 'end'], color: '#ff9800' },
            'start': { allowedTargets: ['process', 'decision'], color: '#4caf50' },
            'end': { allowedTargets: [], color: '#f44336' }
        };
        this.connectionValidation = {
            maxConnections: 10,
            allowCircular: false,
            requireUniqueTargets: false
        };
    }

    // Initialize the connection system
    initialize() {
        this.setupSVGMarkers();
        this.setupEventListeners();
        this.createRoutingGrid();
    }

    // Setup SVG arrow markers for different connection states
    setupSVGMarkers() {
        const svg = this.editor.svg;
        if (!svg) return;

        // Remove existing markers
        const existingDefs = svg.querySelector('defs');
        if (existingDefs) {
            existingDefs.remove();
        }

        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        
        // Default arrow
        const defaultMarker = this.createArrowMarker('arrowDefault', '#22c1c3');
        defs.appendChild(defaultMarker);
        
        // Selected arrow
        const selectedMarker = this.createArrowMarker('arrowSelected', '#1976d2');
        defs.appendChild(selectedMarker);
        
        
        // Valid connection arrow
        const validMarker = this.createArrowMarker('arrowValid', '#4caf50');
        defs.appendChild(validMarker);
        
        // Invalid connection arrow
        const invalidMarker = this.createArrowMarker('arrowInvalid', '#f44336');
        defs.appendChild(invalidMarker);

        svg.appendChild(defs);
    }

    createArrowMarker(id, color) {
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', id);
        marker.setAttribute('viewBox', '0 -5 10 10');
        marker.setAttribute('refX', '8');
        marker.setAttribute('refY', '0');
        marker.setAttribute('markerWidth', '6');
        marker.setAttribute('markerHeight', '6');
        marker.setAttribute('orient', 'auto');
        marker.setAttribute('markerUnits', 'strokeWidth');
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M0,-5L10,0L0,5');
        path.setAttribute('fill', color);
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', '1');
        
        marker.appendChild(path);
        return marker;
    }

    // Create routing grid for pathfinding
    createRoutingGrid() {
        // Use logical coordinates instead of screen coordinates
        const gridWidth = parseInt(this.editor.grid.style.width) || 2400;
        const gridHeight = parseInt(this.editor.grid.style.height) || 1600;
        this.gridWidth = Math.ceil(gridWidth / this.gridSize);
        this.gridHeight = Math.ceil(gridHeight / this.gridSize);
        this.routingGrid = Array(this.gridHeight).fill().map(() => Array(this.gridWidth).fill(0));
    }

    // Update routing grid with obstacles (nodes)
    updateRoutingGrid() {
        if (!this.routingGrid) return;
        
        // Clear grid
        for (let y = 0; y < this.gridHeight; y++) {
            for (let x = 0; x < this.gridWidth; x++) {
                this.routingGrid[y][x] = 0;
            }
        }

        // Mark node areas as obstacles with padding
        this.editor.state.nodes.forEach(node => {
            const nodeSize = this.editor.getNodeSize(node);
            const padding = 10; // Add padding around nodes to keep connectors away
            
            // Calculate grid boundaries with padding
            const gridX = Math.floor((node.x - padding) / this.gridSize);
            const gridY = Math.floor((node.y - padding) / this.gridSize);
            const gridW = Math.ceil((nodeSize.w + padding * 2) / this.gridSize);
            const gridH = Math.ceil((nodeSize.h + padding * 2) / this.gridSize);

            for (let y = Math.max(0, gridY); y < Math.min(this.gridHeight, gridY + gridH); y++) {
                for (let x = Math.max(0, gridX); x < Math.min(this.gridWidth, gridX + gridW); x++) {
                    this.routingGrid[y][x] = 1; // Obstacle
                }
            }
        });
    }

    // A* pathfinding algorithm
    findPath(start, end) {
        const startGrid = this.worldToGrid(start);
        const endGrid = this.worldToGrid(end);
        
        if (!this.isValidGridPos(startGrid) || !this.isValidGridPos(endGrid)) {
            return this.createDirectPath(start, end);
        }

        const openSet = [startGrid];
        const cameFrom = new Map();
        const gScore = new Map();
        const fScore = new Map();
        
        gScore.set(this.gridKey(startGrid), 0);
        fScore.set(this.gridKey(startGrid), this.heuristic(startGrid, endGrid));

        while (openSet.length > 0) {
            // Find node with lowest fScore
            let current = openSet.reduce((min, node) => 
                fScore.get(this.gridKey(node)) < fScore.get(this.gridKey(min)) ? node : min
            );

            if (this.gridKey(current) === this.gridKey(endGrid)) {
                return this.reconstructPath(cameFrom, current, start, end);
            }

            openSet.splice(openSet.indexOf(current), 1);

            // Check neighbors
            const neighbors = this.getNeighbors(current);
            for (const neighbor of neighbors) {
                const tentativeGScore = gScore.get(this.gridKey(current)) + 1;
                const neighborKey = this.gridKey(neighbor);

                if (!gScore.has(neighborKey) || tentativeGScore < gScore.get(neighborKey)) {
                    cameFrom.set(neighborKey, current);
                    gScore.set(neighborKey, tentativeGScore);
                    fScore.set(neighborKey, tentativeGScore + this.heuristic(neighbor, endGrid));

                    if (!openSet.some(n => this.gridKey(n) === neighborKey)) {
                        openSet.push(neighbor);
                    }
                }
            }
        }

        // No path found, return direct path
        return this.createDirectPath(start, end);
    }

    // Helper methods for A* pathfinding
    worldToGrid(point) {
        return {
            x: Math.floor(point.x / this.gridSize),
            y: Math.floor(point.y / this.gridSize)
        };
    }

    gridToWorld(grid) {
        return {
            x: grid.x * this.gridSize + this.gridSize / 2,
            y: grid.y * this.gridSize + this.gridSize / 2
        };
    }

    gridKey(grid) {
        return `${grid.x},${grid.y}`;
    }

    isValidGridPos(grid) {
        return grid.x >= 0 && grid.x < this.gridWidth && 
               grid.y >= 0 && grid.y < this.gridHeight;
    }

    heuristic(a, b) {
        return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    }

    getNeighbors(grid) {
        const neighbors = [];
        const directions = [
            {x: 0, y: -1}, {x: 1, y: 0}, {x: 0, y: 1}, {x: -1, y: 0}
        ];

        for (const dir of directions) {
            const neighbor = {x: grid.x + dir.x, y: grid.y + dir.y};
            if (this.isValidGridPos(neighbor) && 
                this.routingGrid[neighbor.y][neighbor.x] === 0) {
                neighbors.push(neighbor);
            }
        }

        return neighbors;
    }

    reconstructPath(cameFrom, current, start, end) {
        const path = [this.gridToWorld(current)];
        
        while (cameFrom.has(this.gridKey(current))) {
            current = cameFrom.get(this.gridKey(current));
            path.unshift(this.gridToWorld(current));
        }

        // Optimize path by removing unnecessary waypoints
        const optimizedPath = this.optimizePath([start, ...path, end]);
        
        // Convert grid path to smooth SVG path
        return this.createSmoothPath(optimizedPath);
    }

    createDirectPath(start, end) {
        return this.createSmoothPath([start, end]);
    }

    // Optimize path by removing unnecessary waypoints
    optimizePath(points) {
        if (points.length <= 2) return points;
        
        const optimized = [points[0]];
        let i = 0;
        
        while (i < points.length - 1) {
            let j = i + 2;
            
            // Find the furthest point we can reach in a straight line
            while (j < points.length && this.isLineClear(points[i], points[j])) {
                j++;
            }
            
            // Add the furthest reachable point
            optimized.push(points[j - 1]);
            i = j - 1;
        }
        
        // Ensure we always end with the final point
        if (optimized[optimized.length - 1] !== points[points.length - 1]) {
            optimized.push(points[points.length - 1]);
        }
        
        return optimized;
    }

    // Check if a straight line between two points is clear of obstacles
    isLineClear(start, end) {
        const steps = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) / this.gridSize;
        const stepX = (end.x - start.x) / steps;
        const stepY = (end.y - start.y) / steps;
        
        for (let i = 0; i <= steps; i++) {
            const x = start.x + stepX * i;
            const y = start.y + stepY * i;
            const grid = this.worldToGrid({ x, y });
            
            if (!this.isValidGridPos(grid) || this.routingGrid[grid.y][grid.x] === 1) {
                return false;
            }
        }
        
        return true;
    }

    createSmoothPath(points) {
        if (points.length < 2) return '';
        
        let path = `M ${points[0].x} ${points[0].y}`;
        
        for (let i = 1; i < points.length; i++) {
            const prev = points[i - 1];
            const curr = points[i];
            
            // Use smooth curves for better visual appeal
            if (i === 1) {
                path += ` L ${curr.x} ${curr.y}`;
            } else {
                const control1 = {
                    x: prev.x + (curr.x - prev.x) * 0.3,
                    y: prev.y + (curr.y - prev.y) * 0.3
                };
                const control2 = {
                    x: prev.x + (curr.x - prev.x) * 0.7,
                    y: prev.y + (curr.y - prev.y) * 0.7
                };
                path += ` C ${control1.x} ${control1.y} ${control2.x} ${control2.y} ${curr.x} ${curr.y}`;
            }
        }
        
        return path;
    }

    // Connection validation
    validateConnection(fromNode, toNode, fromPort, toPort) {
        const validation = {
            isValid: true,
            errors: [],
            warnings: []
        };

        // Check if nodes exist
        if (!fromNode || !toNode) {
            validation.isValid = false;
            validation.errors.push('Invalid nodes');
            return validation;
        }

        // Check self-connection
        if (fromNode.id === toNode.id) {
            validation.isValid = false;
            validation.errors.push('Cannot connect node to itself');
            return validation;
        }

        // Check connection type compatibility
        const fromType = this.connectionTypes[fromNode.kind];
        if (fromType && !fromType.allowedTargets.includes(toNode.kind)) {
            validation.isValid = false;
            validation.errors.push(`Cannot connect ${fromNode.kind} to ${toNode.kind}`);
        }

        // Check for circular dependencies
        if (!this.connectionValidation.allowCircular) {
            if (this.wouldCreateCycle(fromNode.id, toNode.id)) {
                validation.isValid = false;
                validation.errors.push('Connection would create a circular dependency');
            }
        }

        // Check maximum connections
        const fromConnections = this.editor.state.edges.filter(e => e.from === fromNode.id).length;
        if (fromConnections >= this.connectionValidation.maxConnections) {
            validation.warnings.push(`Node already has maximum connections (${this.connectionValidation.maxConnections})`);
        }

        // Check for duplicate connections
        const existingConnection = this.editor.state.edges.find(e => 
            e.from === fromNode.id && e.to === toNode.id
        );
        if (existingConnection) {
            validation.isValid = false;
            validation.errors.push('Connection already exists');
        }

        return validation;
    }

    // Check for circular dependencies using DFS
    wouldCreateCycle(fromId, toId) {
        const visited = new Set();
        const recursionStack = new Set();

        const hasCycle = (nodeId) => {
            if (recursionStack.has(nodeId)) return true;
            if (visited.has(nodeId)) return false;

            visited.add(nodeId);
            recursionStack.add(nodeId);

            const outgoingEdges = this.editor.state.edges.filter(e => e.from === nodeId);
            for (const edge of outgoingEdges) {
                if (hasCycle(edge.to)) return true;
            }

            recursionStack.delete(nodeId);
            return false;
        };

        // Temporarily add the connection
        this.editor.state.edges.push({ from: fromId, to: toId });
        const result = hasCycle(toId);
        this.editor.state.edges.pop(); // Remove temporary connection

        return result;
    }

    // Create a new connection
    createConnection(fromNode, toNode, fromPort = null, toPort = null) {
        const validation = this.validateConnection(fromNode, toNode, fromPort, toPort);
        
        if (!validation.isValid) {
            this.showConnectionError(validation.errors[0]);
            return null;
        }

        if (validation.warnings.length > 0) {
            this.showConnectionWarning(validation.warnings[0]);
        }

        const connection = {
            id: generateId('edge'),
            from: fromNode.id,
            to: toNode.id,
            fromPort: fromPort,
            toPort: toPort,
            state: 'valid',
            path: null // Will be calculated during rendering
        };

        this.editor.state.edges.push(connection);
        this.connectionStates.set(connection.id, {
            selected: false,
            animating: false
        });

        return connection;
    }

    // Render all connections
    renderConnections() {
        // Recreate grid if needed (canvas size might have changed)
        this.createRoutingGrid();
        this.updateRoutingGrid();
        
        // Clean up orphaned connections first
        this.cleanupOrphanedConnections();
        
        // Clear existing connections
        this.clearConnections();
        
        // Render each valid connection
        this.editor.state.edges.forEach(edge => {
            this.renderConnection(edge);
        });
    }

    // Ultra-fast connection rendering for drag operations
    renderConnectionsFast() {
        // Skip expensive pathfinding during drag for maximum performance
        this.clearConnections();
        
        // Clean up orphaned connections first (but don't save during drag for performance)
        const validEdges = this.editor.state.edges.filter(edge => {
            const fromNode = this.editor.state.nodes.find(n => n.id === edge.from);
            const toNode = this.editor.state.nodes.find(n => n.id === edge.to);
            return fromNode && toNode;
        });
        
        // Render each valid connection with simplified paths for maximum performance
        validEdges.forEach(edge => {
            this.renderConnectionFast(edge);
        });
    }

    // Render a single connection
    renderConnection(edge) {
        const fromNode = this.editor.state.nodes.find(n => n.id === edge.from);
        const toNode = this.editor.state.nodes.find(n => n.id === edge.to);
        
        if (!fromNode || !toNode) {
            console.log('Skipping orphaned connection:', edge.id, 'from:', edge.from, 'to:', edge.to);
            return;
        }

        // Map old port names to new side names
        const portToSide = {
            'l': 'left',
            'r': 'right',
            't': 'top', 
            'b': 'bottom'
        };
        
        const fromSide = portToSide[edge.fromPort] || 'right';
        const toSide = portToSide[edge.toPort] || 'left';
        
        // Calculate connection points
        const fromPoint = this.editor.getAnchor(fromNode, fromSide);
        const toPoint = this.editor.getAnchor(toNode, toSide);
        
        // Use new connector logic
        const path = this.editor.updateConnector(fromNode, fromSide, toNode, toSide);
        
        // Create connection group
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('data-connection-id', edge.id);
        
        // Create hit area for better interaction (append first so it's behind the visible path)
        const hitArea = this.createHitArea(path);
        group.appendChild(hitArea);
        
        // Create visible path (append after hit area so it's on top)
        const pathElement = this.createPathElement(path, edge);
        group.appendChild(pathElement);
        
        // Create connection handles
        const handles = this.createConnectionHandles(fromPoint, toPoint, edge);
        handles.forEach(handle => group.appendChild(handle));
        
        // Add event listeners
        this.addConnectionEventListeners(group, edge, pathElement, hitArea);
        
        // Add to SVG
        this.editor.svg.appendChild(group);
        
        // Cache the connection
        this.connections.set(edge.id, {
            group: group,
            path: pathElement,
            hitArea: hitArea,
            handles: handles
        });
    }

    // Ultra-fast connection rendering for drag operations
    renderConnectionFast(edge) {
        const fromNode = this.editor.state.nodes.find(n => n.id === edge.from);
        const toNode = this.editor.state.nodes.find(n => n.id === edge.to);
        
        if (!fromNode || !toNode) {
            console.log('Skipping orphaned connection (fast):', edge.id, 'from:', edge.from, 'to:', edge.to);
            return;
        }

        // Map old port names to new side names
        const portToSide = {
            'l': 'left',
            'r': 'right',
            't': 'top', 
            'b': 'bottom'
        };
        
        const fromSide = portToSide[edge.fromPort] || 'right';
        const toSide = portToSide[edge.toPort] || 'left';
        
        // Use new connector logic for fast rendering too
        const path = this.editor.updateConnector(fromNode, fromSide, toNode, toSide);
        
        // Create minimal connection group
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('data-connection-id', edge.id);
        
        // Create simple path element with basic interactivity
        const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathElement.setAttribute('d', path);
        pathElement.setAttribute('fill', 'none');
        pathElement.setAttribute('stroke', '#22c1c3');
        pathElement.setAttribute('stroke-width', '1'); // Set to 1px as requested
        pathElement.setAttribute('stroke-linecap', 'round');
        pathElement.setAttribute('marker-end', 'url(#arrowhead)');
        pathElement.style.cursor = 'pointer';
        pathElement.style.pointerEvents = 'stroke';
        
        // Add a large, invisible hit area to make selection easier
        const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hitArea.setAttribute('d', path);
        hitArea.setAttribute('stroke', 'rgba(0,0,0,0.001)'); // nearly invisible but considered painted
        hitArea.setAttribute('stroke-width', '10');
        hitArea.setAttribute('fill', 'none');
        hitArea.setAttribute('stroke-linecap', 'round');
        hitArea.setAttribute('stroke-linejoin', 'round');
        hitArea.setAttribute('vector-effect', 'non-scaling-stroke');
        hitArea.setAttribute('pointer-events', 'stroke');
        hitArea.style.pointerEvents = 'stroke';
        hitArea.style.cursor = 'pointer';

        // Add basic click handler for selection (on both hit area and path)
        const onSelect = (e) => { e.stopPropagation(); this.selectConnection(edge.id); };
        pathElement.addEventListener('click', onSelect);
        hitArea.addEventListener('click', onSelect);
        
        // Append hit area BEFORE path so pointer events land on hitArea, not blocked by container
        group.appendChild(hitArea);
        group.appendChild(pathElement);
        
        // Add to SVG
        this.editor.svg.appendChild(group);
        
        // Cache the connection
        this.connections.set(edge.id, {
            group: group,
            path: pathElement,
            hitArea: hitArea,
            handles: handles
        });
    }

    // Create path element with enhanced styling
    createPathElement(path, edge) {
        const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathElement.setAttribute('d', path);
        pathElement.setAttribute('fill', 'none');
        pathElement.setAttribute('stroke-linecap', 'round');
        pathElement.setAttribute('stroke-linejoin', 'round');
        pathElement.style.cursor = 'pointer';
        // Allow clicking directly on the visible stroke too, not only the hit area
        pathElement.style.pointerEvents = 'stroke';
        
        // Apply connection state styling
        this.applyConnectionStyling(pathElement, edge);
        
        return pathElement;
    }

    // Apply styling based on connection state
    applyConnectionStyling(pathElement, edge) {
        const state = this.connectionStates.get(edge.id) || {};
        const isSelected = state.selected;
        const isHovering = state.hovering;
        
        // Remove all state classes first
        pathElement.classList.remove('selected', 'hovering');
        
        if (isSelected) {
            pathElement.classList.add('selected');
        } else if (isHovering) {
            pathElement.classList.add('hovering');
        }
        
        // Apply default styling if not selected or hovering
        if (!isSelected && !isHovering) {
            const nodeType = this.editor.state.nodes.find(n => n.id === edge.from)?.kind;
            const color = this.connectionTypes[nodeType]?.color || '#22c1c3';
            pathElement.setAttribute('stroke', color);
            pathElement.setAttribute('stroke-width', '1');
            pathElement.setAttribute('marker-end', 'url(#arrowDefault)');
        }
        
        // Ensure pointer events work properly
        pathElement.style.pointerEvents = 'none';
    }

    // Create hit area for better interaction
    createHitArea(path) {
        const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hitArea.setAttribute('d', path);
        hitArea.setAttribute('stroke', 'rgba(0,0,0,0.001)'); // nearly invisible but considered painted
        hitArea.setAttribute('stroke-width', '10'); // larger invisible hit area for easier selection/hover
        hitArea.setAttribute('fill', 'none');
        hitArea.setAttribute('stroke-linecap', 'round');
        hitArea.setAttribute('stroke-linejoin', 'round');
        hitArea.setAttribute('vector-effect', 'non-scaling-stroke');
        hitArea.setAttribute('pointer-events', 'stroke');
        hitArea.style.pointerEvents = 'stroke';
        hitArea.style.cursor = 'pointer';
        return hitArea;
    }

    // Create connection handles
    createConnectionHandles(fromPoint, toPoint, edge) {
        const handles = [];
        const state = this.connectionStates.get(edge.id) || {};
        const isSelected = state.selected;
        
        if (isSelected) {
            // From handle
            const fromHandle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            fromHandle.setAttribute('cx', fromPoint.x);
            fromHandle.setAttribute('cy', fromPoint.y);
            fromHandle.setAttribute('r', '6');
            fromHandle.setAttribute('fill', '#fff');
            fromHandle.setAttribute('stroke', '#1976d2');
            fromHandle.setAttribute('stroke-width', '2');
            fromHandle.style.cursor = 'grab';
            fromHandle.setAttribute('data-handle-type', 'from');
            // Enable rewiring from the "from" end by dragging this handle
            fromHandle.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.editor.startEdgeRewire(edge.id, 'from');
                const move = (evt) => this.editor.updateTempEdgeRewire(evt);
                const up = (evt) => {
                    window.removeEventListener('mousemove', move);
                    window.removeEventListener('mouseup', up);
                    this.editor.finishEdgeRewire(evt);
                };
                window.addEventListener('mousemove', move);
                window.addEventListener('mouseup', up, { once: true });
            });
            handles.push(fromHandle);
            
            // To handle
            const toHandle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            toHandle.setAttribute('cx', toPoint.x);
            toHandle.setAttribute('cy', toPoint.y);
            toHandle.setAttribute('r', '6');
            toHandle.setAttribute('fill', '#fff');
            toHandle.setAttribute('stroke', '#1976d2');
            toHandle.setAttribute('stroke-width', '2');
            toHandle.style.cursor = 'grab';
            toHandle.setAttribute('data-handle-type', 'to');
            // Enable rewiring from the "to" end by dragging this handle
            toHandle.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.editor.startEdgeRewire(edge.id, 'to');
                const move = (evt) => this.editor.updateTempEdgeRewire(evt);
                const up = (evt) => {
                    window.removeEventListener('mousemove', move);
                    window.removeEventListener('mouseup', up);
                    this.editor.finishEdgeRewire(evt);
                };
                window.addEventListener('mousemove', move);
                window.addEventListener('mouseup', up, { once: true });
            });
            handles.push(toHandle);
        }
        
        return handles;
    }

    // Add event listeners for connection interactions
    addConnectionEventListeners(group, edge, pathElement, hitArea) {
        const state = this.connectionStates.get(edge.id) || {};
        
        // Click to select (works on path and hit area)
        const selectConnection = (e) => {
            console.log('Connection clicked:', edge.id);
            e.stopPropagation();
            this.selectConnection(edge.id);
        };
        
        if (pathElement) {
            pathElement.addEventListener('click', selectConnection);
            console.log('Added click listener to pathElement for edge:', edge.id);
        }
        if (hitArea) {
            hitArea.addEventListener('click', selectConnection);
            console.log('Added click listener to hitArea for edge:', edge.id);
        }
        // Also raise on path hover for consistency
        if (pathElement) {
            pathElement.addEventListener('mouseenter', () => {
                const s = this.connectionStates.get(edge.id) || {};
                s.hovering = true; this.connectionStates.set(edge.id, s);
                if (this.editor && this.editor.svg) {
                    this._prevEdgesZ = this.editor.svg.style.zIndex;
                    this.editor.svg.style.zIndex = '1000';
                }
                this.applyConnectionStyling(pathElement, edge);
            });
            pathElement.addEventListener('mouseleave', () => {
                const s = this.connectionStates.get(edge.id) || {};
                s.hovering = false; this.connectionStates.set(edge.id, s);
                if (this.editor && this.editor.svg) {
                    this.editor.svg.style.zIndex = this._prevEdgesZ || '';
                }
                this.applyConnectionStyling(pathElement, edge);
            });
        }

        // Hover feedback on generous hit area
        const setHover = (hovering) => {
            const s = this.connectionStates.get(edge.id) || {};
            s.hovering = hovering;
            this.connectionStates.set(edge.id, s);
            // Update only this connection's visuals fast
            if (pathElement) this.applyConnectionStyling(pathElement, edge);
        };
        if (hitArea) {
            hitArea.addEventListener('mouseenter', () => {
                setHover(true);
                // Temporarily raise edges above nodes so overlapped segments are clickable
                if (this.editor && this.editor.svg) {
                    this._prevEdgesZ = this.editor.svg.style.zIndex;
                    this.editor.svg.style.zIndex = '1000';
                }
            });
            hitArea.addEventListener('mouseleave', () => {
                setHover(false);
                if (this.editor && this.editor.svg) {
                    this.editor.svg.style.zIndex = this._prevEdgesZ || '';
                }
            });
        }
        
        
        // Handle dragging for reconnection
        const handleDrag = (e) => {
            if (e.altKey) {
                e.stopPropagation();
                e.preventDefault();
                this.startConnectionRewire(edge.id);
            }
        };
        
        if (pathElement) pathElement.addEventListener('mousedown', handleDrag);
        if (hitArea) hitArea.addEventListener('mousedown', handleDrag);

        // Right-click context menu disabled - use left-click to select, then keyboard Delete/Backspace
    }

    // Select a connection
    selectConnection(connectionId) {
        console.log('selectConnection called with ID:', connectionId);
        // Deselect all nodes first
        this.editor.clearNodeSelections();
        
        // Deselect all connections
        this.connectionStates.forEach((state, id) => {
            state.selected = false;
            this.connectionStates.set(id, state);
        });
        
        // Select the clicked connection
        const state = this.connectionStates.get(connectionId) || {};
        state.selected = true;
        this.connectionStates.set(connectionId, state);
        console.log('Set connection state to selected:', connectionId);
        
        // Re-render to show selection
        this.renderConnections();
        
        // Notify editor
        this.editor.selectedEdgeId = connectionId;
        console.log('Set editor.selectedEdgeId to:', connectionId);
        this.editor.updateToolbarState();
    }

    // Start connection rewiring
    startConnectionRewire(connectionId, handleType = 'to') {
        const connection = this.editor.state.edges.find(e => e.id === connectionId);
        if (!connection) return;
        
        this.editor.edgeRewire = {
            connectionId: connectionId,
            handleType: handleType,
            fromNodeId: connection.from,
            toNodeId: connection.to
        };
        
        // Create temporary preview path
        this.createTempRewirePath();
    }

    // Create temporary path for rewiring
    createTempRewirePath() {
        if (this.editor.tempPathEl) {
            this.editor.tempPathEl.remove();
        }
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('stroke', '#ff9800');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('stroke-dasharray', '8,4');
        path.setAttribute('fill', 'none');
        path.style.pointerEvents = 'none';
        this.editor.svg.appendChild(path);
        this.editor.tempPathEl = path;
    }

    // Clear all connections
    clearConnections() {
        this.connections.forEach(connection => {
            if (connection.group && connection.group.parentNode) {
                connection.group.parentNode.removeChild(connection.group);
            }
        });
        this.connections.clear();
        
    }

    // Show connection error
    showConnectionError(message) {
        // Create temporary error indicator
        const errorDiv = document.createElement('div');
        errorDiv.className = 'connection-error';
        errorDiv.textContent = message;
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #f44336;
            color: white;
            padding: 12px 16px;
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 1000;
            font-size: 14px;
            max-width: 300px;
        `;
        
        document.body.appendChild(errorDiv);
        
        // Auto-remove after 3 seconds
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 3000);
    }

    // Show connection warning
    showConnectionWarning(message) {
        const warningDiv = document.createElement('div');
        warningDiv.className = 'connection-warning';
        warningDiv.textContent = message;
        warningDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #ff9800;
            color: white;
            padding: 12px 16px;
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 1000;
            font-size: 14px;
            max-width: 300px;
        `;
        
        document.body.appendChild(warningDiv);
        
        setTimeout(() => {
            if (warningDiv.parentNode) {
                warningDiv.parentNode.removeChild(warningDiv);
            }
        }, 3000);
    }

    // Setup event listeners
    setupEventListeners() {
        // Listen for node changes to update routing grid
        this.editor.grid.addEventListener('nodeMoved', () => {
            this.updateRoutingGrid();
            this.renderConnections();
        });
        // Global hover detection for connectors (non-intrusive):
        // Shows edge hover only when a node is not under the pointer
        const onMouseMove = (e) => {
            const elems = (document.elementsFromPoint && typeof document.elementsFromPoint === 'function')
                ? document.elementsFromPoint(e.clientX, e.clientY) : [];
            if (!Array.isArray(elems)) return;
            // Find nearest edge group in stack (regardless of nodes)
            const groupEl = elems.find(el => el && el.closest && el.closest('g[data-connection-id]'));
            const edgeId = groupEl && groupEl.closest ? (groupEl.closest('g[data-connection-id]')?.getAttribute('data-connection-id')) : null;
            // Clear previous hover state
            let changed = false;
            this.connectionStates.forEach((s, id) => {
                if (s.hovering) { s.hovering = false; this.connectionStates.set(id, s); changed = true; }
            });
            if (edgeId) {
                const s = this.connectionStates.get(edgeId) || {};
                s.hovering = true; this.connectionStates.set(edgeId, s); changed = true;
            }
            if (changed) {
                // Fast re-style to reflect hover without full re-render
                const conn = edgeId ? this.connections.get(edgeId) : null;
                const edge = edgeId ? this.editor.state.edges.find(e => e.id === edgeId) : null;
                if (conn && conn.path && edge) {
                    this.applyConnectionStyling(conn.path, edge);
                } else {
                    this.renderConnectionsFast();
                }
            }
        };
        window.addEventListener('mousemove', onMouseMove);
        // Edge selection on click, even if same layer as nodes
        const onMouseDownCapture = (e) => {
            const elems = (document.elementsFromPoint && typeof document.elementsFromPoint === 'function')
                ? document.elementsFromPoint(e.clientX, e.clientY) : [];
            if (!Array.isArray(elems)) return;
            // Prefer a connector if the pointer intersects both at this point
            const groupEl = elems.find(el => el && el.closest && el.closest('g[data-connection-id]'));
            const edgeId = groupEl && groupEl.closest ? (groupEl.closest('g[data-connection-id]')?.getAttribute('data-connection-id')) : null;
            if (edgeId) {
                e.stopPropagation();
                this.selectConnection(edgeId);
                return;
            }
            // Otherwise, allow node selection to proceed (handled elsewhere)
        };
        window.addEventListener('mousedown', onMouseDownCapture, true);
    }

    // Update connection when nodes move
    updateConnection(connectionId) {
        const connection = this.editor.state.edges.find(e => e.id === connectionId);
        if (connection) {
            this.renderConnection(connection);
        }
    }

    // Delete connection
    deleteConnection(connectionId) {
        console.log('deleteConnection called for:', connectionId);
        const connection = this.connections.get(connectionId);
        if (connection && connection.group) {
            console.log('Removing connection group from DOM');
            connection.group.remove();
        } else {
            console.log('No connection or group found for:', connectionId);
        }
        this.connections.delete(connectionId);
        this.connectionStates.delete(connectionId);
        
        // Clear selection if this connection was selected
        if (this.editor.selectedEdgeId === connectionId) {
            this.editor.selectedEdgeId = null;
        }
    }

    // Clean up orphaned connections (connections to non-existent nodes)
    cleanupOrphanedConnections() {
        console.log('Cleaning up orphaned connections...');
        const validEdges = this.editor.state.edges.filter(edge => {
            const fromNode = this.editor.state.nodes.find(n => n.id === edge.from);
            const toNode = this.editor.state.nodes.find(n => n.id === edge.to);
            return fromNode && toNode;
        });
        
        // Remove orphaned connections from state
        if (validEdges.length !== this.editor.state.edges.length) {
            const orphanedCount = this.editor.state.edges.length - validEdges.length;
            console.log('Removing orphaned connections:', orphanedCount);
            
            // Clean up connection manager for orphaned edges
            const orphanedEdges = this.editor.state.edges.filter(edge => {
                const fromNode = this.editor.state.nodes.find(n => n.id === edge.from);
                const toNode = this.editor.state.nodes.find(n => n.id === edge.to);
                return !fromNode || !toNode;
            });
            
            orphanedEdges.forEach(edge => {
                console.log('Cleaning up orphaned connection:', edge.id);
                this.deleteConnection(edge.id);
            });
            
            // Update state with only valid edges
            this.editor.state.edges = validEdges;
            saveFlowData(this.editor.state);
        }
    }

    // Get connection by ID
    getConnection(connectionId) {
        return this.editor.state.edges.find(e => e.id === connectionId);
    }

    // Get all connections for a node
    getNodeConnections(nodeId) {
        return this.editor.state.edges.filter(e => e.from === nodeId || e.to === nodeId);
    }

    // Animate connection
    animateConnection(connectionId, animationType = 'pulse') {
        const connection = this.connections.get(connectionId);
        if (!connection) return;
        
        const state = this.connectionStates.get(connectionId) || {};
        state.animating = true;
        this.connectionStates.set(connectionId, state);
        
        if (animationType === 'pulse') {
            connection.path.style.animation = 'connectionPulse 1s ease-in-out';
            setTimeout(() => {
                connection.path.style.animation = '';
                state.animating = false;
                this.connectionStates.set(connectionId, state);
            }, 1000);
        }
    }
}

// --- Connector UX: brand-new connector line experience ---
class ConnectorUX {
    constructor(editor) {
        this.editor = editor;
        this.active = false;
        this.fromNodeId = null;
        this.fromPort = null; // 't' | 'r' | 'b' | 'l' | 'center'
        this.previewEl = null; // SVG path
        this.boundMove = null;
        this.boundUp = null;
    }

    attach() {
        const grid = this.editor.grid;
        if (!grid) return;
        // Delegate mousedown from ports
        grid.addEventListener('mousedown', (e) => {
            const portEl = e.target && e.target.closest && e.target.closest('.flow-port');
            if (!portEl) return;
            e.stopPropagation();
            e.preventDefault();
            const nodeEl = portEl.closest('.flow-node');
            if (!nodeEl) return;
            const nodeId = nodeEl.dataset.id;
            const port = portEl.classList.contains('t') ? 't' : portEl.classList.contains('r') ? 'r' : portEl.classList.contains('b') ? 'b' : 'l';
            this.start(nodeId, port, e);
        });
    }

    start(nodeId, port, e) {
        this.active = true;
        this.fromNodeId = nodeId;
        this.fromPort = port || 'center';
        // Create preview path
        if (this.previewEl && this.previewEl.parentNode) this.previewEl.parentNode.removeChild(this.previewEl);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.classList.add('connector-preview');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#1ea1f2');
        path.setAttribute('stroke-width', '2');
        path.setAttribute('stroke-dasharray', '8,4');
        path.style.pointerEvents = 'none';
        this.editor.svg.appendChild(path);
        this.previewEl = path;

        this.boundMove = (evt) => this.update(evt);
        this.boundUp = (evt) => this.finish(evt);
        window.addEventListener('mousemove', this.boundMove);
        window.addEventListener('mouseup', this.boundUp, { once: true });
        this.update(e);
    }

    update(e) {
        if (!this.active || !this.previewEl) return;
        const from = this.editor.state.nodes.find(n => n.id === this.fromNodeId);
        if (!from) return;
        const gridRect = this.editor.grid.getBoundingClientRect();
        const rawX = e.clientX - gridRect.left;
        const rawY = e.clientY - gridRect.top;
        const pointerX = rawX / (this.editor.zoom || 1);
        const pointerY = rawY / (this.editor.zoom || 1);

        // Determine sides dynamically for neat orthogonal routing
        let fromSide = this.fromPort && this.fromPort !== 'center' ? this.fromPort : 'right';

        // Hover target detection
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const hoverPort = el && el.closest ? el.closest('.flow-port') : null;
        const hoverNodeEl = el && el.closest ? el.closest('.flow-node') : null;

        let x2 = pointerX, y2 = pointerY, toNode = null, toSide = null;
        if (hoverPort && hoverNodeEl) {
            toNode = this.editor.state.nodes.find(n => n.id === hoverNodeEl.dataset.id);
            if (toNode) {
                toSide = hoverPort.classList.contains('t') ? 'top' : hoverPort.classList.contains('r') ? 'right' : hoverPort.classList.contains('b') ? 'bottom' : 'left';
                const p = this.editor.getAnchor(toNode, toSide);
                x2 = p.x; y2 = p.y;
            }
        } else if (hoverNodeEl) {
            toNode = this.editor.state.nodes.find(n => n.id === hoverNodeEl.dataset.id);
            if (toNode) {
                const chosen = this.editor.chooseSidesForNodes(from, toNode);
                toSide = chosen.toSide;
                const p = this.editor.getAnchor(toNode, toSide);
                x2 = p.x; y2 = p.y;
            }
        }

        const p1 = this.editor.getAnchor(from, fromSide);
        // If not snapping to a node, pull the preview endpoint slightly before the pointer
        const gap = this.editor.connectorGap || 0;
        let px2 = x2, py2 = y2;
        if (!toNode) {
            // offset the end by gap in the direction of the segment to avoid touching nodes when close
            const dx = x2 - p1.x;
            const dy = y2 - p1.y;
            const len = Math.hypot(dx, dy) || 1;
            px2 = x2 - (dx / len) * gap;
            py2 = y2 - (dy / len) * gap;
        }
        const d = this.editor.buildFlexibleConnector(p1.x, p1.y, px2, py2, toSide || 'left');
        this.previewEl.setAttribute('d', d);
    }

    finish(e) {
        window.removeEventListener('mousemove', this.boundMove);
        if (!this.active) return;
        const cleanup = () => {
            if (this.previewEl && this.previewEl.parentNode) this.previewEl.parentNode.removeChild(this.previewEl);
            this.previewEl = null;
            this.active = false;
            this.fromNodeId = null;
            this.fromPort = null;
        };

        const el = e && e.clientX != null ? document.elementFromPoint(e.clientX, e.clientY) : null;
        const targetPort = el && el.closest ? el.closest('.flow-port') : null;
        const targetNodeEl = el && el.closest ? el.closest('.flow-node') : null;
        if (!targetNodeEl) { cleanup(); return; }
        const toNode = this.editor.state.nodes.find(n => n.id === targetNodeEl.dataset.id);
        if (!toNode) { cleanup(); return; }

        const fromNode = this.editor.state.nodes.find(n => n.id === this.fromNodeId);
        const portToSide = { 't': 'top', 'r': 'right', 'b': 'bottom', 'l': 'left' };
        const fromSide = portToSide[this.fromPort] || 'right';
        const toSide = targetPort
            ? (targetPort.classList.contains('t') ? 'top' : targetPort.classList.contains('r') ? 'right' : targetPort.classList.contains('b') ? 'bottom' : 'left')
            : this.editor.chooseSidesForNodes(fromNode, toNode).toSide;

        // Create connection via ConnectionManager for validation and rendering
        const edge = this.editor.connectionManager.createConnection(fromNode, toNode, this.fromPort, this.sideToPort(toSide));
        if (edge) this.editor.connectionManager.renderConnections();
        cleanup();
    }

    sideToPort(side) {
        const map = { top: 't', right: 'r', bottom: 'b', left: 'l' };
        return map[side] || 'l';
    }
}

// --- Simple Flow Editor ---
class FlowEditor {
    constructor(options = {}) {
        // If an initial state is provided (e.g., when cloning a board), use a deep copy of it.
        // Otherwise, fall back to the global persisted flow data.
        this.state = options && options.initialState
            ? JSON.parse(JSON.stringify(options.initialState))
            : loadFlowData();
        this.wrap = options.root || null;
        this.grid = (this.wrap && this.wrap.querySelector) ? this.wrap.querySelector('.flow-grid') : document.getElementById('flowGrid');
        this.svg = (this.wrap && this.wrap.querySelector) ? this.wrap.querySelector('.flow-edges') : document.getElementById('flowEdges');
        this.table = (this.wrap && this.wrap.querySelector) ? this.wrap.querySelector('.flow-table') : document.getElementById('flowTable');
        this.toolbar = document.getElementById('flowToolbar');
        this.connectMode = false;
        this.tempConnection = null; // { fromNodeId, fromPort }
        this.drag = null; // { id, offsetX, offsetY }
        this.edgeDrag = null; // { fromNodeId, fromPort }
        this.tempPathEl = null; // SVG path element for live preview
        this.dragCandidate = null; // pending drag before threshold reached
        this.edgeTimer = null; // long-press timer to start edge drag
        this.lastPointer = { clientX: 0, clientY: 0 };
        this.selectedEdgeId = null; // currently selected edge for actions
        this.isDoubleClicking = false; // flag to prevent drag setup during double-click
        this.isEditingText = false; // flag to prevent hover effects during text editing
        this.snapDuringDrag = false; // disabled snapping
        this.edgeRewire = null; // { edgeId, end: 'to' }
        this.clipboard = null; // last copied item
        this.gridSize = this.state.gridSize || 20; // grid cell size for visuals
        this.columnWidth = this.state.columnWidth || 200; // column width for visuals
        this.gridEnabled = this.state.gridEnabled !== undefined ? this.state.gridEnabled : true; // grid visuals on by default
        this.baseWidth = 2400; // starting canvas size; grows as needed
        this.baseHeight = 1600;
        this.dockingInset = 3; // retained for internal math (not used for outward connector)
        this.connectorGap = 8; // ensure connector endpoints sit outside node to avoid overlap
        this.decisionSize = 100; // fixed side length for decision (diamond) nodes; matches CSS width/height
        this.history = []; // undo stack
        this.future = []; // redo stack
        this.showEdges = true;
        this.zoom = 1; // zoom factor (1 = 100%)
        // New drag manager flags/state
        this.pointerDragEnabled = false; // disable legacy listeners
        this.activePointerId = null;
        // Seed example if empty
        if ((!Array.isArray(this.state.nodes) || this.state.nodes.length === 0) && (!Array.isArray(this.state.edges) || this.state.edges.length === 0)) {
            this.seedExample();
        }
        // Initialize the new connection manager
        this.connectionManager = new ConnectionManager(this);
        this.connectionManager.initialize();
        
        // Clean up any orphaned connections on initialization
        this.connectionManager.cleanupOrphanedConnections();
        // Initialize brand-new connector UX
        this.connectorUX = new ConnectorUX(this);
        
        this.render();
        this.bindToolbar();
        // Enable node movement via the drag handle only
        this.dragManager = new NodeDragManager(this);
        this.dragManager.attach();
        this.bindCanvas();
        this.bindOverlay();
        this.bindShortcuts();
        this.updateToolbarState();
        
        // Make test method available globally for debugging
        window.testFlowCentering = () => this.testCentering();
        window.forceCenterDecisionNodes = () => this.forceCenterDecisionNodes();
    }

    bindToolbar() { /* navbar buttons are bound in bindFlowNavbarActions */ }

    bindCanvas() {
        if (!this.grid) return;
        // Old drag logic is removed; NodeDragManager handles pointer events
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.edgeDrag) {
                // cancel connection
                if (this.tempPathEl && this.tempPathEl.parentNode) this.tempPathEl.parentNode.removeChild(this.tempPathEl);
                this.tempPathEl = null;
                this.edgeDrag = null;
            }
        });
        // Attach new connector UX port listeners (delegated)
        if (this.connectorUX && typeof this.connectorUX.attach === 'function') {
            this.connectorUX.attach();
        }
        // Ensure node/edge selection works even if layers overlap
        this.grid.addEventListener('click', (e) => {
            // If clicking on edges layer, try to resolve node under pointer using full hit-test stack
            if (e.target && e.target.closest && e.target.closest('svg.flow-edges')) {
                const stack = (document.elementsFromPoint && typeof document.elementsFromPoint === 'function')
                    ? document.elementsFromPoint(e.clientX, e.clientY) : [];
                const nodeUnder = Array.isArray(stack) ? stack.find(el => el && el.classList && el.classList.contains('flow-node')) : null;
                if (nodeUnder && nodeUnder.dataset && nodeUnder.dataset.id) {
                    this.selectNode(nodeUnder.dataset.id);
                    return;
                }
                // If no node, try selecting an edge beneath using the same stack
                const edgeGroup = Array.isArray(stack) ? stack.find(el => el && el.closest && el.closest('g[data-connection-id]')) : null;
                const edgeId = edgeGroup && edgeGroup.closest ? (edgeGroup.closest('g[data-connection-id]')?.getAttribute('data-connection-id')) : null;
                if (edgeId) {
                    this.connectionManager.selectConnection(edgeId);
                    return;
                }
                this.deselectAll();
                return;
            }
            // Ignore clicks originating from ports
            if (e.target && e.target.closest && e.target.closest('.flow-port')) {
                return;
            }
            const nodeEl = e.target && e.target.closest ? e.target.closest('.flow-node') : null;
            if (nodeEl && nodeEl.dataset && nodeEl.dataset.id) {
                this.selectNode(nodeEl.dataset.id);
            } else {
                // If not clicking a node, see if an edge lies under the pointer even if covered by nodes
                const stack = (document.elementsFromPoint && typeof document.elementsFromPoint === 'function')
                    ? document.elementsFromPoint(e.clientX, e.clientY) : [];
                const edgeGroup = Array.isArray(stack) ? stack.find(el => el && el.closest && el.closest('g[data-connection-id]')) : null;
                const edgeId = edgeGroup && edgeGroup.closest ? (edgeGroup.closest('g[data-connection-id]')?.getAttribute('data-connection-id')) : null;
                if (edgeId) {
                    this.connectionManager.selectConnection(edgeId);
                    return;
                }
                this.deselectAll();
            }
        });

        // Shift-assisted edge selection/hover even when covered by nodes
        const onShiftMouseDownCapture = (e) => {
            if (!e.shiftKey) return;
            // Prefer selecting an edge under the pointer
            const stack = (document.elementsFromPoint && typeof document.elementsFromPoint === 'function')
                ? document.elementsFromPoint(e.clientX, e.clientY) : [];
            const edgeGroup = Array.isArray(stack) ? stack.find(el => el && el.closest && el.closest('g[data-connection-id]')) : null;
            const edgeId = edgeGroup && edgeGroup.closest ? (edgeGroup.closest('g[data-connection-id]')?.getAttribute('data-connection-id')) : null;
            if (edgeId) {
                e.stopPropagation();
                e.preventDefault();
                this.connectionManager.selectConnection(edgeId);
            }
        };
        const onShiftMouseMove = (e) => {
            if (!e.shiftKey) return;
            const stack = (document.elementsFromPoint && typeof document.elementsFromPoint === 'function')
                ? document.elementsFromPoint(e.clientX, e.clientY) : [];
            const edgeGroup = Array.isArray(stack) ? stack.find(el => el && el.closest && el.closest('g[data-connection-id]')) : null;
            const edgeId = edgeGroup && edgeGroup.closest ? (edgeGroup.closest('g[data-connection-id]')?.getAttribute('data-connection-id')) : null;
            // Clear all hover states
            this.connectionManager.connectionStates.forEach((s, id) => { s.hovering = false; this.connectionManager.connectionStates.set(id, s); });
            if (edgeId) {
                const s = this.connectionManager.connectionStates.get(edgeId) || {};
                s.hovering = true;
                this.connectionManager.connectionStates.set(edgeId, s);
                const conn = this.connectionManager.connections.get(edgeId);
                const edge = this.state.edges.find(e => e.id === edgeId);
                if (conn && conn.path && edge) {
                    this.connectionManager.applyConnectionStyling(conn.path, edge);
                } else {
                    // Fallback: re-render to reflect hover change
                    this.connectionManager.renderConnections();
                }
            } else {
                // Remove hover visuals quickly
                this.connectionManager.renderConnectionsFast();
            }
        };
        // Capture to allow edge selection even if node would receive the event
        window.addEventListener('mousedown', onShiftMouseDownCapture, true);
        window.addEventListener('mousemove', onShiftMouseMove);
    }

    // Heuristic: near right/bottom edges (where native resize handle appears)
    isOnResizeHandle(nodeEl, e) {
        if (!nodeEl) return false;
        const rect = nodeEl.getBoundingClientRect();
        const margin = 10; // px from right/bottom considered as resize zone
        const nearRight = (rect.right - e.clientX) <= margin;
        const nearBottom = (rect.bottom - e.clientY) <= margin;
        // Only allow horizontal resizing for process nodes; decision nodes are fixed
        const isDecision = nodeEl.classList.contains('decision');
        if (isDecision) return false;
        return nearRight || nearBottom;
    }

    bindOverlay() {
        const root = this.wrap || document;
        // Scope toolbar controls within this board only
        const toolbar = root.querySelector('.flow-toolbar');
        const qs = (sel) => toolbar ? toolbar.querySelector(sel) : root.querySelector(sel);
        // Prefer per-board toolbar buttons if available
        const add = qs('[data-flow="overlay-add" ]') || document.getElementById('flowToolAddProc');
        const addDecision = qs('[data-flow="overlay-add-decision" ]') || document.getElementById('flowToolAddDecision');
        const undo = qs('[data-flow="overlay-undo" ]') || document.getElementById('flowToolUndo');
        const redo = qs('[data-flow="overlay-redo" ]') || document.getElementById('flowToolRedo');
        const zoomInBtn = qs('[data-flow="overlay-zoom-in" ]');
        const zoomOutBtn = qs('[data-flow="overlay-zoom-out" ]');
        const zoomResetBtn = qs('[data-flow="overlay-zoom-reset" ]');
        const del = null; // Delete button removed from toolbar
        const connect = null; // Connect feature removed from toolbar
        const toggleGrid = null; // Toggle grid removed from toolbar
        const more = qs('[data-flow="overlay-more" ]') || document.getElementById('flowToolOtherOptions');
        const moreMenu = qs('[data-flow="overlay-more-menu" ]') || document.getElementById('flowToolOtherOptionsMenu');
        const deleteBoard = qs('[data-flow="overlay-delete-board" ]') || document.getElementById('flowToolDeleteBoard');
        add && add.addEventListener('click', () => this.addNode('process'));
        addDecision && addDecision.addEventListener('click', () => this.addNode('decision'));
        undo && undo.addEventListener('click', () => this.undo());
        redo && redo.addEventListener('click', () => this.redo());
        zoomInBtn && zoomInBtn.addEventListener('click', () => this.zoomIn());
        zoomOutBtn && zoomOutBtn.addEventListener('click', () => this.zoomOut());
        zoomResetBtn && zoomResetBtn.addEventListener('click', () => this.resetZoom());
        // removed: deleteSelection, toggleConnectMode, toggleGrid bindings from toolbar
        
        if (more && moreMenu) {
            more.addEventListener('click', (e) => {
                e.stopPropagation();
                moreMenu.style.display = moreMenu.style.display === 'block' ? 'none' : 'block';
            });
            document.addEventListener('click', (e) => {
                if (!more.contains(e.target) && !moreMenu.contains(e.target)) {
                    moreMenu.style.display = 'none';
                }
            });
        }
        
        deleteBoard && deleteBoard.addEventListener('click', () => {
            if (confirm('Are you sure you want to delete this flow board?')) {
                this.deleteCurrentBoard();
            }
            if (moreMenu) moreMenu.style.display = 'none';
        });
    }

    bindShortcuts() {
        // Store the bound function so we can remove it later if needed
        this.boundKeydown = (e) => {
            // Delete selected node or edge
            if ((e.key === 'Delete' || e.key === 'Backspace')) {
                console.log('Delete key pressed, selectedEdgeId:', this.selectedEdgeId, 'selectedNode:', !!(this.grid && this.grid.querySelector('.flow-node.selected')));
                if (this.selectedEdgeId || (this.grid && this.grid.querySelector('.flow-node.selected'))) {
                    console.log('Calling deleteSelection()');
                    this.deleteSelection();
                }
                e.preventDefault();
            }
            // Copy selection
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
                this.copySelection();
                e.preventDefault();
            }
            // Paste selection
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
                this.pasteSelection();
                e.preventDefault();
            }
            // Disabled snap/center shortcuts
            // Zoom in (Ctrl/Cmd + '+')
            if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
                this.zoomIn();
                e.preventDefault();
            }
            // Zoom out (Ctrl/Cmd + '-')
            if ((e.metaKey || e.ctrlKey) && e.key === '-') {
                this.zoomOut();
                e.preventDefault();
            }
            // Reset zoom (Ctrl/Cmd + 0)
            if ((e.metaKey || e.ctrlKey) && e.key === '0') {
                this.resetZoom();
                e.preventDefault();
            }
        };
        
        // Add the event listener
        document.addEventListener('keydown', this.boundKeydown);
    }

    addNode(kind) {
        const id = generateId('node');
        let x = 40, y = 40;
        
        // Apply grid snapping for new nodes
        // No snapping or decision centering for new nodes
        
        const node = { id, kind, label: kind === 'process' ? 'Process' : 'Decision', x, y };
        this.pushHistory();
        this.state.nodes.push(node);
        saveFlowData(this.state);
        this.render();
    }

    deleteSelection() {
        console.log('deleteSelection called, selectedEdgeId:', this.selectedEdgeId);
        const selected = this.grid.querySelector('.flow-node.selected');
        if (selected) {
            console.log('Deleting selected node');
            const id = selected.dataset.id;
            this.pushHistory();
            
            // Get all edges connected to this node before deletion
            const connectedEdges = this.state.edges.filter(e => e.from === id || e.to === id);
            
            // Delete the node
            this.state.nodes = this.state.nodes.filter(n => n.id !== id);
            this.state.edges = this.state.edges.filter(e => e.from !== id && e.to !== id);
            
            // Clean up connection manager for deleted edges
            console.log('Cleaning up connected edges:', connectedEdges.map(e => e.id));
            connectedEdges.forEach(edge => {
                console.log('Deleting connection:', edge.id);
                this.connectionManager.deleteConnection(edge.id);
            });
            
            // Ensure any remaining orphaned connections are cleaned up
            this.connectionManager.cleanupOrphanedConnections();
            
            saveFlowData(this.state);
            this.render();
            return;
        }
        if (this.selectedEdgeId) {
            console.log('Deleting selected edge:', this.selectedEdgeId);
            this.pushHistory();
            
            // Delete from connection manager first
            this.connectionManager.deleteConnection(this.selectedEdgeId);
            
            // Then delete from state
            this.state.edges = this.state.edges.filter(e => e.id !== this.selectedEdgeId);
            this.selectedEdgeId = null;
            
            saveFlowData(this.state);
            this.render();
        } else {
            console.log('No selection to delete');
        }
    }

    selectNode(id) {
        this.clearNodeSelections();
        const el = this.grid.querySelector(`.flow-node[data-id="${id}"]`);
        if (el) el.classList.add('selected');
        this.selectedEdgeId = null;
        
        // Update connectors to ensure they point to the correct positions
        this.updateNodeConnectors(id);
        
        this.updateToolbarState();
    }

    // Helper method to clear drag setup timers and candidates
    clearDragSetup() {
        if (this.dragSetupTimer) {
            clearTimeout(this.dragSetupTimer);
            this.dragSetupTimer = null;
        }
        this.dragCandidate = null;
    }

    // Helper method to clear all node selections
    clearNodeSelections() {
        if (this.grid) {
            this.grid.querySelectorAll('.flow-node').forEach(n => n.classList.remove('selected'));
        }
    }

    // Helper method to select all text in an element
    selectAllText(element) {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }

    // Helper method to manage text editing state
    setTextEditingState(isEditing) {
        this.isEditingText = isEditing;
        // Update CSS class on the grid to control hover effects
        if (this.grid) {
            if (isEditing) {
                this.grid.classList.add('text-editing-mode');
            } else {
                this.grid.classList.remove('text-editing-mode');
            }
        }
    }

    // Deselect all nodes and edges
    deselectAll() {
        this.clearNodeSelections();
        this.selectedEdgeId = null;
        this.updateToolbarState();
    }

    // Edge selection helper
    selectEdge(id) {
        // Clear any selected node highlight
        this.clearNodeSelections();
        this.selectedEdgeId = id;
        
        // Visual feedback for edge selection - highlight connected nodes
        const edge = this.state.edges.find(e => e.id === id);
        if (edge) {
            const fromNode = this.grid.querySelector(`.flow-node[data-id="${edge.from}"]`);
            const toNode = this.grid.querySelector(`.flow-node[data-id="${edge.to}"]`);
            if (fromNode) {
                fromNode.style.outline = '2px solid #2196f3';
                setTimeout(() => fromNode.style.outline = '', 1000);
            }
            if (toNode) {
                toNode.style.outline = '2px solid #2196f3';
                setTimeout(() => toNode.style.outline = '', 1000);
            }
        }
    }

    // Drag-to-connect: start on mousedown over a port
    startEdgeDrag(nodeId, port) {
        this.edgeDrag = { fromNodeId: nodeId, fromPort: port };
        // Create temp preview path if needed
        if (this.svg && !this.tempPathEl) {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('stroke', '#22c1c3');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('stroke-linecap', 'butt');
            path.setAttribute('stroke-linejoin', 'miter');
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke-dasharray', '6,6');
            path.style.pointerEvents = 'none';
            this.svg.appendChild(path);
            this.tempPathEl = path;
        }
    }

    updateTempEdge(e) {
        if (!this.edgeDrag || !this.tempPathEl) return;
        const from = this.state.nodes.find(n => n.id === this.edgeDrag.fromNodeId);
        if (!from) return;
        const gridRect = this.grid.getBoundingClientRect();
        const rawX = e.clientX - gridRect.left;
        const rawY = e.clientY - gridRect.top;
        // Logical pointer within unscaled grid coordinates
        const pointerX = rawX / (this.zoom || 1);
        const pointerY = rawY / (this.zoom || 1);
        let fromSide = this.edgeDrag.fromPort && this.edgeDrag.fromPort !== 'center'
            ? this.edgeDrag.fromPort
            : this.chooseSideForDrag(from, pointerX, pointerY, 'right');
        
        // Use snapped node position for visual alignment
        const fromSnap = { x: from.x, y: from.y };
        
        let p1 = this.getAnchor({ ...from, x: fromSnap.x, y: fromSnap.y }, fromSide);
        const x1 = p1.x;
        const y1 = p1.y;
        
        // Check if we're hovering over a specific port
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const portEl = el && el.closest ? el.closest('.flow-port') : null;
        const nodeEl = el && el.closest ? el.closest('.flow-node') : null;
        
        let x2, y2, toSide, toNode = null;
        if (portEl && nodeEl) {
            // If hovering over a port, use that port's position
            toSide = portEl.classList.contains('t') ? 't' : 
                    portEl.classList.contains('r') ? 'r' : 
                    portEl.classList.contains('b') ? 'b' : 'l';
            toNode = this.state.nodes.find(n => n.id === nodeEl.dataset.id);
            if (toNode) {
                const p2 = this.getAnchor(toNode, toSide);
                x2 = p2.x;
                y2 = p2.y;
            } else {
                x2 = pointerX;
                y2 = pointerY;
            }
        } else if (nodeEl) {
            // If hovering a node but not a specific port, mirror the final logic:
            // pick the same sides as the actual renderer and preview the path to that port point.
            toNode = this.state.nodes.find(n => n.id === (nodeEl.dataset && nodeEl.dataset.id));
            if (toNode) {
                const chosen = this.chooseSidesForNodes(from, toNode);
                toSide = chosen.toSide;
                const p2 = this.getAnchor(toNode, toSide);
                x2 = p2.x;
                y2 = p2.y;
            } else {
                x2 = pointerX;
                y2 = pointerY;
                toSide = null;
            }
        } else {
            // Free space: follow the pointer
            x2 = pointerX;
            y2 = pointerY;
            toSide = null;
        }

        // Align starting side with final logic when a target node is known,
        // but do NOT override an explicit starting port the user grabbed.
        if (toNode) {
            const chosen = this.chooseSidesForNodes(from, toNode);
            if (!this.edgeDrag.fromPort || this.edgeDrag.fromPort === 'center') {
                fromSide = chosen.fromSide;
            }
            if (!toSide) toSide = chosen.toSide;
        }
        
        const approach = toSide || this.chooseApproachSide(x1, y1, x2, y2);
        const d = this.buildFlexibleConnector(x1, y1, x2, y2, approach);
        this.tempPathEl.setAttribute('d', d);

        // Remove hover snap target highlight (no snapping)
    }

    finishEdgeDrag(e) {
        const fromId = this.edgeDrag && this.edgeDrag.fromNodeId;
        const fromPort = this.edgeDrag && this.edgeDrag.fromPort;
        // cleanup preview first
        if (this.tempPathEl && this.tempPathEl.parentNode) this.tempPathEl.parentNode.removeChild(this.tempPathEl);
        this.tempPathEl = null;

        let toId = null;
        let toPort = null;
        if (e && typeof e.clientX === 'number' && typeof e.clientY === 'number') {
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const portEl = el && el.closest ? el.closest('.flow-port') : null;
            const nodeEl = el && el.closest ? el.closest('.flow-node') : null;
            
            if (portEl && nodeEl) {
                // If dropping on a port, use that specific port
                toId = nodeEl.dataset.id;
                toPort = portEl.classList.contains('t') ? 't' : 
                        portEl.classList.contains('r') ? 'r' : 
                        portEl.classList.contains('b') ? 'b' : 'l';
            } else if (nodeEl) {
                // If dropping on a node, determine the best port based on direction
                toId = nodeEl.dataset.id;
                const gridRect = this.grid.getBoundingClientRect();
                const x2 = (e.clientX - gridRect.left) / (this.zoom || 1);
                const y2 = (e.clientY - gridRect.top) / (this.zoom || 1);
                const toNode = this.state.nodes.find(n => n.id === toId);
                if (toNode) {
                    toPort = this.chooseSideForDrag(toNode, x2, y2, 'left');
                }
            }
            
            // No hover snap target detection; keep as free connection unless explicit port/node
        }

        // Use the new ConnectionManager to create the connection
        if (fromId && toId && fromId !== toId) {
            const fromNode = this.state.nodes.find(n => n.id === fromId);
            const toNode = this.state.nodes.find(n => n.id === toId);
            
            if (fromNode && toNode) {
            this.pushHistory();
                const connection = this.connectionManager.createConnection(fromNode, toNode, fromPort, toPort);
                
                if (connection) {
            saveFlowData(this.state);
            this.render();
                    
            // Visual feedback for successful connection
                    const toNodeEl = this.grid.querySelector(`.flow-node[data-id="${toId}"]`);
                    if (toNodeEl) {
                        toNodeEl.style.transform = 'scale(1.05)';
                        setTimeout(() => toNodeEl.style.transform = '', 200);
                    }
                    
                    // Animate the new connection
                    this.connectionManager.animateConnection(connection.id, 'pulse');
                }
            }
        }
        this.clearHoverTarget();
        this.edgeDrag = null;
    }

    startEdgeRewire(edgeId, end = 'to') {
        const edge = this.state.edges.find(ed => ed.id === edgeId);
        if (!edge) return;
        this.edgeRewire = { edgeId, end };
        // Create temp path for rewiring
        if (this.svg && !this.tempPathEl) {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('stroke', '#22c1c3');
            path.setAttribute('stroke-width', '2');
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke-linecap', 'butt');
            path.setAttribute('stroke-linejoin', 'miter');
            path.setAttribute('stroke-dasharray', '6,6');
            path.style.pointerEvents = 'none';
            this.svg.appendChild(path);
            this.tempPathEl = path;
        }
    }

    updateTempEdgeRewire(e) {
        if (!this.edgeRewire || !this.tempPathEl) return;
        const edge = this.state.edges.find(ed => ed.id === this.edgeRewire.edgeId);
        if (!edge) return;
        const gridRect = this.grid.getBoundingClientRect();
        const rawX = e.clientX - gridRect.left;
        const rawY = e.clientY - gridRect.top;
        const pointerX = rawX / (this.zoom || 1);
        const pointerY = rawY / (this.zoom || 1);
        let fixedNode = null;
        if (this.edgeRewire.end === 'to') {
            const base = this.state.nodes.find(n => n.id === edge.from);
            if (base) fixedNode = { ...base, x: base.x, y: base.y };
        } else {
            const base = this.state.nodes.find(n => n.id === edge.to);
            if (base) fixedNode = { ...base, x: base.x, y: base.y };
        }
        if (!fixedNode) return;
        const sides = this.chooseSidesForNodes(fixedNode, { x: pointerX, y: pointerY, kind: 'process' });
        const side = this.edgeRewire.end === 'to' ? sides.fromSide : sides.toSide;
        let p = this.getAnchor(fixedNode, side);
        const approach = this.chooseApproachSide(p.x, p.y, pointerX, pointerY);
        // Prefer straight line; otherwise ensure final segment is perpendicular to target side
        const alignedHoriz = Math.abs(pointerY - p.y) < 0.5;
        const alignedVert = Math.abs(pointerX - p.x) < 0.5;
        let d = '';
        if (alignedHoriz || alignedVert) {
            d = `M ${p.x} ${p.y} L ${pointerX} ${pointerY}`;
        } else if (approach === 'left' || approach === 'right') {
            d = `M ${p.x} ${p.y} L ${p.x} ${pointerY} L ${pointerX} ${pointerY}`;
        } else {
            d = `M ${p.x} ${p.y} L ${pointerX} ${p.y} L ${pointerX} ${pointerY}`;
        }
        this.tempPathEl.setAttribute('d', d);
        // No hover snap target detection
    }

    finishEdgeRewire(e) {
        const edge = this.state.edges.find(ed => ed.id === (this.edgeRewire && this.edgeRewire.edgeId));
        if (this.tempPathEl && this.tempPathEl.parentNode) this.tempPathEl.parentNode.removeChild(this.tempPathEl);
        this.tempPathEl = null;
        if (!edge) { this.edgeRewire = null; this.clearHoverTarget(); return; }
        let toId = null;
        if (e && typeof e.clientX === 'number' && typeof e.clientY === 'number') {
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const nodeEl = el && el.closest ? el.closest('.flow-node') : null;
            if (nodeEl) toId = nodeEl.dataset.id;
            // No hover snap target detection on rewire
        }
        if (toId) {
            const nextFrom = this.edgeRewire.end === 'from' ? toId : edge.from;
            const nextTo = this.edgeRewire.end === 'to' ? toId : edge.to;
            if (nextFrom !== nextTo && !this.edgeExists(nextFrom, nextTo)) {
            this.pushHistory();
            if (this.edgeRewire.end === 'to' && toId !== edge.from) edge.to = toId;
            if (this.edgeRewire.end === 'from' && toId !== edge.to) edge.from = toId;
            saveFlowData(this.state);
            this.render();
            }
        }
        this.clearHoverTarget();
        this.edgeRewire = null;
    }

    // Check if an edge already exists between from->to
    edgeExists(fromId, toId) {
        return this.state.edges.some(ed => ed.from === fromId && ed.to === toId);
    }

    // Check if the reverse-direction edge exists (to -> from)
    reverseEdgeExists(fromId, toId) {
        return this.state.edges.some(ed => ed.from === toId && ed.to === fromId);
    }

    seedExample() {
        try {
            const n1 = { id: generateId('node'), kind: 'process', label: 'Start', x: 80, y: 80 };
            const n2 = { id: generateId('node'), kind: 'process', label: 'Step 2', x: 300, y: 80 };
            const n3 = { id: generateId('node'), kind: 'process', label: 'End', x: 520, y: 80 };
            if (!Array.isArray(this.state.nodes)) this.state.nodes = [];
            if (!Array.isArray(this.state.edges)) this.state.edges = [];
            this.state.nodes.push(n1, n2, n3);
            this.state.edges.push(
                { id: generateId('edge'), from: n1.id, to: n2.id },
                { id: generateId('edge'), from: n2.id, to: n3.id }
            );
            saveFlowData(this.state);
        } catch {}
    }

    // Returns node id if pointer is within expanded bounding box, else null
    findSnapTarget(pointerX, pointerY, margin = 16) {
        const nodes = Array.from(this.grid.querySelectorAll('.flow-node'));
        let best = { id: null, dist: Infinity };
        for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            const rect = el.getBoundingClientRect();
            const gridRect = this.grid.getBoundingClientRect();
            const left = rect.left - gridRect.left - margin;
            const top = rect.top - gridRect.top - margin;
            const right = rect.right - gridRect.left + margin;
            const bottom = rect.bottom - gridRect.top + margin;
            if (pointerX >= left && pointerX <= right && pointerY >= top && pointerY <= bottom) {
                const cx = (left + right) / 2;
                const cy = (top + bottom) / 2;
                const d = Math.hypot(pointerX - cx, pointerY - cy);
                if (d < best.dist) best = { id: el.dataset.id, dist: d };
            }
        }
        return best.id;
    }


    startConnect(nodeId, port) {
        if (!this.connectMode) return;
        if (!this.tempConnection) {
            this.tempConnection = { fromNodeId: nodeId, fromPort: port };
        } else {
            if (this.tempConnection.fromNodeId !== nodeId) {
                if (!this.edgeExists(this.tempConnection.fromNodeId, nodeId)) {
                this.pushHistory();
                this.state.edges.push({ id: generateId('edge'), from: this.tempConnection.fromNodeId, to: nodeId });
                saveFlowData(this.state);
                }
                this.tempConnection = null;
                this.render();
            }
        }
    }

    toggleConnectMode() {
        this.connectMode = !this.connectMode;
        this.updateToolbarState();
    }

    pushHistory() {
        this.history.push(JSON.stringify(this.state));
        if (this.history.length > 100) this.history.shift();
        this.future.length = 0; // clear redo
        this.updateToolbarState();
    }

    undo() {
        if (!this.history.length) return;
        this.future.push(JSON.stringify(this.state));
        const prev = this.history.pop();
        this.state = JSON.parse(prev);
        saveFlowData(this.state);
        this.render();
        this.updateToolbarState();
    }

    redo() {
        if (!this.future.length) return;
        this.history.push(JSON.stringify(this.state));
        const next = this.future.pop();
        this.state = JSON.parse(next);
        saveFlowData(this.state);
        this.render();
        this.updateToolbarState();
    }

    persist() { saveFlowData(this.state); }

    toggleEdges() { this.showEdges = !this.showEdges; this.render(); }
    
    toggleGrid() { 
        // Toggle only grid visuals; snapping logic is removed
        this.gridEnabled = !this.gridEnabled; 
        try { this.state.gridEnabled = this.gridEnabled; saveFlowData(this.state); } catch {}
        this.render(); 
        this.updateToolbarState();
    }
    
    snapAllNodesToGrid() { /* disabled */ }
    
    centerDecisionNodes() { /* disabled */ }
    
    // Force center all decision nodes (useful for fixing misaligned nodes)
    forceCenterDecisionNodes() {
        console.log('Forcing all decision nodes to center...');
        console.log('Disabled');
    }
    
    // Test method to verify centering math
    testCentering() {
        console.log('=== Decision Node Centering Test ===');
        console.log(`Column Width: ${this.columnWidth}px`);
        console.log(`Decision Size: ${this.decisionSize}px`);
        console.log(`Decision Half-Size: ${this.decisionSize / 2}px`);
        
        for (let i = 0; i < 5; i++) {
            const columnStart = i * this.columnWidth;
            const columnEnd = columnStart + this.columnWidth;
            const columnCenter = columnStart + (this.columnWidth / 2);
            const nodeTopLeft = columnCenter - (this.decisionSize / 2);
            const nodeCenter = nodeTopLeft + (this.decisionSize / 2);
            
            console.log(`Column ${i}: ${columnStart}px - ${columnEnd}px`);
            console.log(`  Column Center: ${columnCenter}px`);
            console.log(`  Node Top-Left: ${nodeTopLeft}px`);
            console.log(`  Node Center: ${nodeCenter}px`);
            console.log(`  Node should be centered: ${Math.abs(nodeCenter - columnCenter) < 1 ? 'YES' : 'NO'}`);
        }
        
        // Test current decision nodes
        console.log('\n=== Current Decision Nodes ===');
        this.state.nodes.forEach((node, index) => {
            if (node.kind === 'decision') {
                const columnIndex = Math.round(node.x / this.columnWidth);
                const columnCenter = (columnIndex * this.columnWidth) + (this.columnWidth / 2);
                const expectedX = columnCenter - (this.decisionSize / 2);
                const actualCenter = node.x + (this.decisionSize / 2);
                const isCentered = Math.abs(actualCenter - columnCenter) < 1;
                
                console.log(`Decision Node ${index}:`);
                console.log(`  Position: x=${node.x}px, y=${node.y}px`);
                console.log(`  Column: ${columnIndex} (${columnIndex * this.columnWidth}px - ${(columnIndex + 1) * this.columnWidth}px)`);
                console.log(`  Column Center: ${columnCenter}px`);
                console.log(`  Expected X: ${expectedX}px`);
                console.log(`  Actual Center: ${actualCenter}px`);
                console.log(`  Is Centered: ${isCentered ? 'YES' : 'NO'}`);
                console.log(`  Offset: ${actualCenter - columnCenter}px`);
            }
        });
    }
    
    // Geometry helpers
    getNodeSize(node) {
        // Decision nodes are fixed-size squares for consistent geometry
        if (node && node.kind === 'decision') {
            return { w: this.decisionSize, h: this.decisionSize };
        }
        if (node && typeof node.w === 'number' && typeof node.h === 'number') {
            return { w: Math.max(140, node.w), h: Math.max(44, node.h) };
        }
        return { w: 140, h: 44 };
    }

    // Ultra-smooth node position update with maximum FPS optimization
    updateNodePosition() {
        if (!this.drag || !this.dragMousePos) return;
        
        // Initialize drag cache on first update
        if (!this.dragCache) {
            this.dragCache = {
                wrap: this.grid.getBoundingClientRect(),
                node: this.state.nodes.find(n => n.id === this.drag.id),
                zoom: this.zoom || 1,
                lastUpdate: performance.now()
            };
        }
        
        const { wrap, node, zoom } = this.dragCache;
        if (!node) return;
        
        // Calculate new position with sub-pixel precision
        const rawLeft = (this.dragMousePos.clientX - wrap.left - this.drag.offsetX) / zoom;
        const rawTop = (this.dragMousePos.clientY - wrap.top - this.drag.offsetY) / zoom;
        
        // Store previous position for change detection
        const prevX = node.x;
        const prevY = node.y;
        
        // Apply grid snapping only if enabled and requested during drag
        if (this.gridEnabled && this.snapDuringDrag) {
            node.x = Math.max(0, this.snapToGrid(rawLeft, 'x', node));
            node.y = Math.max(0, this.snapToGrid(rawTop, 'y', node));
            
            // Special handling for decision nodes during drag
            if (node.kind === 'decision') {
                // Ensure decision nodes stay centered in columns during drag
                const columnIndex = Math.round(node.x / this.columnWidth);
                const columnCenter = (columnIndex * this.columnWidth) + (this.columnWidth / 2);
                node.x = columnCenter - (this.decisionSize / 2);
            }
        } else {
            node.x = Math.max(0, rawLeft);
            node.y = Math.max(0, rawTop);
        }
        
        // Always update DOM for maximum smoothness (even tiny changes)
        if (this.dragElement) {
            // Use transform3d with sub-pixel precision for ultra-smooth movement
            this.dragElement.style.transform = `translate3d(${node.x}px, ${node.y}px, 0)`;
            this.dragElement.style.left = '0px';
            this.dragElement.style.top = '0px';
        }
        
        // Throttle edge updates to maintain 60fps
        const now = performance.now();
        if (now - this.dragCache.lastUpdate > 16) { // ~60fps
            // Update connectors for the moved node
            this.updateNodeConnectors(this.drag.id);
            this.scheduleEdgeUpdate();
            this.dragCache.lastUpdate = now;
        }
    }
    
    // Optimized edge update scheduling
    scheduleEdgeUpdate() {
        if (this.edgeUpdateFrame) {
            cancelAnimationFrame(this.edgeUpdateFrame);
        }
        
        this.edgeUpdateFrame = requestAnimationFrame(() => {
            this.renderEdgesOnly();
            this.edgeUpdateFrame = null;
        });
    }

    // Update connectors for a moved node
    updateNodeConnectors(nodeId) {
        // Filter connectors that are connected to this node
        const connectedEdges = this.state.edges.filter(edge => 
            edge.from === nodeId || edge.to === nodeId
        );
        
        // Update each connector's points
        connectedEdges.forEach(edge => {
            const fromNode = this.state.nodes.find(n => n.id === edge.from);
            const toNode = this.state.nodes.find(n => n.id === edge.to);
            
            if (fromNode && toNode) {
                // Get the connection sides from the edge ports
                const portToSide = { 't': 'top', 'r': 'right', 'b': 'bottom', 'l': 'left' };
                const fromSide = portToSide[edge.fromPort] || 'right';
                const toSide = portToSide[edge.toPort] || 'left';
                
                // Update the connector path
                const newPath = this.updateConnector(fromNode, fromSide, toNode, toSide);
                
                // Update the edge's points if it has a points property
                if (edge.points) {
                    edge.points = newPath;
                }
            }
        });
    }

    // Move a node and update all its connectors (following the provided pattern)
    moveNode(nodeId, newX, newY) {
        const node = this.state.nodes.find(n => n.id === nodeId);
        if (!node) return;
        
        // Update node position
        node.x = newX;
        node.y = newY;
        
        // Update all connectors connected to this node
        this.state.edges
            .filter(edge => edge.from === nodeId || edge.to === nodeId)
            .forEach(edge => {
                const fromNode = this.state.nodes.find(n => n.id === edge.from);
                const toNode = this.state.nodes.find(n => n.id === edge.to);
                
                if (fromNode && toNode) {
                    const portToSide = { 't': 'top', 'r': 'right', 'b': 'bottom', 'l': 'left' };
                    const fromSide = portToSide[edge.fromPort] || 'right';
                    const toSide = portToSide[edge.toPort] || 'left';
                    
                    // Update connector points using the updateConnector method
                    edge.points = this.updateConnector(fromNode, fromSide, toNode, toSide);
                }
            });
        
        // Trigger a re-render to update the visual representation
        this.render();
    }

    // Move multiple nodes and update all their connectors
    moveNodes(nodeMovements) {
        // nodeMovements should be an array of { id, x, y } objects
        const movedNodeIds = new Set();
        
        // Update all node positions first
        nodeMovements.forEach(movement => {
            const node = this.state.nodes.find(n => n.id === movement.id);
            if (node) {
                node.x = movement.x;
                node.y = movement.y;
                movedNodeIds.add(movement.id);
            }
        });
        
        // Update all connectors for all moved nodes
        this.state.edges
            .filter(edge => movedNodeIds.has(edge.from) || movedNodeIds.has(edge.to))
            .forEach(edge => {
                const fromNode = this.state.nodes.find(n => n.id === edge.from);
                const toNode = this.state.nodes.find(n => n.id === edge.to);
                
                if (fromNode && toNode) {
                    const portToSide = { 't': 'top', 'r': 'right', 'b': 'bottom', 'l': 'left' };
                    const fromSide = portToSide[edge.fromPort] || 'right';
                    const toSide = portToSide[edge.toPort] || 'left';
                    
                    // Update connector points using the updateConnector method
                    edge.points = this.updateConnector(fromNode, fromSide, toNode, toSide);
                }
            });
        
        // Trigger a re-render to update the visual representation
        this.render();
    }

    snapToGrid(value, axis, node = null) {
        if (!this.gridEnabled) return value;
        
        if (axis === 'x') {
            // Snap to column grid (columnWidth) and center node within column
            if (node) {
                const nodeSize = this.getNodeSize(node);
                const nodeLeft = value;
                const nodeRight = value + nodeSize.w;
                const centerX = nodeLeft + (nodeSize.w / 2);
                
                // Nearest vertical boundary between columns
                const boundaryIdx = Math.round(centerX / this.columnWidth);
                const boundaryX = boundaryIdx * this.columnWidth;
                
                // Portion of node to the right of the boundary
                const rightPixels = Math.max(0, Math.min(nodeRight - boundaryX, nodeSize.w));
                const portionRight = rightPixels / nodeSize.w; // 0..1
                
                // Choose column to snap: right if > 0.5 on right; else left
                const snapColIdx = portionRight > 0.5 ? boundaryIdx : (boundaryIdx - 1);
                const snapCenterX = (snapColIdx * this.columnWidth) + (this.columnWidth / 2);
                const snappedX = snapCenterX - (nodeSize.w / 2);
                
                // For decision nodes, ensure perfect centering
                if (node.kind === 'decision') {
                    // Decision nodes should be perfectly centered in columns
                    // Column 0: 0-200px, center at 100px, node top-left at 50px
                    // Column 1: 200-400px, center at 300px, node top-left at 250px
                    // Column 2: 400-600px, center at 500px, node top-left at 450px
                    
                    // Calculate which column this position is closest to
                    const columnIndex = Math.round(centerX / this.columnWidth);
                    
                    // Calculate the column center
                    const columnCenter = (columnIndex * this.columnWidth) + (this.columnWidth / 2);
                    
                    // Position the node so its center aligns with the column center
                    const nodeTopLeft = columnCenter - (this.decisionSize / 2);
                    return Math.max(0, nodeTopLeft);
                }
                
                return Math.max(0, snappedX);
            }
            // Fallback for non-node snapping
            const gridPosition = Math.round(value / this.columnWidth) * this.columnWidth;
            return gridPosition;
        } else {
            // Snap to regular grid (gridSize) and center node within grid cell
            const gridPosition = Math.round(value / this.gridSize) * this.gridSize;
            if (node) {
                const nodeSize = this.getNodeSize(node);
                const centerOffset = (this.gridSize - nodeSize.h) / 2;
                return Math.max(0, gridPosition + centerOffset);
            }
            return gridPosition;
        }
    }

    renderGridLines(grid, width, height) {
        // Create grid container
        const gridContainer = document.createElement('div');
        gridContainer.className = 'flow-grid-lines';
        gridContainer.style.position = 'absolute';
        gridContainer.style.top = '0';
        gridContainer.style.left = '0';
        gridContainer.style.width = '100%';
        gridContainer.style.height = '100%';
        gridContainer.style.pointerEvents = 'none';
        gridContainer.style.zIndex = '1';
        
        // Vertical column lines
        for (let x = 0; x <= width; x += this.columnWidth) {
            const line = document.createElement('div');
            line.className = 'grid-line grid-line-vertical';
            line.style.position = 'absolute';
            line.style.left = x + 'px';
            line.style.top = '0';
            line.style.width = '1px';
            line.style.height = '100%';
            line.style.background = 'rgba(0, 0, 0, 0.1)';
            gridContainer.appendChild(line);
        }
        
        // Horizontal grid lines
        for (let y = 0; y <= height; y += this.gridSize) {
            const line = document.createElement('div');
            line.className = 'grid-line grid-line-horizontal';
            line.style.position = 'absolute';
            line.style.left = '0';
            line.style.top = y + 'px';
            line.style.width = '100%';
            line.style.height = '1px';
            line.style.background = 'rgba(0, 0, 0, 0.05)';
            gridContainer.appendChild(line);
        }
        
        grid.appendChild(gridContainer);
    }

    getNodeCenter(node) { const sz = this.getNodeSize(node); return { cx: node.x + sz.w / 2, cy: node.y + sz.h / 2 }; }
    // For diamond (decision) nodes, compute intersection point of a ray from center toward target with the diamond boundary
    getDecisionIntersection(node, targetX, targetY) {
        const { cx, cy } = this.getNodeCenter(node);
        const sz = this.getNodeSize(node);
        const a = Math.min(sz.w, sz.h) / 2; // diamond radius from min dimension
        let dx = targetX - cx;
        let dy = targetY - cy;
        if (dx === 0 && dy === 0) return { x: cx + a, y: cy }; // fallback to right corner
        const absdx = Math.abs(dx);
        const absdy = Math.abs(dy);
        const t = a / (absdx + absdy); // intersection factor for |x-cx| + |y-cy| = a
        return { x: cx + dx * t, y: cy + dy * t };
    }
    
    // Get the actual port position on the node edge
    getPortPosition(node, side) {
        const sz = this.getNodeSize(node);
        const portSize = 8; // port dot size from CSS
        const portOffset = 4; // port offset from CSS
        
        // Calculate coordinates in grid space (no zoom multiplication needed)
        // The SVG viewBox will handle the coordinate mapping automatically
        
        switch (side) {
            case 'top':
            case 't':
                return { x: node.x + sz.w / 2, y: node.y - portOffset };
            case 'right':
            case 'r':
                return { x: node.x + sz.w + portOffset, y: node.y + sz.h / 2 };
            case 'bottom':
            case 'b':
                return { x: node.x + sz.w / 2, y: node.y + sz.h + portOffset };
            case 'left':
            case 'l':
                return { x: node.x - portOffset, y: node.y + sz.h / 2 };
            default:
                return { x: node.x + sz.w / 2, y: node.y + sz.h / 2 };
        }
    }
    
    // New anchor point calculation logic - now uses port positions
    getAnchor(node, side) {
        // Use port positions instead of center
        return this.getPortPosition(node, side);
    }

    // Legacy method for backward compatibility - maps old side names to new ones
    getPortPoint(node, side) {
        // Map old side names to new ones
        const sideMap = {
            'l': 'left',
            'r': 'right', 
            't': 'top',
            'b': 'bottom'
        };
        
        const newSide = sideMap[side] || side;
        return this.getAnchor(node, newSide);
    }

    // Create zigzag connector path
    zigzagConnector(x1, y1, x2, y2, options = {}) {
        const { mode = 'horizontal-first' } = options;
        
        // Round coordinates to avoid sub-pixel rendering issues
        const round = (n) => Math.round(n * 100) / 100;
        x1 = round(x1);
        y1 = round(y1);
        x2 = round(x2);
        y2 = round(y2);
        
        if (mode === 'horizontal-first') {
            // Horizontal first: go right/left, then up/down
            const midX = round(x1 + (x2 - x1) / 2);
            return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
        } else {
            // Vertical first: go up/down, then right/left
            const midY = round(y1 + (y2 - y1) / 2);
            return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
        }
    }

    // Update connector using new logic with obstacle avoidance
    updateConnector(nodeA, sideA, nodeB, sideB) {
        const start = this.getAnchor(nodeA, sideA);
        const end = this.getAnchor(nodeB, sideB);

        // For now, use simple zigzag connector to ensure connections work
        // TODO: Re-enable pathfinding once connection creation is stable
        return this.zigzagConnector(start.x, start.y, end.x, end.y, {
            mode: (sideA === "left" || sideA === "right") ? "horizontal-first" : "vertical-first"
        });
        
        /* Pathfinding code - temporarily disabled
        // Use pathfinding to avoid crossing over nodes
        if (this.connectionManager && this.connectionManager.routingGrid) {
            try {
                // Update the routing grid with current node positions
                this.connectionManager.updateRoutingGrid();
                
                // Find a path that avoids obstacles
                const path = this.connectionManager.findPath(start, end);
                
                if (path && path.length > 2) {
                    // Convert path points to SVG path string
                    return this.pathToSVG(path);
                }
            } catch (error) {
                console.warn('Pathfinding failed, using fallback:', error);
            }
        }
        
        // Fallback to zigzag connector if pathfinding fails
        return this.zigzagConnector(start.x, start.y, end.x, end.y, {
            mode: (sideA === "left" || sideA === "right") ? "horizontal-first" : "vertical-first"
        });
        */
    }

    // Convert pathfinding result to SVG path string
    pathToSVG(pathPoints) {
        if (!pathPoints || pathPoints.length < 2) return '';
        
        // Round coordinates for clean rendering
        const round = (n) => Math.round(n * 100) / 100;
        
        let pathString = `M ${round(pathPoints[0].x)} ${round(pathPoints[0].y)}`;
        
        for (let i = 1; i < pathPoints.length; i++) {
            pathString += ` L ${round(pathPoints[i].x)} ${round(pathPoints[i].y)}`;
        }
        
        return pathString;
    }
    
    
    // Move a point slightly inside a shape toward its interior by backing off from the target direction
    nudgeInside(point, towardX, towardY, distance = 1) {
        const vx = towardX - point.x; const vy = towardY - point.y; const len = Math.hypot(vx, vy) || 1;
        return { x: point.x - (vx / len) * distance, y: point.y - (vy / len) * distance };
    }
    chooseSidesForNodes(from, to) {
        const { cx: fx, cy: fy } = this.getNodeCenter(from);
        const { cx: tx, cy: ty } = this.getNodeCenter(to);
        const dx = tx - fx; const dy = ty - fy;
        if (Math.abs(dx) >= Math.abs(dy)) {
            return { fromSide: dx >= 0 ? 'right' : 'left', toSide: dx >= 0 ? 'left' : 'right' };
        }
        return { fromSide: dy >= 0 ? 'bottom' : 'top', toSide: dy >= 0 ? 'top' : 'bottom' };
    }
    chooseSideForDrag(from, pointerX, pointerY, fallback = 'right') {
        const { cx, cy } = this.getNodeCenter(from);
        const dx = pointerX - cx; const dy = pointerY - cy;
        if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
        return dy >= 0 ? 'bottom' : 'top';
    }

    // Decide which side of the target should be approached, based on relative position
    chooseApproachSide(x1, y1, x2, y2) {
        const dx = x2 - x1; const dy = y2 - y1;
        if (Math.abs(dx) >= Math.abs(dy)) {
            return dx >= 0 ? 'left' : 'right'; // if target is to the right, approach its left side
        }
        return dy >= 0 ? 'top' : 'bottom'; // if target is below, approach its top side
    }

    // Build orthogonal (right-angle) path between two points - more direct approach
    buildOrthogonalPath(x1, y1, x2, y2, orient = 'h') {
        // orient 'h' = horizontal first, 'v' = vertical first
        // Create more direct path with minimal corners for better UX
        
        const dx = Math.abs(x2 - x1);
        const dy = Math.abs(y2 - y1);
        const eps = Math.max(24, Math.floor(this.gridSize * 0.8));
        const offset = 20; // Reduced offset for more direct paths
        
        if (dx <= eps) {
            // Nearly vertical alignment → draw a single vertical segment
            return `M ${x1} ${y1} L ${x1} ${y2}`;
        }
        if (dy <= eps) {
            // Nearly horizontal alignment → draw a single horizontal segment
            return `M ${x1} ${y1} L ${x2} ${y1}`;
        }

        // Create more direct path with minimal corners
        if (orient === 'h') {
            // Horizontal first: start → horizontal → vertical → end (L-shape)
            const midX = x1 < x2 ? x2 - offset : x2 + offset;
            return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
        } else {
            // Vertical first: start → vertical → horizontal → end (L-shape)
            const midY = y1 < y2 ? y2 - offset : y2 + offset;
            return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
        }
    }

    buildOrthogonalPathToSide(x1, y1, x2, y2, toSide) {
        // Free routing: minimal L-shape with a small approach offset, no snapping, no avoidance
        const offset = 20;
        if (toSide === 'left') {
            const midX = x2 - offset;
            return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
        }
        if (toSide === 'right') {
            const midX = x2 + offset;
            return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
        }
        if (toSide === 'top') {
            const midY = y2 - offset;
            return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
        }
        // default bottom
        const midY = y2 + offset;
        return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
    }

    // Preview-style connector: matches original preview logic exactly
    // Supports straight lines and 1-angle L-shapes based on alignment
    buildPreviewStyleConnector(x1, y1, x2, y2, approach) {
        const alignedHoriz = Math.abs(y2 - y1) < 0.5;
        const alignedVert = Math.abs(x2 - x1) < 0.5;
        
        // Perfect alignment: straight line
        if (alignedHoriz || alignedVert) {
            return `M ${x1} ${y1} L ${x2} ${y2}`;
        }
        
        // 1-angle L-shape based on approach direction
        if (approach === 'left' || approach === 'right') {
            // Target is left/right: vertical first, then horizontal
            return `M ${x1} ${y1} L ${x1} ${y2} L ${x2} ${y2}`;
        } else {
            // Target is top/bottom: horizontal first, then vertical
            return `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2}`;
        }
    }

    // Flexible connector: supports 1-angle (L) and 2-angle (Z) paths based on alignment
    // Uses same logic as preview for consistent behavior
    buildFlexibleConnector(x1, y1, x2, y2, targetSide) {
        const alignedHoriz = Math.abs(y2 - y1) < 0.5;
        const alignedVert = Math.abs(x2 - x1) < 0.5;
        
        // Perfect alignment: straight line
        if (alignedHoriz || alignedVert) {
            return `M ${x1} ${y1} L ${x2} ${y2}`;
        }
        
        const side = targetSide || this.chooseApproachSide(x1, y1, x2, y2);
        
        // 2-angle connector (Z-shape) for better routing
        if (side === 'left' || side === 'right') {
            // Target is left/right: horizontal first, then vertical, then horizontal
            const midX = side === 'left' ? x2 - 20 : x2 + 20;
            return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
        } else {
            // Target is top/bottom: vertical first, then horizontal, then vertical  
            const midY = side === 'top' ? y2 - 20 : y2 + 20;
            return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
        }
    }

    // Unified connector: prefer straight if aligned, otherwise single-bend L
    // Ensure final segment is perpendicular to the target side/approach
    buildPerpendicularL(x1, y1, x2, y2, targetSide) {
        const alignedHoriz = Math.abs(y2 - y1) < 0.5;
        const alignedVert = Math.abs(x2 - x1) < 0.5;
        if (alignedHoriz || alignedVert) return `M ${x1} ${y1} L ${x2} ${y2}`;
        const side = targetSide || this.chooseApproachSide(x1, y1, x2, y2);
        if (side === 'left' || side === 'right') {
            // end on left/right → final is horizontal
            return `M ${x1} ${y1} L ${x1} ${y2} L ${x2} ${y2}`;
        }
        // end on top/bottom → final is vertical
        return `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2}`;
    }

    // Structured orthogonal routing for clearer, more readable paths
    // Adds grid-snapped waypoints and deterministic lane offsets to reduce overlaps
    buildStructuredOrthogonalPathToSide(x1, y1, x2, y2, toSide, edgeId = '') {
        const grid = Math.max(40, this.gridSize);
        const lane = Math.max(8, Math.floor(this.gridSize / 2));
        // Stable small offset by edge id to de-stack coincident edges
        let laneOffset = 0;
        if (edgeId) {
            let h = 0;
            for (let i = 0; i < edgeId.length; i++) h = (h * 31 + edgeId.charCodeAt(i)) | 0;
            const k = Math.abs(h % 3) - 1; // -1, 0, 1
            laneOffset = k * lane;
        }

        // Snap helpers
        const snap = (v) => Math.round(v / grid) * grid;

        // Start/end snapped baselines
        let sx = x1, sy = y1, tx = x2, ty = y2;
        const dx = tx - sx; const dy = ty - sy;

        // Primary orientation: follow dominant axis first for structure
        const horizontalFirst = Math.abs(dx) >= Math.abs(dy);

        // Approach offsets near the target side for visibility
        const approach = Math.max(24, Math.floor(grid * 0.5));

        const points = [];
        points.push({ x: sx, y: sy });

        if (horizontalFirst) {
            // Horizontal corridor then vertical approach to target side
            const corridorY = snap(sy + laneOffset);
            points.push({ x: sx, y: corridorY });
            const preApproachX = toSide === 'left' ? tx - approach : toSide === 'right' ? tx + approach : snap(tx);
            points.push({ x: preApproachX, y: corridorY });
            const approachY = toSide === 'top' ? ty - approach : toSide === 'bottom' ? ty + approach : snap(ty);
            points.push({ x: preApproachX, y: approachY });
        } else {
            // Vertical corridor then horizontal approach to target side
            const corridorX = snap(sx + laneOffset);
            points.push({ x: corridorX, y: sy });
            const preApproachY = toSide === 'top' ? ty - approach : toSide === 'bottom' ? ty + approach : snap(ty);
            points.push({ x: corridorX, y: preApproachY });
            const approachX = toSide === 'left' ? tx - approach : toSide === 'right' ? tx + approach : snap(tx);
            points.push({ x: approachX, y: preApproachY });
        }

        // Final leg into target
        points.push({ x: tx, y: ty });

        // Build path string with axis-aligned segments, removing consecutive duplicates
        const seq = [points[0]];
        for (let i = 1; i < points.length; i++) {
            const a = seq[seq.length - 1], b = points[i];
            if (!a || a.x !== b.x || a.y !== b.y) seq.push(b);
        }
        let d = `M ${seq[0].x} ${seq[0].y}`;
        for (let i = 1; i < seq.length; i++) d += ` L ${seq[i].x} ${seq[i].y}`;
        return d;
    }

    // Build an orthogonal path with a small lateral offset to avoid overlapping
    // when a reverse-direction twin edge exists between the same nodes.
    buildTwinOffsetPath(x1, y1, x2, y2, orient = 'h', sign = 1) {
        const eps = Math.max(24, Math.floor(this.gridSize * 0.8));
        const lane = Math.max(8, Math.floor(this.gridSize / 5));
        const off = lane * (sign >= 0 ? 1 : -1);
        const dx = Math.abs(x2 - x1);
        const dy = Math.abs(y2 - y1);
        if (dx <= eps) {
            // Nearly vertical → add small horizontal detour in the middle
            const midY = Math.round((y1 + y2) / 2);
            return `M ${x1} ${y1} L ${x1 + off} ${y1} L ${x1 + off} ${midY} L ${x2 + off} ${midY} L ${x2 + off} ${y2} L ${x2} ${y2}`;
        }
        if (dy <= eps) {
            // Nearly horizontal → add small vertical detour in the middle
            const midX = Math.round((x1 + x2) / 2);
            return `M ${x1} ${y1} L ${x1} ${y1 + off} L ${midX} ${y1 + off} L ${midX} ${y2 + off} L ${x2} ${y2 + off} L ${x2} ${y2}`;
        }
        // General case: defer to base path
        return this.buildOrthogonalPath(x1, y1, x2, y2, orient);
    }
    updateToolbarState() {
        const hasSelection = !!(this.grid && this.grid.querySelector('.flow-node.selected')) || !!this.selectedEdgeId;
        const canUndo = this.history.length > 0;
        const canRedo = this.future.length > 0;
        const ids = [
            'flowToolDelete',
            'flowToolUndo',
            'flowToolRedo',
            'flowToolGrid'
        ];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            if (id === 'flowToolDelete') el.style.display = hasSelection ? '' : 'none';
            if (id === 'flowToolUndo') el.style.display = canUndo ? '' : 'none';
            if (id === 'flowToolRedo') el.style.display = canRedo ? '' : 'none';
            if (id === 'flowToolGrid') {
                el.classList.toggle('active', this.gridEnabled);
                el.title = this.gridEnabled ? 'Disable grid snapping' : 'Enable grid snapping';
            }
        });
    }

    exportJSON() {
        const blob = new Blob([JSON.stringify(this.state, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'user-flow.json'; a.click();
        URL.revokeObjectURL(url);
    }

    importJSONFile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(String(reader.result));
                if (Array.isArray(data.nodes) && Array.isArray(data.edges)) {
                    this.pushHistory();
                    this.state = { nodes: data.nodes, edges: data.edges };
                    saveFlowData(this.state);
                    this.render();
                } else alert('Invalid JSON structure');
            } catch { alert('Invalid JSON'); }
        };
        reader.readAsText(file);
    }

    exportJPEG() {
        const container = document.getElementById('flowContainer');
        if (!container) return;
        html2canvas(container).then(canvas => {
            const link = document.createElement('a');
            link.download = 'user-flow.jpg';
            link.href = canvas.toDataURL('image/jpeg', 0.92);
            link.click();
        });
    }

    exportPDF() {
        const container = document.getElementById('flowContainer');
        if (!container || !window.jspdf) return;
        html2canvas(container).then(canvas => {
            const imgData = canvas.toDataURL('image/jpeg', 0.92);
            const pdf = new window.jspdf.jsPDF('l', 'pt', [canvas.width, canvas.height]);
            pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width, canvas.height);
            pdf.save('user-flow.pdf');
        });
    }

    // Version history (reuse journey modal UI)
    saveVersion() {
        const key = getScopedKey('flowVersions');
        const raw = localStorage.getItem(key);
        const list = raw ? JSON.parse(raw) : [];
        const snap = JSON.parse(JSON.stringify(this.state));
        const stamp = new Date().toISOString();
        list.unshift({ id: stamp, name: `Version ${list.length + 1}`, at: stamp, data: snap });
        if (list.length > 50) list.length = 50;
        localStorage.setItem(key, JSON.stringify(list));
        this.showSuccessToast('Flow saved successfully!');
    }

    showSuccessToast(message) {
        // Remove any existing toast
        const existingToast = document.querySelector('.success-toast');
        if (existingToast) {
            existingToast.remove();
        }
        
        // Create new toast
        const toast = document.createElement('div');
        toast.className = 'success-toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        
        // Trigger animation
        setTimeout(() => {
            toast.classList.add('show');
        }, 10);
        
        // Auto-remove after 3 seconds
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 3000);
    }

    openHistory() {
        const key = getScopedKey('flowVersions');
        const versions = JSON.parse(localStorage.getItem(key) || '[]');
        const list = document.getElementById('versionsList');
        const modal = document.getElementById('historyModal');
        if (!list || !modal) { alert('History UI not available'); return; }
        list.innerHTML = '';
        versions.forEach(v => {
            const item = document.createElement('div');
            item.style.display = 'flex'; item.style.justifyContent = 'space-between'; item.style.alignItems = 'center';
            item.style.padding = '0.5rem 0';
            const title = document.createElement('div'); title.textContent = `${v.name} – ${new Date(v.at).toLocaleString()}`;
            const actions = document.createElement('div');
            const open = document.createElement('button'); open.className = 'btn btn-primary'; open.textContent = 'Open';
            open.addEventListener('click', () => { this.state = JSON.parse(JSON.stringify(v.data)); saveFlowData(this.state); this.render(); modal.classList.remove('show'); });
            const del = document.createElement('button'); del.className = 'btn btn-secondary'; del.textContent = 'Delete'; del.style.marginLeft = '0.5rem';
            del.addEventListener('click', () => { const next = versions.filter(x => x.id !== v.id); localStorage.setItem(key, JSON.stringify(next)); this.openHistory(); });
            actions.appendChild(open); actions.appendChild(del);
            item.appendChild(title); item.appendChild(actions);
            list.appendChild(item);
        });
        modal.classList.add('show');
    }

    render() {
        // Determine canvas size (infinite growth)
        let maxX = 0, maxY = 0;
        const nodeSize = (n) => ({ w: n.kind === 'decision' ? this.decisionSize : 140, h: n.kind === 'decision' ? this.decisionSize : 44 });
        this.state.nodes.forEach(n => { const sz = nodeSize(n); maxX = Math.max(maxX, n.x + sz.w); maxY = Math.max(maxY, n.y + sz.h); });
        const margin = 400;
        const width = Math.max(this.baseWidth, Math.ceil((maxX + margin) / this.gridSize) * this.gridSize);
        const height = Math.max(this.baseHeight, Math.ceil((maxY + margin) / this.gridSize) * this.gridSize);
        this.grid.style.width = width + 'px';
        this.grid.style.height = height + 'px';
        // Apply current zoom to grid and edges
        this.applyZoom();

        // Nodes
        const grid = this.grid;
        grid.innerHTML = '';
        
        // Grid lines visualization
        if (this.gridEnabled) {
            this.renderGridLines(grid, width, height);
        }
        
        // Sections underlay
        if (Array.isArray(this.state.sections)) {
            this.state.sections.forEach(sec => {
                const el = document.createElement('div');
                el.className = 'flow-section';
                el.style.top = (sec.y || 0) + 'px';
                el.style.height = (sec.h || 600) + 'px';
                grid.appendChild(el);
            });
        }
        const snappedPos = new Map();
        this.state.nodes.forEach(n => {
            const el = document.createElement('div');
            el.className = 'flow-node' + (n.kind === 'decision' ? ' decision' : '');
            el.dataset.id = n.id;
            // Accessibility
            el.setAttribute('role', 'group');
            el.setAttribute('aria-label', (n.kind === 'decision' ? 'Decision: ' : 'Step: ') + (n.label || 'Untitled'));
            el.tabIndex = 0;
            // snap node CENTER to the midpoint between vertical lines for render
            const sz = this.getNodeSize(n);
            const sx = n.x;
            const sy = n.y;
            el.style.left = sx + 'px';
            el.style.top = sy + 'px';
            
            // Removed grid alignment/centering decorations
            // Apply size: decision nodes use fixed size; process nodes may persist w/h
            if (n.kind === 'decision') {
                const side = this.decisionSize;
                el.style.width = side + 'px';
                el.style.height = side + 'px';
            } else {
                if (typeof n.w === 'number') el.style.width = n.w + 'px';
                if (typeof n.h === 'number') el.style.height = n.h + 'px';
            }
            snappedPos.set(n.id, { x: sx, y: sy });
            el.innerHTML = `
                <div class="drag-handle" aria-hidden="true"></div>
                <div class="label" data-placeholder="Text..."></div>
                <div class="ports">
                    <div class="flow-port t"></div>
                    <div class="flow-port r"></div>
                    <div class="flow-port b"></div>
                    <div class="flow-port l"></div>
                </div>
            `;
            // Robust hover handling for drag handle visibility (works even if :hover is blocked by overlays)
            el.addEventListener('mouseenter', () => {
                try { el.classList.add('is-hover'); } catch {}
            });
            el.addEventListener('mouseleave', () => {
                try { el.classList.remove('is-hover'); } catch {}
            });
            // Decision nodes now use the same port system as action nodes (no special labels)
            // Add click handler for selection
            el.addEventListener('click', (evt) => {
                // Always select the node when clicking on it
                this.selectNode(n.id);
            });
            
            // Add double-click handler to entire node for text editing
            el.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                e.preventDefault();
                console.log('Double-click detected on node:', n.id);
                
                // Set flags to prevent drag setup and enable text editing mode
                this.isDoubleClicking = true;
                this.setTextEditingState(true);
                
                // Cancel any pending drag setup immediately
                this.clearDragSetup();
                
                // Find the label element and enable editing
                const labelEl = el.querySelector('.label');
                if (labelEl) {
                    console.log('Enabling editing for label');
                    
                    // For decision nodes, show full text when editing
                    if (n.kind === 'decision') {
                        labelEl.textContent = n.label || '';
                    }
                    
                    // Enable contenteditable for editing
                    labelEl.setAttribute('contenteditable', 'plaintext-only');
                    
                    // Use setTimeout to ensure the contenteditable change takes effect
                    setTimeout(() => {
                        // Focus and select all text for immediate editing
                        labelEl.focus();
                        
                        // Select all text for easy replacement
                        this.selectAllText(labelEl);
                        
                        console.log('Text editing enabled for node:', n.id);
                    }, 10);
                } else {
                    console.log('No label element found');
                }
            });
            // Always-editable label with save-on-input/blur
            const labelEl = el.querySelector('.label');
            if (labelEl) {
                // Start with contenteditable disabled
                labelEl.setAttribute('contenteditable', 'false');
                labelEl.textContent = n.label || '';
                let originalText = labelEl.textContent;
                
                // Double-click editing is now handled by the entire node element
                
                // Prevent app-wide shortcuts while typing inside label
                labelEl.addEventListener('keydown', (e) => {
                    e.stopPropagation();
                    // Keep Enter as newline; prevent Escape from clearing selection globally
                    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); labelEl.blur(); }
                });
                // Auto-grow height downward only as user types (process/action nodes)
                const adjustHeight = () => {
                    try {
                        // Do not adjust decision nodes (fixed-size diamond)
                        if (n.kind === 'decision') return;

                        // Measure required height based on label content
                        // Temporarily let node collapse to content to measure correctly
                        el.style.height = 'auto';

                        const nodePaddingTop = 8; // from .flow-node padding
                        const nodePaddingBottom = 8;
                        const minHeight = 44; // baseline min height

                        const labelHeight = Math.ceil(labelEl.scrollHeight);
                        const desired = Math.max(minHeight, labelHeight + nodePaddingTop + nodePaddingBottom);

                        // Only update if changed to avoid thrash
                        const currentH = typeof n.h === 'number' ? n.h : el.getBoundingClientRect().height;
                        if (Math.abs(desired - currentH) > 0.5) {
                            n.h = desired;
                            el.style.height = desired + 'px';
                            // Persist and update edges without full render
                            try { saveFlowData(this.state); } catch {}
                            this.renderEdgesOnly();
                        } else {
                            // Restore explicit height if no change
                            el.style.height = currentH + 'px';
                        }
                    } catch (err) {
                        // Fail-safe: do nothing on errors
                    }
                };
                // Persist on input (debounced via microtask) and on blur
                let saveScheduled = false;
                const sanitizeDecisionLetters = () => {
                    if (n.kind !== 'decision') return false;
                    const raw = labelEl.textContent || '';
                    // Keep only letters (Unicode)
                    const letters = (raw.match(/\p{L}/gu) || []).join('');
                    if (letters !== raw) {
                        labelEl.textContent = letters;
                        return true;
                    }
                    return false;
                };
                const updateDecisionDisplay = () => {
                    if (n.kind !== 'decision') return;
                    const full = (n.label || '').trim();
                    const maxLetters = 10;
                    const onlyLetters = (full.match(/\p{L}/gu) || []).join('');
                    const shown = onlyLetters.length > maxLetters ? onlyLetters.slice(0, maxLetters) + '...' : onlyLetters;
                    // Only change display when not editing
                    if (labelEl.getAttribute('contenteditable') !== 'plaintext-only') {
                        labelEl.textContent = shown;
                    }
                };
                const scheduleSave = () => {
                    if (saveScheduled) return;
                    saveScheduled = true;
                    Promise.resolve().then(() => {
                        saveScheduled = false;
                        if (n.kind === 'decision') sanitizeDecisionLetters();
                        const next = (labelEl.textContent || '').trim();
                        if (next !== originalText) {
                            this.pushHistory();
                            n.label = next;
                            originalText = next;
                            saveFlowData(this.state);
                        }
                        adjustHeight();
                        this.renderEdgesOnly();
                        if (n.kind === 'decision') updateDecisionDisplay();
                    });
                };
                labelEl.addEventListener('input', () => {
                    if (n.kind === 'decision') sanitizeDecisionLetters();
                    adjustHeight();
                    scheduleSave();
                });
                labelEl.addEventListener('blur', () => {
                    console.log('Label blur event - disabling editing');
                    // Disable contenteditable when done editing but keep it ready for future edits
                    labelEl.setAttribute('contenteditable', 'false');
                    if (n.kind === 'decision') { sanitizeDecisionLetters(); updateDecisionDisplay(); }
                    scheduleSave();
                    // Clear any drag setup timer when done editing
                    this.clearDragSetup();
                    // Reset flags
                    this.isDoubleClicking = false;
                    this.setTextEditingState(false);
                });
                // Before enabling edit, ensure full text is presented for decision nodes
                labelEl.addEventListener('focus', () => {
                    if (n.kind === 'decision' && labelEl.getAttribute('contenteditable') === 'plaintext-only') {
                        labelEl.textContent = n.label || '';
                    }
                });
                // Initialize height on first render
                if (n.kind === 'decision') updateDecisionDisplay();
                setTimeout(adjustHeight, 0);
            }
            el.querySelectorAll('.flow-port').forEach(p => {
                // If ConnectorUX is present, it handles delegated port mousedown
                if (!(this.connectorUX && this.connectorUX.attach)) {
                    p.addEventListener('mousedown', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const port = p.classList.contains('t') ? 't' : p.classList.contains('r') ? 'r' : p.classList.contains('b') ? 'b' : 'l';
                        this.startEdgeDrag(n.id, port);
                        this.updateTempEdge(e);
                    });
                }
                // Tooltips for ports on decision nodes
                if (n.kind === 'decision') {
                    if (p.classList.contains('t')) p.title = 'In';
                    if (p.classList.contains('r')) p.title = 'Yes';
                    if (p.classList.contains('b')) p.title = 'No';
                    if (p.classList.contains('l')) p.title = 'Else';
                }
            });
            grid.appendChild(el);
            // Lock initial size for process nodes on first render
            if (n.kind !== 'decision') {
                if (typeof n.w !== 'number' || typeof n.h !== 'number') {
                    const r = el.getBoundingClientRect();
                    n.w = Math.max(140, Math.round(r.width));
                    n.h = Math.max(44, Math.round(r.height));
                    try { saveFlowData(this.state); } catch {}
                }
                el.style.width = n.w + 'px';
                el.style.height = n.h + 'px';
            }
            // Observe size changes to persist and keep center snapping
            if (!this.resizeObserver) {
                this.resizeObserver = new ResizeObserver(entries => {
                    for (const entry of entries) {
                        const target = entry.target;
                        const id = target.dataset.id;
                        if (!id) continue;
                        const node = this.state.nodes.find(nn => nn.id === id);
                        if (!node) continue;
                        const rect = target.getBoundingClientRect();
                        // Do not persist size changes on move; decision nodes are fixed, process nodes locked to initial size
                        const leftNow = parseFloat(target.style.left) || 0;
                        const topNow = parseFloat(target.style.top) || 0;
                        // Compute next position: keep decision nodes exactly where they are; snap process nodes horizontally
                        if (node.kind !== 'decision') {
                            node.x = Math.max(0, leftNow);
                            node.y = Math.max(0, topNow);
                        } else {
                            // Do not mutate x/y for decision nodes here to avoid unintended shifts
                            // Just enforce fixed visual size
                            target.style.width = this.decisionSize + 'px';
                            target.style.height = this.decisionSize + 'px';
                        }
                        // Reflect current size immediately without full render to avoid flicker
                        if (node.kind !== 'decision') {
                            target.style.width = node.w + 'px';
                            target.style.height = node.h + 'px';
                            saveFlowData(this.state);
                        }
                        target.style.left = (node.kind !== 'decision' ? node.x : leftNow) + 'px';
                        target.style.top = (node.kind !== 'decision' ? node.y : topNow) + 'px';
                        // Re-render edges only to avoid disrupting active text editing
                        this.renderEdgesOnly();
                        break;
                    }
                });
            }
            // Always observe; handler will ignore decision size persistence
            this.resizeObserver.observe(el);
        });
        // Edges
        const svg = this.svg;
        svg.setAttribute('width', String(width));
        svg.setAttribute('height', String(height));
        // Use the new ConnectionManager for rendering connections
        if (this.showEdges) {
            this.connectionManager.renderConnections();
        } else {
            // Clear connections when edges are hidden
            this.connectionManager.clearConnections();
        }
        this.renderTable();
    }

    // Zoom controls
    applyZoom() {
        const scale = Math.max(0.25, Math.min(3, this.zoom));
        this.zoom = scale;
        if (this.grid) {
            this.grid.style.transformOrigin = 'top left';
            this.grid.style.transform = `scale(${scale})`;
        }
        if (this.svg) {
            this.svg.style.transformOrigin = 'top left';
            this.svg.style.transform = `scale(${scale})`;
        }
    }

    zoomIn(step = 0.1) { this.zoom = (this.zoom || 1) + step; this.applyZoom(); }
    zoomOut(step = 0.1) { this.zoom = (this.zoom || 1) - step; this.applyZoom(); }
    resetZoom() {
        this.zoom = 1;
        this.applyZoom();
        // Scroll canvas viewport back to start (top-left)
        try {
            const wrap = this.wrap && this.wrap.querySelector ? this.wrap.querySelector('.flow-canvas-wrap') : null;
            if (wrap && typeof wrap.scrollTo === 'function') {
                wrap.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
            } else if (wrap) {
                wrap.scrollLeft = 0;
                wrap.scrollTop = 0;
            }
        } catch {}
    }

    // Ultra-fast edge rendering optimized for drag operations
    renderEdgesOnly() {
        if (!this.svg || !this.grid) return;
        
        // Use the new ConnectionManager for consistent rendering
        if (this.showEdges) {
            // Skip expensive pathfinding during drag for maximum smoothness
            if (this.drag) {
                this.connectionManager.renderConnectionsFast();
            } else {
                this.connectionManager.renderConnections();
            }
        } else {
            this.connectionManager.clearConnections();
        }
    }

    // Inject reusable arrowhead markers into the SVG
    injectEdgeMarkers(svg) {
        if (!svg) return;
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const mk = (id, color) => {
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.setAttribute('id', id);
            marker.setAttribute('markerWidth', '6');
            marker.setAttribute('markerHeight', '4');
            marker.setAttribute('refX', '6');
            marker.setAttribute('refY', '2');
            marker.setAttribute('orient', 'auto');
            marker.setAttribute('markerUnits', 'strokeWidth');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M 0 0 L 6 2 L 0 4 z');
            path.setAttribute('fill', color);
            path.setAttribute('opacity', '0.7');
            marker.appendChild(path);
            return marker;
        };
        defs.appendChild(mk('arrowDefault', '#22c1c3'));
        defs.appendChild(mk('arrowHover', '#1ea1f2'));
        defs.appendChild(mk('arrowSelected', '#1976d2'));
        svg.appendChild(defs);
    }

    renderTable() {
        if (!this.table) return;
        if (this.table.style.display !== 'block') return;
        const rows = this.state.nodes.map(n => `<tr><td>${n.id}</td><td>${n.kind}</td><td>${n.label}</td><td>${n.x}</td><td>${n.y}</td></tr>`).join('');
        this.table.innerHTML = `
            <table>
                <thead><tr><th>Id</th><th>Type</th><th>Label</th><th>X</th><th>Y</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    }

    addAreaBelow() {
        // create a new complete flow diagram below current content
        const lastBottom = this.state.sections.length
            ? Math.max(...this.state.sections.map(s => (s.y || 0) + (s.h || 600)))
            : 0;
        const y = Math.max(lastBottom, this.baseHeight) + 40;
        const h = 600;
        
        // Create new section
        if (!Array.isArray(this.state.sections)) this.state.sections = [];
        this.state.sections.push({ id: generateId('sec'), y, h });
        
        // Create a complete new flow diagram in this section
        const startX = 100;
        const startY = y + 100;
        const stepX = 300;
        const endX = 500;
        
        // Add Start node
        const startNode = {
            id: generateId('node'),
            kind: 'process',
            label: 'Start',
            x: startX,
            y: startY
        };
        
        // Add Step 2 node
        const stepNode = {
            id: generateId('node'),
            kind: 'process',
            label: 'Step 2',
            x: startX + stepX,
            y: startY
        };
        
        // Add End node
        const endNode = {
            id: generateId('node'),
            kind: 'process',
            label: 'End',
            x: startX + endX,
            y: startY
        };
        
        // Add edges connecting the nodes
        const edge1 = {
            id: generateId('edge'),
            from: startNode.id,
            to: stepNode.id
        };
        
        const edge2 = {
            id: generateId('edge'),
            from: stepNode.id,
            to: endNode.id
        };
        
        // Add nodes and edges to state
        this.pushHistory();
        this.state.nodes.push(startNode, stepNode, endNode);
        this.state.edges.push(edge1, edge2);
        
        this.baseHeight = y + h + 400;
        saveFlowData(this.state);
        this.render();
        const wrap = document.querySelector('.flow-canvas-wrap');
        if (wrap) wrap.scrollTo({ top: y, behavior: 'smooth' });
    }
    
    addNewFlowBoard() {
        // Backward compatibility: clone this editor's state into a new board if possible
        console.log('Cloning current flow board...');
        try {
            const snapshot = JSON.parse(JSON.stringify(this.state));
            if (window.flowEditor && typeof window.flowEditor.addBoard === 'function') {
                window.flowEditor.addBoard(snapshot);
                console.log('Cloned flow board added successfully!');
            } else {
                console.error('FlowBoards not available or addBoard function missing');
            }
        } catch (err) {
            console.error('Failed to clone current board:', err);
        }
    }
    
    deleteCurrentBoard() {
        // Delete everything of this board: toolbar, canvas wrap, grid, nodes, edges, sections, and board wrapper
        console.log('Deleting flow board completely...');
        try {
            if (window.flowEditor && typeof window.flowEditor.deleteBoardByWrap === 'function') {
                window.flowEditor.deleteBoardByWrap(this.wrap);
            } else if (this.wrap && this.wrap.parentNode) {
                this.wrap.parentNode.removeChild(this.wrap);
            }
        } catch (err) {
            console.error('Failed to delete board completely:', err);
        }
    }

    autoArrange() {
        // Simple DAG layering by outgoing references (from -> to)
        const nodes = [...this.state.nodes];
        const edges = [...this.state.edges];
        const inDegree = new Map(nodes.map(n => [n.id, 0]));
        edges.forEach(e => { inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1); });
        // Kahn's algorithm for layering
        const layers = [];
        let current = nodes.filter(n => (inDegree.get(n.id) || 0) === 0);
        const visited = new Set();
        while (current.length) {
            layers.push(current);
            const next = [];
            current.forEach(n => {
                visited.add(n.id);
                edges.filter(e => e.from === n.id).forEach(e => {
                    const d = inDegree.get(e.to) - 1;
                    inDegree.set(e.to, d);
                    if (d === 0) {
                        const tn = nodes.find(x => x.id === e.to);
                        if (tn && !visited.has(tn.id) && !next.includes(tn)) next.push(tn);
                    }
                });
            });
            current = next;
        }
        // Any remaining (cycles), place them after
        const leftover = nodes.filter(n => !visited.has(n.id));
        if (leftover.length) layers.push(leftover);

        // Position layers in columns with equal vertical spacing
        const colW = this.columnWidth;
        const rowH = 3 * this.gridSize; // 120px
        const marginTop = this.gridSize * 2; // 80
        layers.forEach((layer, li) => {
            layer.forEach((n, i) => {
                n.x = li * colW + this.gridSize * 2;
                n.y = marginTop + i * rowH;
            });
        });
        this.pushHistory();
        saveFlowData(this.state);
        this.render();
    }

    copySelection() {
        // Node has priority
        const selectedNodeEl = this.grid && this.grid.querySelector('.flow-node.selected');
        if (selectedNodeEl) {
            const id = selectedNodeEl.dataset.id;
            const node = this.state.nodes.find(n => n.id === id);
            if (node) this.clipboard = { type: 'node', data: JSON.parse(JSON.stringify(node)) };
            return;
        }
        if (this.selectedEdgeId) {
            const edge = this.state.edges.find(e => e.id === this.selectedEdgeId);
            if (edge) this.clipboard = { type: 'edge', data: JSON.parse(JSON.stringify(edge)) };
        }
    }

    pasteSelection() {
        if (!this.clipboard) return;
        if (this.clipboard.type === 'node' && this.clipboard.data) {
            const base = this.clipboard.data;
            const copy = { ...base, id: generateId('node'), x: (base.x || 0) + 20, y: (base.y || 0) + 20 };
            this.pushHistory();
            this.state.nodes.push(copy);
            saveFlowData(this.state);
            this.render();
            return;
        }
        if (this.clipboard.type === 'edge' && this.clipboard.data) {
            const base = this.clipboard.data;
            // Only paste edge if both endpoints still exist
            if (this.state.nodes.find(n => n.id === base.from) && this.state.nodes.find(n => n.id === base.to)) {
                const copy = { ...base, id: generateId('edge') };
                this.pushHistory();
                this.state.edges.push(copy);
                saveFlowData(this.state);
                this.render();
            }
        }
    }
}

// Encapsulated manager for node dragging and moving
class NodeDragManager {
    constructor(editor) {
        this.editor = editor;
        this.grid = editor.grid;
        this.activePointerId = null;
        this.drag = null; // { id, offsetX, offsetY }
        this.dragElement = null;
        this.dragMousePos = null;
        this.dragCache = null;
        this.dragAnimationFrame = null;
        this.enableMovement = true; // handle-only movement
    }

    attach() {
        if (!this.grid) return;
        this.grid.addEventListener('pointerdown', this.onPointerDown);
        window.addEventListener('pointermove', this.onPointerMove);
        window.addEventListener('pointerup', this.onPointerUp);
    }

    detach() {
        if (!this.grid) return;
        this.grid.removeEventListener('pointerdown', this.onPointerDown);
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerup', this.onPointerUp);
    }

    onPointerDown = (e) => {
        const { editor } = this;
        if (e.button !== 0) return;
        if (e.target && e.target.closest && e.target.closest('.flow-port')) return;
        const nodeEl = e.target.closest && e.target.closest('.flow-node');
        if (!nodeEl) { editor.deselectAll(); return; }
        const id = nodeEl.dataset.id;
        const node = editor.state.nodes.find(n => n.id === id);
        if (!node) return;
        editor.selectNode(id);
        if (editor.isEditingText) return;
        if (editor.isOnResizeHandle(nodeEl, e)) return;

        const handle = nodeEl.querySelector && nodeEl.querySelector('.drag-handle');
        const isOnHandle = handle && (e.target === handle || (e.target.closest && e.target.closest('.drag-handle')));
        if (!isOnHandle || !this.enableMovement) return;

        try { nodeEl.setPointerCapture(e.pointerId); } catch {}
        this.activePointerId = e.pointerId;

        const rect = nodeEl.getBoundingClientRect();
        
        // Calculate offset based on node type
        let offsetX, offsetY;
        
        if (node.kind === 'decision') {
            // For decision nodes, the drag handle is positioned at top: 4px, left: 50%
            // So the offset should be from the center of the node horizontally, and 4px from top
            const nodeSize = editor.getNodeSize(node);
            offsetX = (nodeSize.w / 2); // Center horizontally
            offsetY = 4; // 4px from top as per CSS
        } else {
            // For regular nodes, use the standard offset calculation
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
        }
        
        this.drag = { id, offsetX, offsetY };
        this.dragElement = nodeEl;
        this.dragMousePos = { clientX: e.clientX, clientY: e.clientY };
        this.dragCache = {
            wrap: this.grid.getBoundingClientRect(),
            node: editor.state.nodes.find(n => n.id === id),
            zoom: editor.zoom || 1,
            lastUpdate: performance.now(),
            lastEdgeUpdatePos: null
        };
        if (this.dragElement) this.dragElement.classList.add('dragging');
        this._prevUserSelect = document.body.style.userSelect;
        document.body.style.userSelect = 'none';

        e.preventDefault();
    };

    onPointerMove = (e) => {
        if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;
        if (!this.drag) return;
        this.dragMousePos = { clientX: e.clientX, clientY: e.clientY };
        if (this.dragAnimationFrame) cancelAnimationFrame(this.dragAnimationFrame);
        this.dragAnimationFrame = requestAnimationFrame(this.updatePositionSmooth);
    };

    onPointerUp = (e) => {
        const { editor } = this;
        if (this.activePointerId !== null && e.pointerId !== this.activePointerId) return;
        if (this.dragElement) {
            try { this.dragElement.releasePointerCapture(this.activePointerId); } catch {}
        }
        if (this.drag && this.dragCache) {
            const node = this.dragCache.node;
            if (node) {
                // Final position is already snapped via updatePositionSmooth
                // Just ensure bounds clamping
                const nodeSize = editor.getNodeSize(node);
                const maxX = Math.max(0, (editor.baseWidth - nodeSize.w));
                const maxY = Math.max(0, (editor.baseHeight - nodeSize.h));
                node.x = Math.min(Math.max(0, node.x), maxX);
                node.y = Math.min(Math.max(0, node.y), maxY);

                if (this.dragElement) {
                    this.dragElement.classList.remove('dragging');
                    this.dragElement.style.transform = '';
                    this.dragElement.style.left = node.x + 'px';
                    this.dragElement.style.top = node.y + 'px';
                }
            }
        }
        if (this.dragAnimationFrame) { cancelAnimationFrame(this.dragAnimationFrame); this.dragAnimationFrame = null; }
        if (this._prevUserSelect !== undefined) { document.body.style.userSelect = this._prevUserSelect; this._prevUserSelect = undefined; }

        if (this.drag) {
            editor.updateNodeConnectors(this.drag.id);
            editor.scheduleEdgeUpdate();
            try { saveFlowData(editor.state); } catch {}
            editor.render();
        }

        this.drag = null;
        this.dragElement = null;
        this.dragMousePos = null;
        this.dragCache = null;
        this.activePointerId = null;
    };

    updatePositionSmooth = () => {
        const { editor } = this;
        if (!this.drag || !this.dragCache || !this.dragMousePos) return;
        const { wrap, node, zoom } = this.dragCache;
        if (!node) return;
        const rawLeft = (this.dragMousePos.clientX - wrap.left - this.drag.offsetX) / zoom;
        const rawTop = (this.dragMousePos.clientY - wrap.top - this.drag.offsetY) / zoom;

        // Apply snapping during dragging
        node.x = editor.snapToGrid(Math.max(0, rawLeft), 'x', node);
        node.y = editor.snapToGrid(Math.max(0, rawTop), 'y', node);

        const maxX = Math.max(0, (editor.baseWidth - editor.getNodeSize(node).w));
        const maxY = Math.max(0, (editor.baseHeight - editor.getNodeSize(node).h));
        node.x = Math.min(Math.max(0, node.x), maxX);
        node.y = Math.min(Math.max(0, node.y), maxY);

        if (this.dragElement) {
            // Update position using left/top to avoid transform transitions/animations
            this.dragElement.style.transform = '';
            this.dragElement.style.left = node.x + 'px';
            this.dragElement.style.top = node.y + 'px';
        }

        const now = performance.now();
        const shouldUpdateByTime = (now - this.dragCache.lastUpdate) > 33;
        const lastPos = this.dragCache.lastEdgeUpdatePos || { x: node.x, y: node.y };
        const dx = node.x - lastPos.x;
        const dy = node.y - lastPos.y;
        const movedFar = (dx*dx + dy*dy) > 64;
        if (shouldUpdateByTime || movedFar) {
            editor.updateNodeConnectors(this.drag.id);
            editor.scheduleEdgeUpdate();
            this.dragCache.lastUpdate = now;
            this.dragCache.lastEdgeUpdatePos = { x: node.x, y: node.y };
        }
    };
}

// Multi-board container: stacked independent canvases
class FlowBoards {
    constructor() {
        this.root = document.getElementById('flowBoards');
        this.boards = [];
        this.ensureAtLeastOne();
    }

    ensureAtLeastOne() {
        if (!this.boards.length) this.addBoard();
    }

    addBoard(initialState = null) {
        const id = generateId('board');
        const wrap = document.createElement('div');
        
        // Apply alternating styling based on board count
        const isEven = this.boards.length % 2 === 0;
        const boardClass = isEven ? 'flow-board flow-board-even' : 'flow-board flow-board-odd';
        
        wrap.className = boardClass;
        wrap.innerHTML = `
            <div class="flow-toolbar" data-board-id="${id}">
                <div class="control-group">
                    <button class="btn btn-secondary icon-only" data-flow="overlay-add" title="Add process" aria-label="Add process">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <rect x="4" y="6" width="16" height="12" rx="2" stroke="#333" stroke-width="1.5" fill="none"/>
                            <path d="M12 9v6M9 12h6" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>
                        </svg>
                    </button>
                    <button class="btn btn-secondary icon-only" data-flow="overlay-add-decision" title="Add decision" aria-label="Add decision">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M12 3l8 9-8 9-8-9 8-9z" stroke="#333" stroke-width="1.5" fill="none"/>
                            <path d="M12 8v8M8 12h8" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>
                        </svg>
                    </button>
                </div>
                <div class="control-group" style="margin: 0 auto;">
                    <button class="btn btn-secondary icon-only" data-flow="overlay-undo" title="Undo" aria-label="Undo">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M12 5a7 7 0 1 0 7 7" stroke="#333" stroke-width="1.6" stroke-linecap="round"/>
                            <path d="M8 5H3v5" stroke="#333" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                    <button class="btn btn-secondary icon-only" data-flow="overlay-redo" title="Redo" aria-label="Redo">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M12 19a7 7 0 1 1 7-7" stroke="#333" stroke-width="1.6" stroke-linecap="round"/>
                            <path d="M21 10V5h-5" stroke="#333" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                    <button class="btn btn-secondary icon-only" data-flow="overlay-zoom-in" title="Zoom in" aria-label="Zoom in">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <circle cx="11" cy="11" r="6" stroke="#333" stroke-width="1.5"/>
                            <path d="M11 8v6M8 11h6" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>
                            <path d="M20 20l-3.5-3.5" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>
                        </svg>
                    </button>
                    <button class="btn btn-secondary icon-only" data-flow="overlay-zoom-out" title="Zoom out" aria-label="Zoom out">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <circle cx="11" cy="11" r="6" stroke="#333" stroke-width="1.5"/>
                            <path d="M8 11h6" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>
                            <path d="M20 20l-3.5-3.5" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>
                        </svg>
                    </button>
                    <button class="btn btn-secondary icon-only" data-flow="overlay-zoom-reset" title="Back to normal" aria-label="Back to normal">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M12 3v3" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>
                            <path d="M12 18v3" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>
                            <path d="M3 12h3" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>
                            <path d="M18 12h3" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>
                            <circle cx="12" cy="12" r="5" stroke="#333" stroke-width="1.5"/>
                        </svg>
                    </button>
                </div>
                <div class="control-group" style="margin-left:auto;">
                    <div class="export-dropdown">
                        <button class="btn btn-secondary icon-only" data-flow="overlay-more" title="Other options" aria-label="Other options">⋮</button>
                        <div class="export-menu" data-flow="overlay-more-menu">
                            <button class="export-option" data-flow="overlay-delete-board">🗑️ Delete Flow Board</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="flow-canvas-wrap">
                <svg class="flow-edges" id="edges_${id}"></svg>
                <div class="flow-grid" id="grid_${id}"></div>
            </div>
        `;
        this.root.appendChild(wrap);
        const editor = new FlowEditor({ root: wrap, initialState });
        this.boards.push({ id, wrap, editor });
    }

    cloneCurrentBoard() {
        // Duplicate the last (current) board entirely, including nodes and edges
        if (!this.boards.length) { this.addBoard(); return; }
        const current = this.boards[this.boards.length - 1];
        if (!current || !current.editor) { this.addBoard(); return; }
        try {
            const snapshot = JSON.parse(JSON.stringify(current.editor.state));
            this.addBoard(snapshot);
        } catch (err) {
            console.error('Failed to clone board:', err);
            this.addBoard();
        }
    }

    deleteBoardByWrap(wrapEl) {
        // Remove a board based on its wrapper element; ensure at least one remains
        const idx = this.boards.findIndex(b => b.wrap === wrapEl);
        if (idx === -1) return;
        try {
            const board = this.boards[idx];
            if (board && board.wrap && board.wrap.parentNode) {
                board.wrap.parentNode.removeChild(board.wrap);
            }
            this.boards.splice(idx, 1);
            // If no boards left, remove the entire flow area container as well
            if (this.boards.length === 0) {
                const flowArea = (wrapEl && wrapEl.closest) ? wrapEl.closest('.flow-area') : null;
                if (flowArea && flowArea.parentNode) {
                    flowArea.parentNode.removeChild(flowArea);
                }
                // Extra safety: purge any empty flow-area under flowMount
                try {
                    const mount = document.getElementById('flowMount');
                    if (mount) {
                        mount.querySelectorAll('.flow-area').forEach(el => {
                            const boards = el.querySelector('.flow-boards');
                            if (!boards || boards.children.length === 0) {
                                if (el.parentNode) el.parentNode.removeChild(el);
                            }
                        });
                        // If mount has no children, clear it fully
                        if (!mount.firstElementChild) {
                            mount.innerHTML = '';
                        }
                    }
                } catch {}
                // Clear reference to this manager
                if (window.flowEditor === this) {
                    try { window.flowEditor = null; } catch {}
                }
            }
        } catch (err) {
            console.error('Failed to remove board:', err);
        }
    }
}

// Extend FlowBoards with navbar proxy helpers
FlowBoards.prototype.getActiveEditor = function() {
    if (!this.boards || this.boards.length === 0) {
        try { this.addBoard(); } catch {}
    }
    const current = this.boards && this.boards[this.boards.length - 1];
    return current && current.editor ? current.editor : null;
};

FlowBoards.prototype.saveVersion = function() {
    const editor = this.getActiveEditor && this.getActiveEditor();
    if (editor && typeof editor.saveVersion === 'function') {
        const result = editor.saveVersion();
        // Toast is shown by the editor itself
        return result;
    }
    console.warn('No active flow editor available to save');
};

FlowBoards.prototype.showSuccessToast = function(message) {
    // Remove any existing toast
    const existingToast = document.querySelector('.success-toast');
    if (existingToast) {
        existingToast.remove();
    }
    
    // Create new toast
    const toast = document.createElement('div');
    toast.className = 'success-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 3000);
};

FlowBoards.prototype.openHistory = function() {
    const editor = this.getActiveEditor && this.getActiveEditor();
    if (editor && typeof editor.openHistory === 'function') {
        return editor.openHistory();
    }
    console.warn('No active flow editor available to open history');
};

// Add other missing methods that buttons try to call
FlowBoards.prototype.undo = function() {
    const editor = this.getActiveEditor && this.getActiveEditor();
    if (editor && typeof editor.undo === 'function') {
        return editor.undo();
    }
    console.warn('No active flow editor available for undo');
};

FlowBoards.prototype.redo = function() {
    const editor = this.getActiveEditor && this.getActiveEditor();
    if (editor && typeof editor.redo === 'function') {
        return editor.redo();
    }
    console.warn('No active flow editor available for redo');
};

FlowBoards.prototype.deleteSelection = function() {
    const editor = this.getActiveEditor && this.getActiveEditor();
    if (editor && typeof editor.deleteSelection === 'function') {
        return editor.deleteSelection();
    }
    console.warn('No active flow editor available for delete selection');
};

FlowBoards.prototype.addAreaBelow = function() {
    const editor = this.getActiveEditor && this.getActiveEditor();
    if (editor && typeof editor.addAreaBelow === 'function') {
        return editor.addAreaBelow();
    }
    console.warn('No active flow editor available for add area below');
};

FlowBoards.prototype.exportJSON = function() {
    const editor = this.getActiveEditor && this.getActiveEditor();
    if (editor && typeof editor.exportJSON === 'function') {
        return editor.exportJSON();
    }
    console.warn('No active flow editor available for export JSON');
};

FlowBoards.prototype.exportJPEG = function() {
    const editor = this.getActiveEditor && this.getActiveEditor();
    if (editor && typeof editor.exportJPEG === 'function') {
        return editor.exportJPEG();
    }
    console.warn('No active flow editor available for export JPEG');
};

FlowBoards.prototype.exportPDF = function() {
    const editor = this.getActiveEditor && this.getActiveEditor();
    if (editor && typeof editor.exportPDF === 'function') {
        return editor.exportPDF();
    }
    console.warn('No active flow editor available for export PDF');
};

FlowBoards.prototype.importJSONFile = function(file) {
    const editor = this.getActiveEditor && this.getActiveEditor();
    if (editor && typeof editor.importJSONFile === 'function') {
        return editor.importJSONFile(file);
    }
    console.warn('No active flow editor available for import JSON');
};

// removed rules tabs implementation


function setupProjectSidebar() {
    const listEl = document.getElementById('projectList');
    const addBtn = document.getElementById('addProjectBtn');
    if (!listEl || !addBtn) return;

    function renderProjects() {
        const projects = loadProjects();
        const currentId = getCurrentProjectId();
        listEl.innerHTML = '';
        projects.forEach(p => {
            const item = document.createElement('div');
            item.className = 'project-item' + (p.id === currentId ? ' active' : '');
            item.dataset.id = p.id;
            const title = document.createElement('div');
            title.className = 'project-title';
            title.textContent = p.name;
            title.style.flex = '1';
            item.appendChild(title);
            listEl.appendChild(item);

            item.addEventListener('click', (e) => {
                if (p.id !== getCurrentProjectId()) {
                    setCurrentProjectId(p.id);
                    // refresh journey data for new project
                    window.journey.journeyData = loadJourneyData();
                    window.journey.renderJourneyMap();
                    // refresh flow data for new project
                    if (window.flowEditor) { window.flowEditor.state = loadFlowData(); window.flowEditor.render(); }
                    renderProjects();
                    updateProjectNameHeading();
                    updateStorageUsage();
                }
            });
        });
    }

    addBtn.addEventListener('click', () => {
        const name = prompt('Project name', 'Untitled Project')?.trim();
        if (!name) return;
        const projects = loadProjects();
        const id = generateId('proj');
        projects.unshift({ id, name, createdAt: new Date().toISOString() });
        saveProjects(projects);
        setCurrentProjectId(id);
        // initialize empty data for this project
        localStorage.setItem(getScopedKey(BASE_STORAGE_KEY, id), JSON.stringify([]));
        localStorage.setItem(getScopedKey(BASE_COVER_KEY, id), JSON.stringify({ image: '', title: '', description: '' }));
        localStorage.setItem(getScopedKey(BASE_FLOW_KEY, id), JSON.stringify({ nodes: [], edges: [] }));
        window.journey.journeyData = loadJourneyData();
        window.journey.renderJourneyMap();
        if (window.flowEditor) { window.flowEditor.state = loadFlowData(); window.flowEditor.render(); }
        renderProjects();
        updateProjectNameHeading();
        updateStorageUsage();
        renderSidebarBottom();
    });

    renderProjects();
}

// --- Sidebar bottom (profile + settings + mini storage) ---
function renderSidebarBottom() {
    const wrap = document.getElementById('sidebarBottom');
    if (!wrap) return;
    const settings = loadSettings();
    const btn = document.getElementById('settingsStatusBtn');
    const nameEl = document.getElementById('profileName');
    if (nameEl) nameEl.textContent = settings.profileName || 'You';
    if (btn) {
        const active = !!settings.statusActive;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
        btn.textContent = `Status: ${active ? 'Active' : 'Inactive'}`;
    }
    // mini storage
    const textEl = document.getElementById('storageUsageTextBottom');
    const barEl = document.getElementById('storageBarFillBottom');
    if (textEl && barEl) {
        const used = estimateAppStorageBytes();
        const quota = 5 * 1024 * 1024;
        const pct = Math.min(100, Math.round((used / quota) * 100));
        textEl.textContent = `${formatBytes(used)} / 5 MB (${pct}%)`;
        barEl.style.width = pct + '%';
        if (pct >= 90) {
            barEl.style.background = 'linear-gradient(90deg, #ef5350, #e53935)';
        } else if (pct >= 75) {
            barEl.style.background = 'linear-gradient(90deg, #ffb74d, #fb8c00)';
        } else {
            barEl.style.background = 'linear-gradient(90deg, #64b5f6, #1e88e5)';
        }
    }
}

function setupSidebarBottom() {
    const btn = document.getElementById('settingsStatusBtn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        const current = loadSettings();
        saveSettings({ statusActive: !current.statusActive });
    });
    // keep in sync with storage updates and project switching
    window.addEventListener('storage', () => {
        renderSidebarBottom();
    });
    renderSidebarBottom();
}

// --- Settings modal (open/close + save) ---

function setupSettingsModal() {
    const openBtn = document.getElementById('openSettingsBtn');
    const modal = document.getElementById('settingsModal');
    const closeBtn = document.getElementById('closeSettingsModal');
    const cancelBtn = document.getElementById('cancelSettingsBtn');
    const saveBtn = document.getElementById('saveSettingsBtn');
    const themeSelect = document.getElementById('settingsThemeSelect');
    const langSelect = document.getElementById('settingsLanguageSelect');
    const notifToggle = document.getElementById('settingsNotificationsToggle');
    const sysPrompt = document.getElementById('settingsSystemPrompt');
    const advToggle = document.getElementById('advancedParamsToggle');
    const advSection = document.getElementById('advancedParamsSection');
    const maxTokens = document.getElementById('settingsMaxTokens');
    const temperature = document.getElementById('settingsTemperature');
    if (!openBtn || !modal || !closeBtn || !cancelBtn || !saveBtn || !themeSelect || !langSelect || !notifToggle || !sysPrompt || !advToggle || !advSection || !maxTokens || !temperature) return;

    let tempSettings = {};

    function syncFromSettings() {
        const s = loadSettings();
        tempSettings = {
            theme: s.theme || 'oled-dark',
            language: s.language || 'en-US',
            notifications: !!s.notifications,
            systemPrompt: s.systemPrompt || '',
            maxTokens: typeof s.maxTokens === 'number' ? s.maxTokens : '',
            temperature: typeof s.temperature === 'number' ? s.temperature : ''
        };
        themeSelect.value = tempSettings.theme;
        langSelect.value = tempSettings.language;
        notifToggle.classList.toggle('active', tempSettings.notifications);
        notifToggle.setAttribute('aria-pressed', String(tempSettings.notifications));
        notifToggle.textContent = tempSettings.notifications ? 'On' : 'Off';
        sysPrompt.value = tempSettings.systemPrompt;
        maxTokens.value = tempSettings.maxTokens;
        temperature.value = tempSettings.temperature;
    }

    function open() {
        syncFromSettings();
        modal.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');
        setTimeout(() => themeSelect.focus(), 0);
        document.addEventListener('keydown', onKeydown, { once: false });
    }

    function close() {
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
        document.removeEventListener('keydown', onKeydown, { once: false });
    }

    function onKeydown(e) {
        if (e.key === 'Escape') close();
    }

    openBtn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    notifToggle.addEventListener('click', () => {
        const next = !(notifToggle.getAttribute('aria-pressed') === 'true');
        notifToggle.setAttribute('aria-pressed', String(next));
        notifToggle.classList.toggle('active', next);
        notifToggle.textContent = next ? 'On' : 'Off';
    });

    advToggle.addEventListener('click', () => {
        const expanded = advToggle.getAttribute('aria-expanded') === 'true';
        advToggle.setAttribute('aria-expanded', String(!expanded));
        advSection.hidden = expanded;
        const small = advToggle.querySelector('.small');
        if (small) small.textContent = expanded ? 'Show' : 'Hide';
    });

    saveBtn.addEventListener('click', () => {
        const theme = themeSelect.value;
        const language = langSelect.value;
        const notifications = notifToggle.getAttribute('aria-pressed') === 'true';
        const systemPrompt = sysPrompt.value;
        const mt = parseInt(maxTokens.value, 10);
        const temp = parseFloat(temperature.value);
        saveSettings({ theme, language, notifications, systemPrompt, maxTokens: Number.isFinite(mt) ? mt : undefined, temperature: Number.isFinite(temp) ? temp : undefined });
        applyTheme(theme);
        close();
    });
}

// Apply theme tokens to body
function applyTheme(theme) {
    const body = document.body;
    body.classList.remove('theme-light', 'theme-dark', 'theme-oled-dark');
    switch (theme) {
        case 'light':
            body.classList.add('theme-light');
            break;
        case 'dark':
            body.classList.add('theme-dark');
            break;
        case 'oled-dark':
        default:
            body.classList.add('theme-oled-dark');
            break;
    }
}

function setupRightTocScrollEffect() {
    const toc = document.getElementById('rightPaneToc');
    if (!toc) return;
    // Classify TOC items by availability/emptiness based on current project data
    try {
        const journeyData = (window.journey && Array.isArray(window.journey.journeyData)) ? window.journey.journeyData : [];
        const hasJourneyContent = Array.isArray(journeyData) && journeyData.length > 0;
        const coverData = loadCoverData();
        const hasCoverContent = !!(coverData.image || coverData.title || coverData.description);
        const flowData = loadFlowData();
        const hasFlowContent = (Array.isArray(flowData.nodes) && flowData.nodes.length) || (Array.isArray(flowData.edges) && flowData.edges.length);
        toc.querySelectorAll('.toc-subitem, .toc-item').forEach(btn => {
            const key = btn.getAttribute('data-target');
            // Journey availability
            if (key === 'journey') {
                if (hasJourneyContent) {
                    btn.classList.add('toc-available-content');
                } else {
                    btn.classList.add('toc-available-empty');
                }
                return;
            }
            // Cover availability
            if (key === 'cover') {
                if (hasCoverContent) {
                    btn.classList.add('toc-available-content');
                } else {
                    btn.classList.add('toc-available-empty');
                }
                return;
            }
            if (key === 'flow') {
                if (hasFlowContent) btn.classList.add('toc-available-content');
                else btn.classList.add('toc-available-empty');
                return;
            }
            // Default: disable any section that does not have an implemented handler/content
            // Explicitly mark known unfinished sections as unavailable (light grey)
            const unfinished = [
                'kickoff',
                'stakeholders', 'personas', 'interviews', 'competitors', 'service-blueprint', 'discovery-summary',
                'Problem statements and Point-of-View (POV)'.toLowerCase(),
                'How Might We (HMW)'.toLowerCase(),
                'Design principles (decision guardrails)'.toLowerCase(),
                'Value Proposition'.toLowerCase(),
                'Design Success metric'.toLowerCase(),
                'Prioritization'.toLowerCase(),
                'Design Requirement'.toLowerCase(),
                'To-be journey map'.toLowerCase(),
                'ideation link'.toLowerCase(), 'concept test report'.toLowerCase(), 'usability test report'.toLowerCase(),
                'information architect'.toLowerCase(), 'low fi link'.toLowerCase(), 'mid fi link'.toLowerCase(),
                'hi-fi main flow link'.toLowerCase(), 'design system link'.toLowerCase(),
                'final prototype link'.toLowerCase(), 'component change link'.toLowerCase(), 'uat test report'.toLowerCase(),
                'Hypothesis and measure'.toLowerCase(),
                'Lesson learn'.toLowerCase(), 'references'.toLowerCase()
            ];
            const label = (btn.textContent || '').trim().toLowerCase();
            if (unfinished.includes(key) || unfinished.includes(label)) {
                btn.classList.add('toc-unavailable');
                return;
            }
            // Fallback: if it's not one of cover/journey/flow, disable by default
            btn.classList.add('toc-unavailable');
        });
    } catch {}
    const onScroll = () => {
        const maxScrollTop = Math.max(0, toc.scrollHeight - toc.clientHeight);
        const top = toc.scrollTop;
        const bottomGap = maxScrollTop - top;
        const canScroll = maxScrollTop > 0;
        toc.classList.toggle('scrolled', canScroll);
        toc.classList.toggle('at-top', top <= 0);
        toc.classList.toggle('at-bottom', bottomGap <= 0);
    };
    toc.addEventListener('scroll', onScroll);
    // initialize state
    onScroll();
}

function setupContentNavScrollEffect() {
    const body = document.querySelector('.content-body');
    const nav = document.querySelector('.table-controls');
    if (!body || !nav) return;
    const onScroll = () => {
        if (body.scrollTop > 0) nav.classList.add('scrolled');
        else nav.classList.remove('scrolled');
    };
    body.addEventListener('scroll', onScroll);
    onScroll();
}

function setupTocNavigation() {
    const toc = document.getElementById('rightPaneToc');
    if (!toc) return;
    const coverBtn = toc.querySelector('[data-target="cover"]');
    const journeyBtn = toc.querySelector('[data-target="journey"]');
    const flowBtns = Array.from(toc.querySelectorAll('[data-target="flow"]'));
    const coverMount = document.getElementById('coverMount');
    const journeyMount = document.getElementById('journeyMount');
    const flowMount = document.getElementById('flowMount');
    const contentNav = document.getElementById('contentNavMount');

    const activate = (key) => {
        try { localStorage.setItem(getScopedKey(BASE_ACTIVE_TAB_KEY), key); } catch {}
        if (key === 'cover') {
            if (coverMount) coverMount.style.display = 'block';
            if (journeyMount) journeyMount.style.display = 'none';
            if (flowMount) flowMount.style.display = 'none';
            if (contentNav) contentNav.style.display = 'block';
            // show cover has no custom navbar; reuse default
            if (window.Components && typeof window.Components.renderContentNavbar === 'function') {
                window.Components.renderContentNavbar('contentNavMount');
                setupContentNavScrollEffect();
            }
            // Update active states for all tabs
            coverBtn && coverBtn.classList.add('active');
            journeyBtn && journeyBtn.classList.remove('active');
            flowBtns.forEach(b => b.classList.remove('active'));
            // Remove active from all other tabs
            toc.querySelectorAll('[data-target]').forEach(btn => {
                if (btn.getAttribute('data-target') !== 'cover') {
                    btn.classList.remove('active');
                }
            });
        } else if (key === 'journey') {
            if (coverMount) coverMount.style.display = 'none';
            if (journeyMount) journeyMount.style.display = 'block';
            if (flowMount) flowMount.style.display = 'none';
            if (contentNav) contentNav.style.display = 'block';
            // Journey uses default navbar
            if (window.Components && typeof window.Components.renderContentNavbar === 'function') {
                window.Components.renderContentNavbar('contentNavMount');
                setupContentNavScrollEffect();
                // Bind journey tool navbar actions after rendering
                if (window.journey) {
                    if (typeof window.journey.setupTableControls === 'function') window.journey.setupTableControls();
                    if (typeof window.journey.setupHistory === 'function') window.journey.setupHistory();
                }
            }
            // Update active states for all tabs
            journeyBtn && journeyBtn.classList.add('active');
            coverBtn && coverBtn.classList.remove('active');
            flowBtns.forEach(b => b.classList.remove('active'));
            // Remove active from all other tabs
            toc.querySelectorAll('[data-target]').forEach(btn => {
                if (btn.getAttribute('data-target') !== 'journey') {
                    btn.classList.remove('active');
                }
            });
        } else if (key === 'flow') {
            if (coverMount) coverMount.style.display = 'none';
            if (journeyMount) journeyMount.style.display = 'none';
            if (flowMount) flowMount.style.display = 'block';
            if (contentNav) contentNav.style.display = 'block';
            
            // Ensure flow area is properly rendered and initialized
            const flowArea = flowMount && flowMount.querySelector('.flow-area');
            if (!flowArea && window.Components && typeof window.Components.renderFlow === 'function') {
                window.Components.renderFlow('flowMount');
            }
            
            // Ensure flow editor is properly initialized
            if (!window.flowEditor) {
                window.flowEditor = new FlowBoards();
            }
            
            // Flow uses its own navbar
            if (window.Components && typeof window.Components.renderFlowNavbar === 'function') {
                window.Components.renderFlowNavbar('contentNavMount');
                setupContentNavScrollEffect();
                bindFlowNavbarActions();
            }
            // Update active states for all tabs
            flowBtns.forEach(b => b.classList.add('active'));
            journeyBtn && journeyBtn.classList.remove('active');
            coverBtn && coverBtn.classList.remove('active');
            // Remove active from all other tabs
            toc.querySelectorAll('[data-target]').forEach(btn => {
                if (btn.getAttribute('data-target') !== 'flow') {
                    btn.classList.remove('active');
                }
            });
        } else if (key === 'rules') {
            // no-op (tab removed); fall back to journey
            activate('journey');
        } else {
            // Handle other tabs that don't have specific implementations yet
            // For now, show a placeholder or fall back to journey
            console.log(`Tab '${key}' clicked - not yet implemented, falling back to journey`);
            
            // Update active states for the clicked tab
            toc.querySelectorAll('[data-target]').forEach(btn => {
                btn.classList.remove('active');
                if (btn.getAttribute('data-target') === key) {
                    btn.classList.add('active');
                }
            });
            
            // Show journey as fallback
            if (coverMount) coverMount.style.display = 'none';
            if (journeyMount) journeyMount.style.display = 'block';
            if (flowMount) flowMount.style.display = 'none';
            if (contentNav) contentNav.style.display = 'block';
            
            // Use default navbar for fallback
            if (window.Components && typeof window.Components.renderContentNavbar === 'function') {
                window.Components.renderContentNavbar('contentNavMount');
                setupContentNavScrollEffect();
                // Bind journey tool navbar actions after rendering
                if (window.journey) {
                    if (typeof window.journey.setupTableControls === 'function') window.journey.setupTableControls();
                    if (typeof window.journey.setupHistory === 'function') window.journey.setupHistory();
                }
            }
        }
    };

    // Add event listeners for all tabs (both with and without data-target)
    const allTabs = toc.querySelectorAll('.toc-item, .toc-subitem');
    allTabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            const target = tab.getAttribute('data-target');
            if (target) {
                activate(target);
            } else {
                // For tabs without data-target, show a placeholder message
                console.log(`Tab '${tab.textContent.trim()}' clicked - not yet implemented`);
                // You could show a modal or notification here
                alert(`"${tab.textContent.trim()}" is not yet implemented. This feature is coming soon!`);
            }
        });
    });

    // Restore last active tab on load
    try {
        const last = localStorage.getItem(getScopedKey(BASE_ACTIVE_TAB_KEY));
        if (last === 'cover' || last === 'journey' || last === 'flow') activate(last);
        else activate('journey');
    } catch { activate('journey'); }
}

function bindFlowNavbarActions() {
    const add = document.getElementById('flowNavAdd');
    const save = document.getElementById('flowNavSave') || document.getElementById('flowToolSave');
    const historyBtn = document.getElementById('flowNavHistory') || document.getElementById('flowToolHistory');
    const undo = document.getElementById('flowToolUndo');
    const redo = document.getElementById('flowToolRedo');
    const del = document.getElementById('flowToolDelete');
    const addArea = document.getElementById('flowToolAddArea');
    const exportBtn = document.getElementById('flowExportBtn') || document.getElementById('flowToolExportBtn');
    const exportMenu = document.getElementById('flowExportMenu') || document.getElementById('flowToolExportMenu');
    const importBtn = document.getElementById('flowImportBtn') || document.getElementById('flowToolImportBtn');
    const importFile = document.getElementById('flowImportFile') || document.getElementById('flowToolImportFile');
    const exampleBtn = document.getElementById('flowNavExample');
    const tidyBtn = document.getElementById('flowNavTidy');
    
    console.log('bindFlowNavbarActions called');
    console.log('Add button found:', !!add);
    console.log('window.flowEditor:', !!window.flowEditor);
    console.log('window.flowEditor type:', typeof window.flowEditor);
    
    if (!window.flowEditor) {
        console.warn('window.flowEditor not available, attempting to initialize...');
        // Try to initialize flow editor if not available
        const flowArea = document.getElementById('flowMount') && document.getElementById('flowMount').querySelector('.flow-area');
        if (flowArea) {
            window.flowEditor = new FlowBoards();
        } else {
            console.error('Flow area not found, cannot initialize flow editor');
            return;
        }
    }
    add && add.addEventListener('click', () => {
        // Create a new empty flow area/board
        console.log('Add button clicked! Creating empty flow area/board...');
        const emptyState = { nodes: [], edges: [], sections: [] };
        const mount = document.getElementById('flowMount');
        const areaExists = mount && mount.querySelector && mount.querySelector('.flow-area');
        if (!window.flowEditor || !areaExists) {
            // Render a fresh flow area and initialize with an empty board
            if (window.Components && typeof window.Components.renderFlow === 'function') {
                window.Components.renderFlow('flowMount');
            }
            window.flowEditor = new FlowBoards();
            if (window.flowEditor && window.flowEditor.boards && window.flowEditor.boards[0]) {
                const ed = window.flowEditor.boards[0].editor;
                if (ed) { ed.state = JSON.parse(JSON.stringify(emptyState)); ed.render(); }
            }
            console.log('Empty flow area created.');
            return;
        }
        // If area exists, add a new empty board beneath
        if (window.flowEditor && typeof window.flowEditor.addBoard === 'function') {
            window.flowEditor.addBoard(emptyState);
            console.log('Empty flow board added.');
            return;
        }
        console.error('FlowBoards not available');
    });
    save && save.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent delegated handler from also firing
        if (window.flowEditor && typeof window.flowEditor.saveVersion === 'function') {
            window.flowEditor.saveVersion();
        } else {
            console.warn('Flow editor not available for save');
        }
    });
    historyBtn && historyBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent delegated handler from also firing
        if (window.flowEditor && typeof window.flowEditor.openHistory === 'function') {
            window.flowEditor.openHistory();
        } else {
            console.warn('Flow editor not available for history');
        }
    });
    undo && undo.addEventListener('click', () => window.flowEditor.undo());
    redo && redo.addEventListener('click', () => window.flowEditor.redo());
    del && del.addEventListener('click', () => window.flowEditor.deleteSelection());
    addArea && addArea.addEventListener('click', () => window.flowEditor.addAreaBelow());
    if (exportBtn && exportMenu) {
        exportBtn.addEventListener('click', (e) => { e.stopPropagation(); exportBtn.parentElement.classList.toggle('active'); });
        document.addEventListener('click', () => exportBtn.parentElement.classList.remove('active'), { once: true });
        exportMenu.querySelectorAll('.export-option').forEach(opt => {
            opt.addEventListener('click', (e) => {
                const fmt = opt.getAttribute('data-format');
                if (fmt === 'json') window.flowEditor.exportJSON();
                if (fmt === 'jpeg') window.flowEditor.exportJPEG();
                if (fmt === 'pdf') window.flowEditor.exportPDF();
            });
        });
    }
    if (importBtn && importFile) {
        importBtn.addEventListener('click', () => importFile.click());
        importFile.addEventListener('change', (e) => window.flowEditor.importJSONFile(e.target.files && e.target.files[0]));
    }
    if (exampleBtn) {
        exampleBtn.addEventListener('click', () => {
            try {
                if (!window.flowEditor || !window.flowEditor.boards || !window.flowEditor.boards.length) return;
                const editor = window.flowEditor.boards[0].editor;
                if (!editor) return;
                editor.state.nodes = [];
                editor.state.edges = [];
                editor.seedExample();
                saveFlowData(editor.state);
                editor.render();
            } catch {}
        });
    }
    if (tidyBtn) {
        tidyBtn.addEventListener('click', () => {
            try {
                if (!window.flowEditor || !window.flowEditor.boards || !window.flowEditor.boards.length) return;
                const editor = window.flowEditor.boards[0].editor;
                if (!editor) return;
                editor.autoArrange();
            } catch {}
        });
    }
}

// Fallback delegated handlers to ensure Flow Save/History always respond
document.addEventListener('click', (event) => {
    try {
        const target = event.target;
        if (!target) return;
        // Find the closest button since icons/svg can be inside
        const button = target.closest && target.closest('#flowNavSave, #flowToolSave, #flowNavHistory, #flowToolHistory');
        if (!button) return;

        // Ensure flow editor exists on-demand
        if (!window.flowEditor) {
            if (window.Components && typeof window.Components.renderFlow === 'function') {
                window.Components.renderFlow('flowMount');
            }
            window.flowEditor = new FlowBoards();
        }

        if (button.id === 'flowNavSave' || button.id === 'flowToolSave') {
            event.preventDefault();
            if (window.flowEditor && typeof window.flowEditor.saveVersion === 'function') {
                window.flowEditor.saveVersion();
            }
        }
        if (button.id === 'flowNavHistory' || button.id === 'flowToolHistory') {
            event.preventDefault();
            if (window.flowEditor && typeof window.flowEditor.openHistory === 'function') {
                window.flowEditor.openHistory();
            }
        }
    } catch (err) {
        console.warn('Flow navbar delegated handler error:', err);
    }
});

// bindFlowActionBar removed (reverted)

function setupCoverFeature() {
    const uploadArea = document.getElementById('coverUploadArea');
    const fileInput = document.getElementById('coverImageInput');
    const previewWrap = document.getElementById('coverImagePreview');
    const previewImg = document.getElementById('coverImageEl');
    const removeBtn = document.getElementById('removeCoverImageBtn');
    const titleInput = document.getElementById('coverTitle');
    const descInput = document.getElementById('coverDescription');

    if (!uploadArea || !fileInput || !previewWrap || !previewImg || !removeBtn || !titleInput || !descInput) return;

    // Initialize from storage
    const data = loadCoverData();
    titleInput.value = data.title || '';
    descInput.value = data.description || '';
    if (data.image) {
        previewImg.src = data.image;
        previewWrap.style.display = 'block';
        uploadArea.style.display = 'none';
    } else {
        previewWrap.style.display = 'none';
        uploadArea.style.display = 'block';
    }

    const debounce = (fn, wait = 300) => {
        let t;
        return (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn(...args), wait);
        };
    };

    const validateImage = (file) => {
        const maxSize = 5 * 1024 * 1024;
        const allowed = ['image/jpeg','image/jpg','image/png','image/gif','image/webp'];
        if (!allowed.includes(file.type)) { alert('Please select a valid image (JPG, PNG, GIF, WebP).'); return false; }
        if (file.size > maxSize) { alert('File size must be less than 5MB.'); return false; }
        return true;
    };

    const compressImageFile = (file, { maxWidth = 2400, maxHeight = 2400, quality = 0.9, format = 'image/jpeg' } = {}) => new Promise((resolve, reject) => {
        try {
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => {
                    let tw = img.width, th = img.height;
                    const ratio = Math.min(1, maxWidth / tw, maxHeight / th);
                    tw = Math.round(tw * ratio); th = Math.round(th * ratio);
                    const canvas = document.createElement('canvas');
                    canvas.width = tw; canvas.height = th;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, tw, th);
                    resolve(canvas.toDataURL(format, quality));
                };
                img.onerror = () => reject(new Error('Image load failed'));
                img.src = reader.result;
            };
            reader.onerror = () => reject(new Error('Read failed'));
            reader.readAsDataURL(file);
        } catch (e) { reject(e); }
    });

    const showPreview = (dataUrl) => {
        previewImg.src = dataUrl;
        previewWrap.style.display = 'block';
        uploadArea.style.display = 'none';
        const save = loadCoverData();
        save.image = dataUrl;
        saveCoverData(save);
    };

    uploadArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (!validateImage(file)) { fileInput.value = ''; return; }
        compressImageFile(file).then(showPreview).catch(() => {
            const reader = new FileReader();
            reader.onload = () => showPreview(reader.result);
            reader.readAsDataURL(file);
        });
    });

    uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); });
    uploadArea.addEventListener('dragleave', (e) => { e.preventDefault(); uploadArea.classList.remove('dragover'); });
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault(); uploadArea.classList.remove('dragover');
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (!file) return;
        if (!validateImage(file)) return;
        compressImageFile(file).then(showPreview).catch(() => {
            const reader = new FileReader();
            reader.onload = () => showPreview(reader.result);
            reader.readAsDataURL(file);
        });
    });

    removeBtn.addEventListener('click', () => {
        previewImg.src = '';
        previewWrap.style.display = 'none';
        uploadArea.style.display = 'block';
        const save = loadCoverData();
        save.image = '';
        saveCoverData(save);
    });

    const saveTitle = debounce(() => {
        const save = loadCoverData();
        save.title = titleInput.value || '';
        saveCoverData(save);
    }, 300);
    const saveDesc = debounce(() => {
        const save = loadCoverData();
        save.description = descInput.value || '';
        saveCoverData(save);
    }, 300);

    titleInput.addEventListener('input', saveTitle);
    descInput.addEventListener('input', saveDesc);
}
function setupProjectCollapse() {
    const sidebar = document.getElementById('projectSidebar');
    const toggleBtn = document.getElementById('toggleProjectSidebar');
    if (!sidebar || !toggleBtn) return;
    // Apply initial state from settings
    try {
        const s = loadSettings();
        let initialCollapsed = !!s.sidebarCollapsed;
        // Fallback to global UI key if per-project setting is missing
        if (s.sidebarCollapsed === undefined) {
            const globalFlag = localStorage.getItem('uiSidebarCollapsed');
            if (globalFlag === 'true') initialCollapsed = true;
            if (globalFlag === 'false') initialCollapsed = false;
        }
        sidebar.classList.toggle('collapsed', initialCollapsed);
        document.body.classList.toggle('sidebar-collapsed', initialCollapsed);
        const width = initialCollapsed ? '64px' : '260px';
        document.body.style.setProperty('--sidebar-current-width', width);
    } catch {}
    toggleBtn.addEventListener('click', () => {
        const isCollapsed = sidebar.classList.toggle('collapsed');
        document.body.classList.toggle('sidebar-collapsed', isCollapsed);
        // Update CSS variable for smooth layout shift
        const width = isCollapsed ? '64px' : '260px';
        document.body.style.setProperty('--sidebar-current-width', width);
        // Persist state per project in settings
        try {
            saveSettings({ sidebarCollapsed: isCollapsed });
            // Also persist a global fallback for early-boot usage and cross-project consistency
            localStorage.setItem('uiSidebarCollapsed', String(isCollapsed));
        } catch {}
    });
}

// --- Project name heading binding ---
function updateProjectNameHeading() {
    try {
        const h2 = document.getElementById('projectNameHeading');
        if (!h2) return;
        const currentId = getCurrentProjectId();
        const projects = loadProjects();
        const current = projects.find(p => p.id === currentId);
        h2.textContent = current ? current.name : 'Project Name';
    } catch {}
}

// --- TOC menu ---
function setupTocMenu() {
    const btn = document.getElementById('tocMenuBtn');
    const dropdown = btn ? btn.parentElement : null;
    const menu = document.getElementById('tocMenu');
    const deleteBtn = document.getElementById('tocDeleteProjectBtn');
    if (!btn || !dropdown || !menu || !deleteBtn) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('active');
    });
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target)) dropdown.classList.remove('active');
    });
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.journey && typeof window.journey.deleteCurrentProject === 'function') {
            window.journey.deleteCurrentProject();
        }
        dropdown.classList.remove('active');
    });
}

function setupProjectNameHeading() {
    const h2 = document.getElementById('projectNameHeading');
    if (!h2) return;
    h2.contentEditable = 'true';
    h2.setAttribute('spellcheck', 'false');
    h2.setAttribute('title', 'Click to rename project');

    const commitName = () => {
        const raw = (h2.textContent || '').trim();
        if (!raw) { updateProjectNameHeading(); return; }
        const projects = loadProjects();
        const currentId = getCurrentProjectId();
        const idx = projects.findIndex(p => p.id === currentId);
        if (idx >= 0 && projects[idx].name !== raw) {
            projects[idx].name = raw;
            saveProjects(projects);
            // Re-render sidebar list to reflect new name and keep selection
            const listEl = document.getElementById('projectList');
            if (listEl) {
                // Simple way: trigger sidebar rerender via existing setup
                // Find and update the active item's title if present
                listEl.querySelectorAll('.project-item').forEach(el => {
                    if (el.classList.contains('active')) {
                        const title = el.firstChild;
                        if (title) title.textContent = raw;
                    }
                });
            }
        }
        h2.blur();
    };

    h2.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commitName();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            updateProjectNameHeading();
            h2.blur();
        }
    });

    h2.addEventListener('blur', () => {
        commitName();
    });
}

// --- Storage usage indicator ---
function isAppStorageKey(key) {
    if (!key) return false;
    return key === PROJECTS_KEY
        || key === CURRENT_PROJECT_KEY
        || key.startsWith(`${BASE_STORAGE_KEY}:`)
        || key.startsWith(`${BASE_VERSIONS_KEY}:`)
        || key.startsWith(`${BASE_CHANGES_KEY}:`)
        || key.startsWith(`${BASE_COVER_KEY}:`);
}

function estimateAppStorageBytes() {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!isAppStorageKey(key)) continue;
        const value = localStorage.getItem(key);
        // Use Blob to approximate real byte size of stored strings
        total += new Blob([key || '']).size + new Blob([value || '']).size;
    }
    return total;
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function setupStorageUsage() {
    // Even if the top storage element is removed, keep periodic update for bottom meter
    setInterval(updateStorageUsage, 5000);
    window.addEventListener('storage', updateStorageUsage);
}

function updateStorageUsage() {
    // Only update bottom mini meter now
    try { renderSidebarBottom(); } catch {}
}
