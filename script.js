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
const BASE_PERSONAS_KEY = 'personasData';
const BASE_ACTIVE_TAB_KEY = 'activeTab';

// ===== Device storage (OPFS) sync for installed PWA =====
// In browser mode: keep using localStorage only.
// In installed PWA (standalone): mirror localStorage <-> OPFS (Origin Private File System) so data lives on device.
const IS_STANDALONE = (function() {
    try {
        return window.matchMedia && window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    } catch { return false; }
})();

const DEVICE_DIR_NAME = 'flowbox';
const DEVICE_DATA_FILE = 'data.json';

// Ask browser to make storage persistent to avoid eviction (installed app)
(async function ensurePersistentStorage() {
    try {
        if (!IS_STANDALONE) return;
        if (navigator.storage && navigator.storage.persist) {
            await navigator.storage.persist();
        }
    } catch {}
})();

async function isOpfsAvailable() {
    try { return !!(navigator.storage && navigator.storage.getDirectory); } catch { return false; }
}

async function getOpfsFileHandle() {
    const root = await navigator.storage.getDirectory();
    const appDir = await root.getDirectoryHandle(DEVICE_DIR_NAME, { create: true });
    const fileHandle = await appDir.getFileHandle(DEVICE_DATA_FILE, { create: true });
    return fileHandle;
}

async function readFromDeviceStorage() {
    try {
        if (!(await isOpfsAvailable())) return null;
        const fh = await getOpfsFileHandle();
        const file = await fh.getFile();
        const text = await file.text();
        if (!text) return null;
        return JSON.parse(text);
    } catch {
        return null;
    }
}

async function writeToDeviceStorage(payload) {
    try {
        if (!(await isOpfsAvailable())) return false;
        const fh = await getOpfsFileHandle();
        const writable = await fh.createWritable();
        await writable.write(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
        await writable.close();
        return true;
    } catch {
        return false;
    }
}

function collectLocalStorageSnapshot() {
    // Reuse the same prefixes used for export/import
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
        BASE_ACTIVE_TAB_KEY,
        BASE_PERSONAS_KEY
    ];
    const storage = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (prefixes.some(p => key === p || key.startsWith(p + ':'))) {
            storage[key] = localStorage.getItem(key);
        }
    }
    return { meta: { app: 'flowbox', source: 'opfs-mirror', exportedAt: new Date().toISOString() }, storage };
}

function applySnapshotToLocalStorage(storage) {
    try {
        const keys = Object.keys(storage || {});
        // Remove existing keys in our namespace to avoid stale values
        const namespaces = [
            PROJECTS_KEY,
            CURRENT_PROJECT_KEY,
            BASE_STORAGE_KEY,
            BASE_VERSIONS_KEY,
            BASE_CHANGES_KEY,
            BASE_COVER_KEY,
            BASE_SETTINGS_KEY,
            BASE_FLOW_KEY,
            BASE_FLOW_VERSIONS_KEY,
            BASE_ACTIVE_TAB_KEY,
            BASE_PERSONAS_KEY
        ];
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k) continue;
            if (namespaces.some(p => k === p || k.startsWith(p + ':'))) toRemove.push(k);
        }
        toRemove.forEach(k => { try { localStorage.removeItem(k); } catch {} });
        keys.forEach(k => { try { localStorage.setItem(k, storage[k]); } catch {} });
    } catch {}
}

async function hydrateFromDeviceIfStandalone() {
    try {
        if (!IS_STANDALONE) return;
        if (!(await isOpfsAvailable())) return;
        const devicePayload = await readFromDeviceStorage();
        if (devicePayload && devicePayload.storage) {
            applySnapshotToLocalStorage(devicePayload.storage);
            // Ensure early inline scripts see hydrated state (only once per session)
            try {
                if (!sessionStorage.getItem('flowboxHydrated')) {
                    sessionStorage.setItem('flowboxHydrated', '1');
                    location.reload();
                }
            } catch {}
        } else {
            // Initialize device storage with current local snapshot
            await writeToDeviceStorage(collectLocalStorageSnapshot());
        }
    } catch {}
}

// Setup mirroring of localStorage -> device storage (debounced) when in standalone
(async function setupDeviceMirroring() {
    try {
        if (!IS_STANDALONE) return;
        if (!(await isOpfsAvailable())) return;

        // Hydrate first
        await hydrateFromDeviceIfStandalone();

        let debounceTimer;
        function scheduleMirror() {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                try { await writeToDeviceStorage(collectLocalStorageSnapshot()); } catch {}
            }, 200);
        }

        const originalSetItem = localStorage.setItem.bind(localStorage);
        const originalRemoveItem = localStorage.removeItem.bind(localStorage);
        const originalClear = localStorage.clear.bind(localStorage);

        localStorage.setItem = function(key, value) {
            const result = originalSetItem(key, value);
            try { scheduleMirror(); } catch {}
            return result;
        };
        localStorage.removeItem = function(key) {
            const result = originalRemoveItem(key);
            try { scheduleMirror(); } catch {}
            return result;
        };
        localStorage.clear = function() {
            const result = originalClear();
            try { scheduleMirror(); } catch {}
            return result;
        };

        // Also mirror on visibility changes to be safe
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                try { writeToDeviceStorage(collectLocalStorageSnapshot()); } catch {}
            }
        });

        // Expose manual sync for debugging
        window.flowboxSyncToDeviceNow = async function() {
            return await writeToDeviceStorage(collectLocalStorageSnapshot());
        };
    } catch {}
})();

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
        BASE_ACTIVE_TAB_KEY,
        BASE_PERSONAS_KEY
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
                key.startsWith(BASE_FLOW_KEY + ':') || key.startsWith(BASE_FLOW_VERSIONS_KEY + ':') || key.startsWith(BASE_ACTIVE_TAB_KEY + ':') || key.startsWith(BASE_PERSONAS_KEY + ':')) {
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
        localStorage.setItem(getScopedKey(BASE_FLOW_KEY, id), JSON.stringify({ nodes: [], sections: [], title: 'Flow 1' }));
        // initialize default personas data (empty array for true empty state)
        localStorage.setItem(getScopedKey(BASE_PERSONAS_KEY, id), JSON.stringify([]));
    } else if (!getCurrentProjectId()) {
        setCurrentProjectId(projects[0].id);
    }
}

function getScopedKey(base, projectId = getCurrentProjectId()) {
    return `${base}:${projectId}`;
}

// ===== PERSONA BOARD SYSTEM =====
// Multiple persona boards with individual personas

function createDefaultPersona() {
    return {
        id: `persona-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        image: '',
        name: '',
        role: '',
        age: '',
        location: '',
        quote1: '',
        quote2: '',
        about: '',
        behaviors: '',
        frustrations: '',
        goals: '',
        tasks: ''
    };
}

function createDefaultPersonaBoard() {
    return {
        id: `board-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: 'Persona Board 1',
        personas: [createDefaultPersona()],
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
}

function loadPersonaBoards() {
    try {
        // Prefer project-scoped key; if missing, migrate from legacy unscoped key
        let data = localStorage.getItem(getScopedKey(BASE_PERSONAS_KEY));
        if (!data) {
            const legacy = localStorage.getItem(BASE_PERSONAS_KEY);
            if (legacy) {
                try {
                    // Migrate legacy unscoped personas into current project scope
                    localStorage.setItem(getScopedKey(BASE_PERSONAS_KEY), legacy);
                    data = legacy;
                    console.log('Migrated legacy personas to project-scoped storage');
                } catch (e) {
                    console.warn('Failed migrating legacy personas to scoped storage', e);
                }
            }
        }
        if (!data) return [];

        const parsed = JSON.parse(data);
        if (!Array.isArray(parsed)) return [];

        // Check if this is legacy data (array of personas) or new data (array of boards)
        if (parsed.length > 0 && parsed[0].personas) {
            // New format: array of boards
            return parsed.filter(board => board && typeof board === 'object' && Array.isArray(board.personas));
        } else {
            // Legacy format: array of personas - convert to board format
            const legacyPersonas = parsed
                .filter(p => p && typeof p === 'object')
                .map(p => ({
                    ...createDefaultPersona(),
                    ...p,
                    id: p.id || createDefaultPersona().id
                }))
                .filter(p => {
                    const fields = [
                        p.name, p.role, p.age, p.location,
                        p.quote1, p.quote2, p.about,
                        p.behaviors, p.frustrations, p.goals, p.tasks,
                        p.image
                    ];
                    return fields.some(v => v && String(v).trim() !== '');
                });

            if (legacyPersonas.length > 0) {
                // Convert legacy personas to a single board
                const defaultBoard = createDefaultPersonaBoard();
                defaultBoard.personas = legacyPersonas;
                return [defaultBoard];
            }
            return [];
        }
    } catch (error) {
        console.error('Error loading persona boards:', error);
        return [];
    }
}

// Legacy function for backward compatibility
function loadPersonas() {
    const boards = loadPersonaBoards();
    if (boards.length === 0) return [];
    return boards[0].personas || [];
}

function savePersonaBoards(boards) {
    try {
        const data = JSON.stringify(boards || []);
        localStorage.setItem(getScopedKey(BASE_PERSONAS_KEY), data);
        updateStorageUsage();
        return true;
    } catch (error) {
        console.error('Error saving persona boards:', error);
        return false;
    }
}

// Legacy function for backward compatibility
function savePersonas(personas) {
    const boards = loadPersonaBoards();
    if (boards.length === 0) {
        // Create a new board with the personas
        const newBoard = createDefaultPersonaBoard();
        newBoard.personas = personas || [];
        return savePersonaBoards([newBoard]);
    } else {
        // Update the first board with the personas
        boards[0].personas = personas || [];
        boards[0].updatedAt = Date.now();
        return savePersonaBoards(boards);
    }
}

function getSelectedPersonaId() {
    try {
        return localStorage.getItem(getScopedKey('selectedPersonaId')) || null;
    } catch {
        return null;
    }
}

function getSelectedPersonaBoardId() {
    try {
        return localStorage.getItem(getScopedKey('selectedPersonaBoardId')) || null;
    } catch {
        return null;
    }
}

function setSelectedPersonaBoardId(boardId) {
    try {
        localStorage.setItem(getScopedKey('selectedPersonaBoardId'), boardId);
        return true;
    } catch {
        return false;
    }
}

function createNewPersonaBoard(name = null) {
    const boards = loadPersonaBoards();
    const newBoard = createDefaultPersonaBoard();
    
    if (name) {
        newBoard.name = name;
    } else {
        // Generate a unique name
        const existingNames = boards.map(b => b.name);
        let counter = boards.length + 1;
        let boardName = `Persona Board ${counter}`;
        while (existingNames.includes(boardName)) {
            counter++;
            boardName = `Persona Board ${counter}`;
        }
        newBoard.name = boardName;
    }
    
    boards.push(newBoard);
    savePersonaBoards(boards);
    setSelectedPersonaBoardId(newBoard.id);
    return newBoard;
}

function deletePersonaBoard(boardId) {
    const boards = loadPersonaBoards();
    const filteredBoards = boards.filter(board => board.id !== boardId);
    
    if (filteredBoards.length > 0) {
        // Set the first remaining board as selected
        setSelectedPersonaBoardId(filteredBoards[0].id);
    } else {
        // Clear selected board if no boards left
        setSelectedPersonaBoardId(null);
    }
    
    savePersonaBoards(filteredBoards);
    return true;
}

function getCurrentPersonaBoard() {
    const boards = loadPersonaBoards();
    const selectedBoardId = getSelectedPersonaBoardId();
    
    if (selectedBoardId) {
        const board = boards.find(b => b.id === selectedBoardId);
        if (board) return board;
    }
    
    // Return first board or create default
    if (boards.length > 0) {
        setSelectedPersonaBoardId(boards[0].id);
        return boards[0];
    }
    
    // Create default board
    const defaultBoard = createDefaultPersonaBoard();
    savePersonaBoards([defaultBoard]);
    setSelectedPersonaBoardId(defaultBoard.id);
    return defaultBoard;
}

function setSelectedPersonaId(personaId) {
    try {
        if (personaId) {
            localStorage.setItem(getScopedKey('selectedPersonaId'), personaId);
        } else {
            localStorage.removeItem(getScopedKey('selectedPersonaId'));
        }
    } catch (error) {
        console.error('Error setting selected persona ID:', error);
    }
}

function switchToPersona(personaId) {
    console.log('Switching to persona:', personaId);
    setSelectedPersonaId(personaId);
    
    const personas = loadPersonas();
    const selectedPersona = personas.find(p => p.id === personaId);
    
    if (selectedPersona) {
        // Move selected persona to index 0 (primary position)
        const updatedPersonas = personas.filter(p => p.id !== personaId);
        updatedPersonas.unshift(selectedPersona);
        savePersonas(updatedPersonas);
        
        // Re-render the interface
        renderPersonasInterface();
        
        // Update active states
        updatePersonaActiveStates();
    }
}

function deletePersona(personaId) {
    const boards = loadPersonaBoards();
    let personaToDelete = null;
    let targetBoard = null;
    
    // Find the persona and its board
    for (const board of boards) {
        const persona = board.personas.find(p => p.id === personaId);
        if (persona) {
            personaToDelete = persona;
            targetBoard = board;
            break;
        }
    }
    
    if (!personaToDelete || !targetBoard) return;
    
    const personaName = personaToDelete?.name || 'this persona';
    
    if (confirm(`Are you sure you want to delete "${personaName}"? This action cannot be undone.`)) {
        // Remove the persona from its board
        targetBoard.personas = targetBoard.personas.filter(p => p.id !== personaId);
        targetBoard.updatedAt = Date.now();
        
        // If the board has no personas left, remove the board
        if (targetBoard.personas.length === 0) {
            deletePersonaBoard(targetBoard.id);
        } else {
            savePersonaBoards(boards);
        }
        
        // Clear selected persona if it was deleted
        const selectedPersonaId = getSelectedPersonaId();
        if (selectedPersonaId === personaId) {
            setSelectedPersonaId(null);
        }
        
        // Re-render the interface
        renderPersonasList();
        
        // Show success message
        showPersonaToast('Persona deleted successfully');
    }
}

// Helper function to crop image to square aspect ratio
function cropImageToSquare(imageSrc, size = 160) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = size;
            canvas.height = size;
            
            // Calculate crop dimensions to maintain aspect ratio
            const imgAspect = img.width / img.height;
            let sourceX = 0, sourceY = 0, sourceWidth = img.width, sourceHeight = img.height;
            
            if (imgAspect > 1) {
                // Image is wider than tall - crop width
                sourceWidth = img.height;
                sourceX = (img.width - sourceWidth) / 2;
            } else {
                // Image is taller than wide - crop height
                sourceHeight = img.width;
                sourceY = (img.height - sourceHeight) / 2;
            }
            
            // Draw the cropped image
            ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, size, size);
            resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => resolve(imageSrc); // Fallback to original if cropping fails
        img.src = imageSrc;
    });
}

// Export individual persona as PNG
function exportPersonaAsPNG(personaId) {
    try {
        const personaCard = document.querySelector(`.persona-card[data-persona-id="${personaId}"]`);
        if (!personaCard) {
            showPersonaToast('Persona not found for export', 'error');
            return;
        }

        // Show loading state
        showPersonaToast('Generating PNG export...', 'info');

        // A4 Landscape dimensions (in pixels at 300 DPI)
        const A4_LANDSCAPE_WIDTH = 3508;  // 297mm * 300 DPI / 25.4
        const A4_LANDSCAPE_HEIGHT = 2480; // 210mm * 300 DPI / 25.4

        // Use html2canvas to capture the persona card cleanly
        if (typeof html2canvas !== 'undefined') {
            html2canvas(personaCard, {
                backgroundColor: '#ffffff',
                scale: 2,
                useCORS: true,
                allowTaint: true,
                logging: false,
                imageTimeout: 15000,
                removeContainer: true,
                foreignObjectRendering: false,
                ignoreElements: function(element) {
                    // Don't ignore any elements, but ensure proper rendering
                    return false;
                },
                // Clean capture without dropdown
                onclone: async function(clonedDoc) {
                    const clonedCard = clonedDoc.querySelector(`.persona-card[data-persona-id="${personaId}"]`);
                    if (clonedCard) {
                        // Hide the dropdown menu
                        const menuDropdown = clonedCard.querySelector('.persona-menu-dropdown');
                        if (menuDropdown) {
                            menuDropdown.style.display = 'none';
                        }
                        
                        // Hide the menu button
                        const menuBtn = clonedCard.querySelector('.persona-menu-btn');
                        if (menuBtn) {
                            menuBtn.style.display = 'none';
                        }
                        
                        // Ensure clean layout
                        clonedCard.style.width = '100%';
                        clonedCard.style.overflow = 'visible';
                        clonedCard.style.padding = '20px';
                        clonedCard.style.boxSizing = 'border-box';
                        
                        // Make text elements more readable
                        const textElements = clonedCard.querySelectorAll('input, textarea');
                        textElements.forEach(element => {
                            element.style.border = '1px solid #ddd';
                            element.style.padding = '8px';
                            element.style.fontSize = '14px';
                            element.style.lineHeight = '1.4';
                            element.style.backgroundColor = '#ffffff';
                        });
                        
                        // Process images with square cropping
                        const images = clonedCard.querySelectorAll('.persona-photo-img, .persona-photo img');
                        for (const img of images) {
                            if (img.src && img.src !== '') {
                                try {
                                    // Crop the image to square aspect ratio
                                    const croppedImageSrc = await cropImageToSquare(img.src, 160);
                                    img.src = croppedImageSrc;
                                    
                                    // Set explicit dimensions for the image
                                    img.style.width = '160px';
                                    img.style.height = '160px';
                                    img.style.objectFit = 'fill';
                                    img.style.borderRadius = '12px';
                                    img.style.display = 'block';
                                    
                                    // Ensure the parent container maintains square aspect ratio
                                    const photoContainer = img.closest('.persona-photo');
                                    if (photoContainer) {
                                        photoContainer.style.width = '160px';
                                        photoContainer.style.height = '160px';
                                        photoContainer.style.overflow = 'hidden';
                                        photoContainer.style.position = 'relative';
                                        photoContainer.style.display = 'block';
                                    }
                                } catch (error) {
                                    console.warn('Failed to crop image:', error);
                                    // Fallback to original styling
                                    img.style.objectFit = 'cover';
                                    img.style.objectPosition = 'center';
                                    img.style.width = '100%';
                                    img.style.height = '100%';
                                }
                            }
                        }
                    }
                }
            }).then(canvas => {
                // Create a new canvas with A4 landscape dimensions
                const a4Canvas = document.createElement('canvas');
                a4Canvas.width = A4_LANDSCAPE_WIDTH;
                a4Canvas.height = A4_LANDSCAPE_HEIGHT;
                const ctx = a4Canvas.getContext('2d');
                
                // Fill with white background
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, A4_LANDSCAPE_WIDTH, A4_LANDSCAPE_HEIGHT);
                
                // Calculate scaling to fit the content within A4 landscape
                const scaleX = A4_LANDSCAPE_WIDTH / canvas.width;
                const scaleY = A4_LANDSCAPE_HEIGHT / canvas.height;
                const scale = Math.min(scaleX, scaleY);
                
                // Calculate centered position
                const scaledWidth = canvas.width * scale;
                const scaledHeight = canvas.height * scale;
                const x = (A4_LANDSCAPE_WIDTH - scaledWidth) / 2;
                const y = (A4_LANDSCAPE_HEIGHT - scaledHeight) / 2;
                
                // Draw the scaled content
                ctx.drawImage(canvas, x, y, scaledWidth, scaledHeight);
                
                // Create download link
                const link = document.createElement('a');
                link.download = `persona-${personaId}-a4-landscape-${Date.now()}.png`;
                link.href = a4Canvas.toDataURL('image/png', 1.0); // Maximum quality
                link.click();
                
                showPersonaToast('PNG export completed! (A4 Landscape)', 'success');
            }).catch(error => {
                console.error('PNG export error:', error);
                showPersonaToast('PNG export failed', 'error');
            });
        } else {
            showPersonaToast('PNG export not available - html2canvas library missing', 'error');
        }
    } catch (error) {
        console.error('Export PNG error:', error);
        showPersonaToast('PNG export failed', 'error');
    }
}


// ===== PERSONA INTERFACE FUNCTIONS =====

// DISABLED: Global export dropdown handler to prevent conflicts with flowboard 3-dots
function setupGlobalExportHandlers() {
    console.log('Global export handlers DISABLED to prevent conflicts with flowboard 3-dots');
    
    // Only handle persona-specific exports, not flowboard exports
    document.addEventListener('click', function(e) {
        // Handle persona export button clicks only
        if (e.target.closest('#personaExportBtn')) {
            e.stopPropagation();
            const dropdown = e.target.closest('.export-dropdown[data-context="persona"]');
            if (dropdown) {
                console.log('Persona export button clicked via global handler');
                dropdown.classList.toggle('active');
            }
        }
        
        // Handle persona export option clicks only
        if (e.target.closest('.export-option') && e.target.closest('.export-dropdown[data-context="persona"]')) {
            const option = e.target.closest('.export-option');
            const format = option.getAttribute('data-format');
            const dropdown = e.target.closest('.export-dropdown');
            
            console.log('Persona export option clicked via global handler:', format);
            exportPersonaData(format);
            dropdown.classList.remove('active');
        }
        
        // Close dropdowns when clicking outside (but only persona dropdowns)
        if (!e.target.closest('.export-dropdown[data-context="persona"]')) {
            document.querySelectorAll('.export-dropdown[data-context="persona"].active').forEach(dropdown => {
                dropdown.classList.remove('active');
            });
        }
    });
}

function renderPersonasInterface() {
    const mount = document.getElementById('personasMount');
    if (!mount) return;
    
    renderPersonasList();
}
function renderInformationHierarchyInterface() {
    const mount = document.getElementById('informationHierarchyMount');
    if (!mount) return;
    
    // Root container
    mount.innerHTML = `
        <div class="information-hierarchy-container" id="ihContainer">
            <div class="flow-board-title-container" style="display:flex; align-items:center; gap:8px;">
                <h4 class="flow-board-title" id="ihBoardName" contenteditable="true">Board 1</h4>
                <button class="btn btn-secondary icon-only" id="ihDeleteBoardBtn" title="Delete board" aria-label="Delete board">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M9 3h6l1 2h4v2H4V5h4l1-2z" stroke="#333" stroke-width="1.5" fill="none"/>
                        <path d="M6 9h12l-1 10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9z" stroke="#333" stroke-width="1.5" fill="none"/>
                        <path d="M10 13v6M14 13v6" stroke="#333" stroke-width="1.5"/>
                    </svg>
                </button>
            </div>
            <div class="flow-container" id="ihEditorRoot">
                <div class="flow-board flow-board-even">
                    <div class="flow-canvas-wrap" id="ihCanvasWrap">
                        <div class="flow-grid" id="ihGrid" style="width:20000px;height:10000px;"></div>
                        <svg class="flow-edges-svg" id="ihEdges" width="20000" height="10000"></svg>
                        <div class="flow-area" id="ihCanvas" style="width:20000px;height:10000px;"></div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Lightweight editor state
    const gridSize = 20;
    let snapEnabled = true;
    let connectMode = false;
    const projectId = getCurrentProjectId();
    const STORAGE_KEY = getScopedKey('ihData');
    const canvas = mount.querySelector('#ihCanvas');
    const edgesSvg = mount.querySelector('#ihEdges');
    const boardNameEl = mount.querySelector('#ihBoardName');

    const state = { nodes: [], edges: [], boardName: 'Board 1' };

    // Utilities
    const snap = (v) => snapEnabled ? Math.round(v / gridSize) * gridSize : v;
    const updateStatus = () => {};
    function save() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
        showSuccessToast('Information Hierarchy saved');
    }
    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const data = JSON.parse(raw);
            if (data && Array.isArray(data.nodes)) {
                state.nodes = data.nodes;
                state.edges = Array.isArray(data.edges) ? data.edges : [];
                if (typeof data.boardName === 'string' && data.boardName.trim()) {
                    state.boardName = data.boardName;
                }
            }
        } catch {}
    }

    // Render helpers
    function renderNode(node) {
        let el = canvas.querySelector(`[data-id="${node.id}"]`);
        if (!el) {
            el = document.createElement('div');
            el.className = 'flow-node';
            el.dataset.id = node.id;
            el.style.minWidth = '160px';
            el.style.minHeight = '48px';
            el.innerHTML = `
                <div class="drag-handle" title="Drag"></div>
                <div class="label" contenteditable="true" data-placeholder="Text"></div>
            `;
            canvas.appendChild(el);
            // Edit text updates
            const label = el.querySelector('.label');
            label.textContent = node.text || '';
            label.addEventListener('input', () => { node.text = label.textContent; scheduleSave(); });
            // Dragging
            attachDrag(el, node);
            // Click for connect mode
            el.addEventListener('click', onNodeClick);
        }
        el.style.left = `${node.x}px`;
        el.style.top = `${node.y}px`;
        return el;
    }

    function renderAll() {
        // nodes
        state.nodes.forEach(renderNode);
        // edges
        edgesSvg.innerHTML = '';
        state.edges.forEach((e) => drawEdge(e));
    }

    function drawEdge(edge) {
        const from = state.nodes.find(n => n.id === edge.from);
        const to = state.nodes.find(n => n.id === edge.to);
        if (!from || !to) return;
        const fromCenter = { x: from.x + 80, y: from.y + 24 };
        const toCenter = { x: to.x + 80, y: to.y + 24 };
        // Orthogonal connector with a mid X for auto line connector look
        const midX = Math.round((fromCenter.x + toCenter.x) / 2);
        const d = `M ${fromCenter.x} ${fromCenter.y} L ${midX} ${fromCenter.y} L ${midX} ${toCenter.y} L ${toCenter.x} ${toCenter.y}`;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('stroke', '#2196f3');
        path.setAttribute('fill', 'none');
        path.setAttribute('class', 'flow-edge');
        edgesSvg.appendChild(path);
    }

    // Dragging with snap
    function attachDrag(el, node) {
        const handle = el.querySelector('.drag-handle') || el;
        let startX = 0, startY = 0, originX = 0, originY = 0, dragging = false;
        const onDown = (e) => {
            const p = e.touches ? e.touches[0] : e;
            dragging = true;
            startX = p.clientX; startY = p.clientY;
            originX = node.x; originY = node.y;
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            document.addEventListener('touchmove', onMove, { passive:false });
            document.addEventListener('touchend', onUp);
        };
        const onMove = (e) => {
            if (!dragging) return;
            const p = e.touches ? e.touches[0] : e;
            const dx = p.clientX - startX;
            const dy = p.clientY - startY;
            node.x = snap(originX + dx);
            node.y = snap(originY + dy);
            el.style.left = `${node.x}px`;
            el.style.top = `${node.y}px`;
            // redraw edges connected to this node
            renderAll();
        };
        const onUp = () => {
            if (!dragging) return;
            dragging = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onUp);
            scheduleSave();
        };
        handle.addEventListener('mousedown', onDown);
        handle.addEventListener('touchstart', onDown, { passive:true });
    }

    // Connect mode
    let pendingFromId = null;
    function onNodeClick(e) {
        if (!connectMode) return;
        const id = e.currentTarget.dataset.id;
        if (!pendingFromId) {
            pendingFromId = id;
            e.currentTarget.classList.add('selected');
        } else if (pendingFromId && pendingFromId !== id) {
            state.edges.push({ from: pendingFromId, to: id });
            const prev = canvas.querySelector(`[data-id="${pendingFromId}"]`);
            if (prev) prev.classList.remove('selected');
            pendingFromId = null;
            renderAll();
            scheduleSave();
        }
    }

    // Board name wiring
    function applyBoardName() {
        if (boardNameEl) {
            boardNameEl.textContent = state.boardName || 'Board 1';
        }
    }
    if (boardNameEl) {
        boardNameEl.addEventListener('input', () => {
            const name = (boardNameEl.textContent || '').trim();
            state.boardName = name || 'Board 1';
            scheduleSave();
        });
    }

    // Delete board
    const deleteBtn = mount.querySelector('#ihDeleteBoardBtn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
            if (!confirm('Delete this board? This cannot be undone.')) return;
            try { localStorage.removeItem(STORAGE_KEY); } catch {}
            // Clear entire Information Hierarchy page to empty state
            const root = mount;
            if (root) {
                root.innerHTML = '';
            }
        });
    }

    // No toolbar; creation and connections can be extended via context menu later

    let saveTimer = null;
    function scheduleSave() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(save, 300);
    }

    // Load and render
    load();
    applyBoardName();
    // Seed a default node for a non-empty starting state
    if (!state.nodes || state.nodes.length === 0) {
        const id = 'n' + Date.now();
        const node = { id, x: snap(240), y: snap(160), text: 'Start' };
        state.nodes.push(node);
        scheduleSave();
    }
    renderAll();
    updateStatus();
}



function renderEmptyPersonasState() {
    const mount = document.getElementById('personasMount');
    if (!mount) return;
    
    mount.innerHTML = `
        <div class="personas-container" id="personasContainer">
            <div class="persona-empty-state">
                <div class="empty-state-content">
                    <div class="empty-state-icon">👤</div>
                    <h3>No Personas Yet</h3>
                    <p>Create your first persona to get started with user research and design planning.</p>
                    <button class="btn btn-primary" id="createFirstPersona">
                        <span>+</span> Create First Persona
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // Clear any previously selected persona
    setSelectedPersonaId(null);
    updatePersonaActiveStates();

    // Add event listener for create button
    const createBtn = document.getElementById('createFirstPersona');
    if (createBtn) {
        createBtn.addEventListener('click', createFirstPersona);
    }
}

function renderPersonasList() {
    const mount = document.getElementById('personasMount');
    if (!mount) return;
    
    const boards = loadPersonaBoards();
    
    // Filter out empty boards (boards with no personas)
    const boardsWithPersonas = boards.filter(board => {
        const personas = board.personas || [];
        return personas.length > 0 && personas[0];
    });
    
    // If we found empty boards, clean them up from storage
    if (boardsWithPersonas.length !== boards.length) {
        savePersonaBoards(boardsWithPersonas);
    }
    
    if (boardsWithPersonas.length === 0) {
        renderEmptyPersonasState();
        return;
    }
    
    // Render all persona boards in a vertical list
    const boardsHTML = boardsWithPersonas.map(board => {
        const personas = board.personas || [];
        const primaryPersona = personas[0];
        
        return `
            <div class="personas-container" data-board-id="${board.id}" role="main" aria-label="Persona Management">
                <div class="persona-card" data-persona-id="${primaryPersona.id}">
                    <div class="persona-header">
                        <div class="persona-photo">
                            <input type="file" class="persona-image-input" data-persona-id="${primaryPersona.id}" accept="image/*" style="display:none;" />
                            <div class="persona-photo-upload" data-persona-id="${primaryPersona.id}" title="Click to add a photo">📷 Add Photo</div>
                            <img class="persona-photo-img" data-persona-id="${primaryPersona.id}" alt="Persona Photo" style="display:none;" />
                            <button class="remove-image-btn persona-remove-photo" data-persona-id="${primaryPersona.id}" style="display:none;">Remove</button>
                        </div>
                        <div class="persona-identity">
                            <input class="persona-name" data-persona-id="${primaryPersona.id}" placeholder="Name" value="${primaryPersona.name || ''}" 
                                aria-label="Persona name" required />
                            <input class="persona-role" data-persona-id="${primaryPersona.id}" placeholder="Role / Title" value="${primaryPersona.role || ''}" 
                                aria-label="Persona role or job title" />
                            <div class="persona-meta">
                                <input class="persona-age" data-persona-id="${primaryPersona.id}" placeholder="Age" value="${primaryPersona.age || ''}" 
                                    aria-label="Persona age" />
                                <input class="persona-location" data-persona-id="${primaryPersona.id}" placeholder="Location" value="${primaryPersona.location || ''}" 
                                    aria-label="Persona location" />
                            </div>
                        </div>
                        <div class="persona-quotes">
                            <textarea class="persona-quote1" data-persona-id="${primaryPersona.id}" placeholder="Primary quote" 
                                aria-label="Primary quote representing the persona">${primaryPersona.quote1 || ''}</textarea>
                            <textarea class="persona-quote2" data-persona-id="${primaryPersona.id}" placeholder="Secondary quote (optional)" 
                                aria-label="Secondary quote representing the persona">${primaryPersona.quote2 || ''}</textarea>
                        </div>
                        <div class="persona-menu">
                            <button class="persona-menu-btn" data-persona-id="${primaryPersona.id}" title="Persona options">
                                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <circle cx="12" cy="5" r="2" fill="currentColor"/>
                                    <circle cx="12" cy="12" r="2" fill="currentColor"/>
                                    <circle cx="12" cy="19" r="2" fill="currentColor"/>
                                </svg>
                            </button>
                            <div class="persona-menu-dropdown" data-persona-id="${primaryPersona.id}">
                                <button class="persona-menu-item export" data-action="export-png" data-persona-id="${primaryPersona.id}">📷 Export as PNG</button>
                                <button class="persona-menu-item delete" data-action="delete" data-persona-id="${primaryPersona.id}">🗑️ Delete Persona</button>
                            </div>
                        </div>
                    </div>
                    <div class="persona-body">
                        <section class="persona-section">
                            <h4>About</h4>
                            <textarea class="persona-about" data-persona-id="${primaryPersona.id}" rows="4" placeholder="Short bio" 
                                aria-label="Persona background and about information">${primaryPersona.about || ''}</textarea>
                        </section>
                        <section class="persona-section grid-2">
                            <div>
                                <h4>Behavioral Considerations</h4>
                                <textarea class="persona-behaviors" data-persona-id="${primaryPersona.id}" rows="8" placeholder="Bulleted points" 
                                    aria-label="Persona behavioral patterns and considerations">${primaryPersona.behaviors || ''}</textarea>
                            </div>
                            <div>
                                <h4>Frustrations</h4>
                                <textarea class="persona-frustrations" data-persona-id="${primaryPersona.id}" rows="8" placeholder="Bulleted points" 
                                    aria-label="Persona frustrations and pain points">${primaryPersona.frustrations || ''}</textarea>
                            </div>
                        </section>
                        <section class="persona-section grid-2">
                            <div>
                                <h4>Goals</h4>
                                <textarea class="persona-goals" data-persona-id="${primaryPersona.id}" rows="8" placeholder="Bulleted points" 
                                    aria-label="Persona goals and objectives">${primaryPersona.goals || ''}</textarea>
                            </div>
                            <div>
                                <h4>Tasks</h4>
                                <textarea class="persona-tasks" data-persona-id="${primaryPersona.id}" rows="8" placeholder="Bulleted points" 
                                    aria-label="Persona tasks and activities">${primaryPersona.tasks || ''}</textarea>
                            </div>
                        </section>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    mount.innerHTML = `
        <div class="personas-list-container">
            ${boardsHTML}
        </div>
    `;
    
    // Setup event listeners
    setupPersonaEventListeners();
    setupPersonaKeyboardNavigation();
    
    // Reflect saved image state from storage for all personas
    const savedBoards = loadPersonaBoards();
    savedBoards.forEach(board => {
        const personas = board.personas || [];
        personas.forEach(persona => {
            const photoImg = document.querySelector(`.persona-photo-img[data-persona-id="${persona.id}"]`);
            const photoUpload = document.querySelector(`.persona-photo-upload[data-persona-id="${persona.id}"]`);
            const removePhoto = document.querySelector(`.persona-remove-photo[data-persona-id="${persona.id}"]`);
            
            if (photoImg && photoUpload && removePhoto) {
                if (persona.image && String(persona.image).trim() !== '') {
                    photoImg.src = persona.image;
                    photoImg.style.display = 'block';
                    photoUpload.style.display = 'none';
                    removePhoto.style.display = 'block';
                } else {
                    photoImg.style.display = 'none';
                    photoUpload.style.display = 'flex';
                    removePhoto.style.display = 'none';
                }
            }
        });
    });

    // Update active states
    updatePersonaActiveStates();
}

function createFirstPersona() {
    const newPersona = createDefaultPersona();
    // Provide minimal meaningful defaults so it won't be filtered as blank
    newPersona.name = newPersona.name || 'New Persona';
    newPersona.role = newPersona.role || '';
    savePersonas([newPersona]);
    setSelectedPersonaId(newPersona.id);
    renderPersonasInterface();
}

function showPersonaToast(message, type = 'success') {
    // Remove any existing toast
    const existingToast = document.querySelector('.persona-toast');
    if (existingToast) {
        existingToast.remove();
    }

    // Simple toast notification with different types
    const toast = document.createElement('div');
    toast.className = 'persona-toast';
    
    // Set background color based on type - minimal black/white design
    let backgroundColor = '#000000'; // success - black
    if (type === 'error') backgroundColor = '#000000'; // error - black
    if (type === 'info') backgroundColor = '#000000'; // info - black
    if (type === 'warning') backgroundColor = '#000000'; // warning - black
    
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${backgroundColor};
        color: white;
        padding: 12px 20px;
        border-radius: 4px;
        z-index: 1000;
        font-size: 14px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        max-width: 300px;
        word-wrap: break-word;
        border: 1px solid #333;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function updatePersonaActiveStates() {
    const selectedPersonaId = getSelectedPersonaId();
    
    // Remove active class from all persona cards
    document.querySelectorAll('.persona-card').forEach(card => {
        card.classList.remove('active');
    });
    
    // Add active class to selected persona
    if (selectedPersonaId) {
        const selectedCard = document.querySelector(`[data-persona-id="${selectedPersonaId}"]`);
        if (selectedCard) {
            selectedCard.classList.add('active');
        }
    }
}

// Helper function to save persona data from a specific input element
function savePersonaFromElement(element) {
    const personaId = element.dataset.personaId;
    if (!personaId) return;
    
    const boards = loadPersonaBoards();
    const board = boards.find(b => b.personas.some(p => p.id === personaId));
    if (!board) return;
    
    const persona = board.personas.find(p => p.id === personaId);
    if (!persona) return;
    
    // Update the specific field based on the element's class
    const fieldMap = {
        'persona-name': 'name',
        'persona-role': 'role',
        'persona-age': 'age',
        'persona-location': 'location',
        'persona-quote1': 'quote1',
        'persona-quote2': 'quote2',
        'persona-about': 'about',
        'persona-behaviors': 'behaviors',
        'persona-frustrations': 'frustrations',
        'persona-goals': 'goals',
        'persona-tasks': 'tasks'
    };
    
    const fieldName = fieldMap[element.className.split(' ')[0]];
    if (fieldName) {
        persona[fieldName] = element.value;
        persona.updatedAt = Date.now();
        board.updatedAt = Date.now();
        savePersonaBoards(boards);
    }
}
function setupPersonaEventListeners() {
    // Auto-save on input changes for all persona inputs
    const inputs = document.querySelectorAll('#personasMount input, #personasMount textarea');
    inputs.forEach(input => {
        input.addEventListener('input', debounce(() => savePersonaFromElement(input), 500));
    });
    
    // Photo upload for all personas
    const photoUploads = document.querySelectorAll('.persona-photo-upload');
    photoUploads.forEach(photoUpload => {
        const personaId = photoUpload.dataset.personaId;
        const photoInput = document.querySelector(`.persona-image-input[data-persona-id="${personaId}"]`);
        
        if (photoInput) {
            photoUpload.addEventListener('click', () => photoInput.click());
            photoInput.addEventListener('change', (e) => handlePhotoUpload(e, personaId));
        }
    });
    
    // Remove photo for all personas
    const removePhotos = document.querySelectorAll('.persona-remove-photo');
    removePhotos.forEach(removePhoto => {
        const personaId = removePhoto.dataset.personaId;
        removePhoto.addEventListener('click', () => removePersonaPhoto(personaId));
    });
    
    // Menu dropdown for all personas
    const menuBtns = document.querySelectorAll('.persona-menu-btn');
    menuBtns.forEach(menuBtn => {
        const personaId = menuBtn.dataset.personaId;
        const menuDropdown = document.querySelector(`.persona-menu-dropdown[data-persona-id="${personaId}"]`);
        
        if (menuDropdown) {
            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                menuDropdown.classList.toggle('show');
            });
            
            // Close dropdown when clicking outside
            document.addEventListener('click', () => {
                menuDropdown.classList.remove('show');
            });
        }
    });
    
    // Delete action for all personas
    const deleteBtns = document.querySelectorAll('.persona-menu-item.delete');
    deleteBtns.forEach(deleteBtn => {
        deleteBtn.addEventListener('click', () => {
            const personaId = deleteBtn.dataset.personaId;
            if (personaId) {
                deletePersona(personaId);
            }
        });
    });

    // Export actions for all personas
    const exportPngBtns = document.querySelectorAll('.persona-menu-item[data-action="export-png"]');
    exportPngBtns.forEach(exportBtn => {
        exportBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const personaId = exportBtn.dataset.personaId;
            if (personaId) {
                // Close the dropdown first
                const menuDropdown = document.querySelector(`.persona-menu-dropdown[data-persona-id="${personaId}"]`);
                if (menuDropdown) {
                    menuDropdown.classList.remove('show');
                }
                // Then export
                exportPersonaAsPNG(personaId);
            }
        });
    });


    // Clear focus when clicking outside persona cards
    const containers = document.querySelectorAll('.personas-container');
    containers.forEach(container => {
        container.addEventListener('click', (e) => {
            const insideCard = e.target && e.target.closest && e.target.closest('.persona-card');
            if (!insideCard) {
                setSelectedPersonaId(null);
                updatePersonaActiveStates();
            }
        });
    });

    // Allow Escape key to clear persona focus
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // Close any open dropdowns
            const openMenus = document.querySelectorAll('.persona-menu-dropdown.show');
            openMenus.forEach(menu => menu.classList.remove('show'));
        }
    });
}

function setupPersonaBoardEventListeners() {
    // Board title editing for all boards
    const boardTitles = document.querySelectorAll('.persona-board-title');
    boardTitles.forEach(boardTitle => {
        boardTitle.addEventListener('blur', (e) => {
            const newName = e.target.textContent.trim();
            if (newName && newName !== e.target.dataset.originalName) {
                const boardId = e.target.dataset.boardId;
                const boards = loadPersonaBoards();
                const board = boards.find(b => b.id === boardId);
                if (board) {
                    board.name = newName;
                    board.updatedAt = Date.now();
                    savePersonaBoards(boards);
                }
            }
        });
        
        boardTitle.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.target.blur();
            }
        });
        
        // Store original name for comparison
        boardTitle.dataset.originalName = boardTitle.textContent;
    });
    
    // Add persona button for all boards
    const addPersonaBtns = document.querySelectorAll('.add-persona-btn');
    addPersonaBtns.forEach(addPersonaBtn => {
        addPersonaBtn.addEventListener('click', () => {
            const boardId = addPersonaBtn.dataset.boardId;
            const boards = loadPersonaBoards();
            const board = boards.find(b => b.id === boardId);
            if (board) {
                const newPersona = createDefaultPersona();
                board.personas.push(newPersona);
                board.updatedAt = Date.now();
                savePersonaBoards(boards);
                renderPersonasList();
            }
        });
    });
    
    // Board menu for all boards
    const boardMenuBtns = document.querySelectorAll('.persona-board-menu-btn');
    boardMenuBtns.forEach(boardMenuBtn => {
        const boardId = boardMenuBtn.dataset.boardId;
        const boardMenu = document.querySelector(`.persona-board-menu[data-board-id="${boardId}"]`);
        
        if (boardMenu) {
            boardMenuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                boardMenu.classList.toggle('show');
            });
            
            // Close dropdown when clicking outside
            document.addEventListener('click', () => {
                boardMenu.classList.remove('show');
            });
            
            // Menu actions
            boardMenu.addEventListener('click', (e) => {
                const action = e.target.dataset.action;
                const targetBoardId = e.target.dataset.boardId;
                const boards = loadPersonaBoards();
                const board = boards.find(b => b.id === targetBoardId);
                
                if (!board) return;
                
                switch (action) {
                    case 'rename':
                        const boardTitle = document.querySelector(`.persona-board-title[data-board-id="${targetBoardId}"]`);
                        if (boardTitle) {
                            boardTitle.focus();
                            document.execCommand('selectAll', false, null);
                        }
                        break;
                    
                    case 'duplicate':
                        const duplicatedBoard = {
                            ...board,
                            id: `board-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                            name: `${board.name} (Copy)`,
                            createdAt: Date.now(),
                            updatedAt: Date.now(),
                            personas: board.personas.map(p => ({
                                ...p,
                                id: `persona-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
                            }))
                        };
                        
                        boards.push(duplicatedBoard);
                        savePersonaBoards(boards);
                        setSelectedPersonaBoardId(duplicatedBoard.id);
                        renderPersonasList();
                        break;
                        
                    case 'delete':
                        if (confirm(`Are you sure you want to delete "${board.name}"? This action cannot be undone.`)) {
                            deletePersonaBoard(board.id);
                            renderPersonasList();
                        }
                        break;
                }
                
                boardMenu.classList.remove('show');
            });
        }
    });
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
// Toast notification system
function showToast(message, type = 'info', duration = 3000) {
    // Remove existing toasts
    const existingToasts = document.querySelectorAll('.toast-notification');
    existingToasts.forEach(toast => toast.remove());
    
    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    toast.innerHTML = `
        <div class="toast-content">
            <span class="toast-icon">${getToastIcon(type)}</span>
            <span class="toast-message">${message}</span>
            <button class="toast-close" onclick="this.parentElement.parentElement.remove()">×</button>
        </div>
    `;
    
    // Add styles if not already present
    if (!document.getElementById('toast-styles')) {
        const style = document.createElement('style');
        style.id = 'toast-styles';
        style.textContent = `
            .toast-notification {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                min-width: 300px;
                max-width: 500px;
                padding: 16px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                transform: translateX(100%);
                transition: transform 0.3s ease;
                font-family: 'Sarabun', sans-serif;
            }
            .toast-notification.show {
                transform: translateX(0);
            }
            .toast-success {
                background: #000000;
                color: white;
                border-left: 4px solid #333;
            }
            .toast-warning {
                background: #ff9800;
                color: white;
                border-left: 4px solid #f57c00;
            }
            .toast-error {
                background: #f44336;
                color: white;
                border-left: 4px solid #d32f2f;
            }
            .toast-info {
                background: #2196f3;
                color: white;
                border-left: 4px solid #1976d2;
            }
            .toast-content {
                display: flex;
                align-items: center;
                gap: 12px;
            }
            .toast-icon {
                font-size: 18px;
                flex-shrink: 0;
            }
            .toast-message {
                flex: 1;
                font-size: 14px;
                font-weight: 500;
            }
            .toast-close {
                background: none;
                border: none;
                color: inherit;
                font-size: 18px;
                cursor: pointer;
                padding: 0;
                width: 20px;
                height: 20px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                transition: background-color 0.2s ease;
            }
            .toast-close:hover {
                background: rgba(255, 255, 255, 0.2);
            }
        `;
        document.head.appendChild(style);
    }
    
    document.body.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 100);
    
    // Auto remove
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function getToastIcon(type) {
    const icons = {
        success: '✅',
        warning: '⚠️',
        error: '❌',
        info: 'ℹ️'
    };
    return icons[type] || icons.info;
}

function saveCurrentPersona() {
    try {
    const personas = loadPersonas();
    if (personas.length === 0) return;
    
    const primaryPersona = personas[0];
    const updatedPersona = {
        ...primaryPersona,
            name: document.getElementById('personaName')?.value?.trim() || '',
            role: document.getElementById('personaRole')?.value?.trim() || '',
            age: document.getElementById('personaAge')?.value?.trim() || '',
            location: document.getElementById('personaLocation')?.value?.trim() || '',
            quote1: document.getElementById('personaQuote1')?.value?.trim() || '',
            quote2: document.getElementById('personaQuote2')?.value?.trim() || '',
            about: document.getElementById('personaAbout')?.value?.trim() || '',
            behaviors: document.getElementById('personaBehaviors')?.value?.trim() || '',
            frustrations: document.getElementById('personaFrustrations')?.value?.trim() || '',
            goals: document.getElementById('personaGoals')?.value?.trim() || '',
            tasks: document.getElementById('personaTasks')?.value?.trim() || ''
        };
        
        // Validate required fields
        if (!updatedPersona.name) {
            showToast('Persona name is required', 'warning');
            return false;
        }
    
    personas[0] = updatedPersona;
        const success = savePersonas(personas);
        
        if (success) {
            showToast('Persona saved successfully', 'success');
        } else {
            showToast('Failed to save persona', 'error');
        }
        
        return success;
    } catch (error) {
        console.error('Error saving persona:', error);
        showToast('Error saving persona', 'error');
        return false;
    }
}

function handlePhotoUpload(event, personaId) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Validate file type
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
        showToast('Please select a valid image file (JPEG, PNG, GIF, or WebP).', 'error');
        event.target.value = ''; // Clear the input
        return;
    }
    
    // Validate file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
        showToast('Image file size must be less than 5MB.', 'error');
        event.target.value = ''; // Clear the input
        return;
    }
    
    // Show loading state
    const photoUpload = document.querySelector(`.persona-photo-upload[data-persona-id="${personaId}"]`);
    if (photoUpload) {
        photoUpload.textContent = 'Uploading...';
        photoUpload.style.opacity = '0.6';
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const photoImg = document.querySelector(`.persona-photo-img[data-persona-id="${personaId}"]`);
            const removePhoto = document.querySelector(`.persona-remove-photo[data-persona-id="${personaId}"]`);
            
            if (photoImg && photoUpload && removePhoto) {
                photoImg.src = e.target.result;
                photoImg.style.display = 'block';
                photoUpload.style.display = 'none';
                photoUpload.style.opacity = '1'; // Reset opacity
                removePhoto.style.display = 'block';
                
                // Save the image data
                const boards = loadPersonaBoards();
                const board = boards.find(b => b.personas.some(p => p.id === personaId));
                if (board) {
                    const persona = board.personas.find(p => p.id === personaId);
                    if (persona) {
                        persona.image = e.target.result;
                        persona.updatedAt = Date.now();
                        board.updatedAt = Date.now();
                        savePersonaBoards(boards);
                        showToast('Photo uploaded successfully', 'success');
                    }
                }
            }
        } catch (error) {
            console.error('Error handling photo upload:', error);
            showToast('Error uploading photo', 'error');
            // Reset upload state
            if (photoUpload) {
                photoUpload.textContent = '📷 Add Photo';
                photoUpload.style.opacity = '1';
            }
        }
    };
    
    reader.onerror = function() {
        showToast('Error reading image file', 'error');
        // Reset upload state
        if (photoUpload) {
            photoUpload.textContent = '📷 Add Photo';
            photoUpload.style.opacity = '1';
        }
    };
    
    reader.readAsDataURL(file);
}

function removePersonaPhoto(personaId) {
    try {
        const photoImg = document.querySelector(`.persona-photo-img[data-persona-id="${personaId}"]`);
        const photoUpload = document.querySelector(`.persona-photo-upload[data-persona-id="${personaId}"]`);
        const removePhoto = document.querySelector(`.persona-remove-photo[data-persona-id="${personaId}"]`);
        
        if (photoImg && photoUpload && removePhoto) {
            photoImg.src = '';
            photoImg.style.display = 'none';
            photoUpload.style.display = 'flex';
            photoUpload.textContent = '📷 Add Photo'; // Reset text
            removePhoto.style.display = 'none';
            
            // Remove image data
            const boards = loadPersonaBoards();
            const board = boards.find(b => b.personas.some(p => p.id === personaId));
            if (board) {
                const persona = board.personas.find(p => p.id === personaId);
                if (persona) {
                    persona.image = '';
                    persona.updatedAt = Date.now();
                    board.updatedAt = Date.now();
                    savePersonaBoards(boards);
                    showToast('Photo removed successfully', 'success');
                }
            }
        }
    } catch (error) {
        console.error('Error removing photo:', error);
        showToast('Error removing photo', 'error');
    }
}

function setupPersonaNavbar() {
    // Setup persona-specific navbar functionality with a small delay to ensure DOM is ready
    setTimeout(() => {
        const addPersonaBoardBtn = document.getElementById('addPersonaBoardBtn');
        const saveVersionBtn = document.getElementById('saveVersionBtn');
        const historyBtn = document.getElementById('historyBtn');
        const exportBtn = document.getElementById('personaExportBtn');
        const exportMenu = document.getElementById('personaExportMenu');
        const exportDropdown = document.querySelector('.export-dropdown[data-context="persona"]');
        
        console.log('Setting up persona navbar:', { addPersonaBoardBtn, saveVersionBtn, historyBtn, exportBtn, exportMenu, exportDropdown });
        
        // Add persona board functionality
        if (addPersonaBoardBtn) {
            addPersonaBoardBtn.addEventListener('click', () => {
                const newBoard = createNewPersonaBoard();
                renderPersonasList();
                showPersonaToast(`Created new persona board: ${newBoard.name}`);
            });
        }
        
        // Save version functionality for personas
        if (saveVersionBtn) {
            saveVersionBtn.addEventListener('click', () => {
                savePersonaVersion();
            });
        }
        
        // History functionality for personas
        if (historyBtn) {
            historyBtn.addEventListener('click', () => {
                openPersonaHistory();
            });
        }
        
        // Export functionality for personas - now handled by global handler
        if (exportBtn && exportMenu && exportDropdown) {
            console.log('Persona export elements found - handled by global handler:', { exportBtn, exportMenu, exportDropdown });
        } else {
            console.warn('Persona export elements not found:', { exportBtn, exportMenu, exportDropdown });
        }
    }, 100); // Small delay to ensure DOM is ready
}

function savePersonaVersion() {
    try {
        // Get all persona boards data (not just first board)
        const allBoards = loadPersonaBoards();
        const allPersonasData = [];
        
        // Collect all personas from all boards
        allBoards.forEach(board => {
            if (board.personas && Array.isArray(board.personas)) {
                board.personas.forEach(persona => {
                    allPersonasData.push({
                        id: persona.id,
                        name: persona.name || '',
                        role: persona.role || '',
                        age: persona.age || '',
                        location: persona.location || '',
                        quote1: persona.quote1 || '',
                        quote2: persona.quote2 || '',
                        about: persona.about || '',
                        behaviors: persona.behaviors || '',
                        frustrations: persona.frustrations || '',
                        goals: persona.goals || '',
                        tasks: persona.tasks || '',
                        image: persona.image || '',
                        boardId: board.id,
                        boardName: board.name || 'Persona Board'
                    });
                });
            }
        });
        
        // Create version object with all persona boards
        const version = {
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            type: 'persona',
            data: allPersonasData,
            name: `Persona Version ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
            boardCount: allBoards.length,
            personaCount: allPersonasData.length
        };
        
        // Save to versions
        const versions = loadVersions();
        versions.unshift(version); // Add to beginning
        saveVersions(versions);
        
        // Show success message with counts
        const message = `Persona version saved successfully! (${allBoards.length} boards, ${allPersonasData.length} personas)`;
        showPersonaSuccessToast(message);
        
        console.log('Persona version saved:', version);
    } catch (error) {
        console.error('Error saving persona version:', error);
        alert('Error saving persona version. Please try again.');
    }
}

function openPersonaHistory() {
    try {
        const versions = loadVersions();
        const personaVersions = versions.filter(v => v.type === 'persona');
        
        if (personaVersions.length === 0) {
            alert('No saved persona versions found.');
            return;
        }
        
        // Create and show history modal
        showPersonaHistoryModal(personaVersions);
    } catch (error) {
        console.error('Error opening persona history:', error);
        alert('Error loading persona history. Please try again.');
    }
}

function exportPersonaData(format) {
    try {
        const personasData = getAllPersonasData();
        
        switch (format) {
            case 'csv':
                exportPersonasAsCSV(personasData);
                break;
            case 'png':
                // Export each persona board as PNG in a ZIP from main nav
                exportPersonasAsPNGZip();
                break;
            case 'pdf':
                exportPersonasAsPDF();
                break;
            case 'jpeg':
                exportPersonasAsJPEGZip();
                break;
            default:
                console.warn('Unknown export format:', format);
        }
    } catch (error) {
        console.error('Error exporting persona data:', error);
        alert('Error exporting persona data. Please try again.');
    }
}

function getAllPersonasData() {
    try {
        // Use the consistent data loading method
        const boards = loadPersonaBoards();
        const rows = [];
        boards.forEach((board, boardIndex) => {
            const personas = board.personas || [];
            personas.forEach((persona, personaIndex) => {
                rows.push({
                    boardId: board.id,
                    boardName: board.name || `Persona Board ${boardIndex + 1}`,
                    personaIndex: personaIndex,
                    id: persona.id,
                    name: persona.name || '',
                    role: persona.role || '',
                    age: persona.age || '',
                    location: persona.location || '',
                    quote1: persona.quote1 || '',
                    quote2: persona.quote2 || '',
                    about: persona.about || '',
                    behaviors: persona.behaviors || '',
                    frustrations: persona.frustrations || '',
                    goals: persona.goals || '',
                    tasks: persona.tasks || '',
                    image: persona.image || ''
                });
            });
        });
        return rows;
    } catch (error) {
        console.error('Error getting all personas data:', error);
        return [];
    }
}

function exportPersonasAsCSV(personasData) {
    try {
    if (personasData.length === 0) {
            showToast('No persona data to export.', 'warning');
        return;
    }
    
    // Create CSV headers
    const headers = ['Board', 'Board ID', 'Persona ID', 'Name', 'Role', 'Age', 'Location', 'Quote 1', 'Quote 2', 'About', 'Behaviors', 'Frustrations', 'Goals', 'Tasks', 'Image'];
    
    // Create CSV rows
    const rows = personasData.map(persona => [
        persona.boardName || '',
        persona.boardId || '',
        persona.id || '',
        persona.name,
        persona.role,
        persona.age,
        persona.location,
        persona.quote1,
        persona.quote2,
        persona.about,
        persona.behaviors,
        persona.frustrations,
        persona.goals,
        persona.tasks,
        // Store image data URL directly; spreadsheets will truncate, but kept for completeness
        persona.image || ''
    ]);
    
    // Combine headers and rows
    const csvContent = [headers, ...rows]
        .map(row => row.map(field => `"${(field || '').toString().replace(/"/g, '""')}"`).join(','))
        .join('\n');
    
    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `personas-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
        showToast('Personas exported as CSV successfully!', 'success');
    } catch (error) {
        console.error('Error exporting personas to CSV:', error);
        showToast('Error exporting personas to CSV', 'error');
    }
}

// Helper to find the personas container regardless of empty or list state
function getPersonasExportRoot() {
    // Empty state uses a single container with this id
    const byId = document.getElementById('personasContainer');
    if (byId) return byId;
    // Normal state wraps multiple .personas-container items in this list container
    const list = document.querySelector('#personasMount .personas-list-container');
    if (list) return list;
    // Fallbacks
    const anyContainer = document.querySelector('#personasMount .personas-container');
    if (anyContainer) return anyContainer.closest('#personasMount') || anyContainer;
    return null;
}

function withPersonaExportMode(root, enable) {
    if (!root) return () => {};
    const targets = root.classList && root.classList.contains('personas-container')
        ? [root]
        : Array.from(root.querySelectorAll('.personas-container'));
    if (enable) {
        targets.forEach(el => el.classList.add('export-mode'));
        return () => targets.forEach(el => el.classList.remove('export-mode'));
    }
    return () => {};
}

function exportPersonasAsPNG() {
    try {
        const personasContainer = getPersonasExportRoot();
        if (!personasContainer) {
            alert('No persona content to export.');
            return;
        }
        
        // Add export-specific class for styling (apply to all persona cards)
        const removeExportMode = withPersonaExportMode(personasContainer, true);
        
        // Use html2canvas to capture the persona content
        if (typeof html2canvas !== 'undefined') {
            html2canvas(personasContainer, {
                backgroundColor: '#ffffff',
                scale: 2,
                useCORS: true,
                allowTaint: true,
                logging: false,
                width: personasContainer.scrollWidth,
                height: personasContainer.scrollHeight,
                onclone: async function(clonedDoc) {
                    // Process all persona images with square cropping
                    const images = clonedDoc.querySelectorAll('.persona-photo-img, .persona-photo img');
                    for (const img of images) {
                        if (img.src && img.src !== '') {
                            try {
                                // Crop the image to square aspect ratio
                                const croppedImageSrc = await cropImageToSquare(img.src, 160);
                                img.src = croppedImageSrc;
                                
                                // Set explicit dimensions for the image
                                img.style.width = '160px';
                                img.style.height = '160px';
                                img.style.objectFit = 'fill';
                                img.style.borderRadius = '12px';
                                img.style.display = 'block';
                                
                                // Ensure the parent container maintains square aspect ratio
                                const photoContainer = img.closest('.persona-photo');
                                if (photoContainer) {
                                    photoContainer.style.width = '160px';
                                    photoContainer.style.height = '160px';
                                    photoContainer.style.overflow = 'hidden';
                                    photoContainer.style.position = 'relative';
                                    photoContainer.style.display = 'block';
                                }
                            } catch (error) {
                                console.warn('Failed to crop image:', error);
                                // Fallback to original styling
                                img.style.objectFit = 'cover';
                                img.style.objectPosition = 'center';
                                img.style.width = '100%';
                                img.style.height = '100%';
                            }
                        }
                    }
                }
            }).then(canvas => {
                // Convert canvas to blob and download
                canvas.toBlob(blob => {
                    const link = document.createElement('a');
                    const url = URL.createObjectURL(blob);
                    link.setAttribute('href', url);
                    link.setAttribute('download', `personas-${new Date().toISOString().split('T')[0]}.png`);
                    link.style.visibility = 'hidden';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    
                    showPersonaSuccessToast('Personas exported as PNG successfully!');
                    
                    // Remove export-specific class
                    removeExportMode();
                }, 'image/png');
            }).catch(error => {
                console.error('Error generating PNG:', error);
                alert('Error generating PNG. Please try again.');
                
                // Remove export-specific class on error
                removeExportMode();
            });
        } else {
            alert('PNG export not available. Please ensure html2canvas library is loaded.');
        }
    } catch (error) {
        console.error('Error exporting as PNG:', error);
        alert('Error exporting as PNG. Please try again.');
    }
}

function exportPersonasAsPDF() {
    try {
        const personasContainer = getPersonasExportRoot();
        if (!personasContainer) {
            alert('No persona content to export.');
            return;
        }
        
        // Use html2canvas + jsPDF to create PDF (UMD exposes window.jspdf.jsPDF)
        if (typeof html2canvas !== 'undefined' && typeof window.jspdf !== 'undefined') {
            html2canvas(personasContainer, {
                backgroundColor: '#ffffff',
                scale: 2,
                useCORS: true,
                allowTaint: true
            }).then(canvas => {
                const imgData = canvas.toDataURL('image/png');
                const { jsPDF } = window.jspdf;
                const pdf = new jsPDF('p', 'mm', 'a4');
                
                const imgWidth = 210; // A4 width in mm
                const pageHeight = 295; // A4 height in mm
                const imgHeight = (canvas.height * imgWidth) / canvas.width;
                let heightLeft = imgHeight;
                
                let position = 0;
                
                pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
                heightLeft -= pageHeight;
                
                while (heightLeft >= 0) {
                    position = heightLeft - imgHeight;
                    pdf.addPage();
                    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
                    heightLeft -= pageHeight;
                }
                
                pdf.save(`personas-${new Date().toISOString().split('T')[0]}.pdf`);
                showPersonaSuccessToast('Personas exported as PDF successfully!');
            }).catch(error => {
                console.error('Error generating PDF:', error);
                alert('Error generating PDF. Please try again.');
            });
        } else {
            alert('PDF export not available. Please ensure html2canvas and jsPDF libraries are loaded.');
        }
    } catch (error) {
        console.error('Error exporting as PDF:', error);
        alert('Error exporting as PDF. Please try again.');
    }
}

// Export personas view as JPEG
function exportPersonasAsJPEG() {
    try {
        const personasContainer = getPersonasExportRoot();
        if (!personasContainer) {
            alert('No persona content to export.');
            return;
        }

        const removeExportMode = withPersonaExportMode(personasContainer, true);

        if (typeof html2canvas !== 'undefined') {
            html2canvas(personasContainer, {
                backgroundColor: '#ffffff',
                scale: 2,
                useCORS: true,
                allowTaint: true,
                logging: false,
                width: personasContainer.scrollWidth,
                height: personasContainer.scrollHeight
            }).then(canvas => {
                canvas.toBlob(blob => {
                    const link = document.createElement('a');
                    const url = URL.createObjectURL(blob);
                    link.setAttribute('href', url);
                    link.setAttribute('download', `personas-${new Date().toISOString().split('T')[0]}.jpg`);
                    link.style.visibility = 'hidden';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    showPersonaSuccessToast('Personas exported as JPEG successfully!');
                    removeExportMode();
                }, 'image/jpeg', 0.92);
            }).catch(error => {
                console.error('Error generating JPEG:', error);
                alert('Error generating JPEG. Please try again.');
                removeExportMode();
            });
        } else {
            alert('JPEG export not available. Please ensure html2canvas library is loaded.');
        }
    } catch (error) {
        console.error('Error exporting as JPEG:', error);
        alert('Error exporting as JPEG. Please try again.');
    }
}

// Export each persona board as an image inside a ZIP
async function exportPersonasAsZIP(imageType = 'png') {
    try {
        if (typeof window.html2canvas === 'undefined') {
            alert('Export not available. html2canvas is not loaded.');
            return;
        }
        if (typeof window.JSZip === 'undefined') {
            alert('ZIP export not available. JSZip is not loaded.');
            return;
        }

        const boards = (loadPersonaBoards && loadPersonaBoards()) || [];
        const boardsWithPersonas = boards.filter(b => (b.personas || []).length > 0);
        if (boardsWithPersonas.length === 0) {
            alert('No persona boards to export.');
            return;
        }

        const zip = new window.JSZip();
        const date = new Date().toISOString().split('T')[0];
        const safe = (s) => (String(s || '')).replace(/[^a-zA-Z0-9\s_-]/g, '').trim().replace(/\s+/g, '_') || 'persona';

        for (let i = 0; i < boardsWithPersonas.length; i++) {
            const board = boardsWithPersonas[i];
            const boardEl = document.querySelector(`.personas-container[data-board-id="${board.id}"]`);
            if (!boardEl) continue;

            // Apply export-mode styles for better rendering
            boardEl.classList.add('export-mode');

            // Ensure layout is measured correctly
            await new Promise(r => setTimeout(r, 50));

            const canvas = await window.html2canvas(boardEl, {
                backgroundColor: '#ffffff',
                scale: 2,
                useCORS: true,
                allowTaint: true,
                logging: false,
                width: boardEl.scrollWidth,
                height: boardEl.scrollHeight
            });

            // Convert canvas to blob and add to zip
            const blob = await new Promise(resolve =>
                canvas.toBlob(resolve, imageType === 'jpeg' ? 'image/jpeg' : 'image/png', imageType === 'jpeg' ? 0.92 : 1.0)
            );
            const filename = `${String(i + 1).padStart(2, '0')}-${safe(board.name)}.${imageType === 'jpeg' ? 'jpg' : 'png'}`;
            zip.file(filename, blob);

            boardEl.classList.remove('export-mode');
        }

        const blob = await zip.generateAsync({ type: 'blob' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `personas-boards-${date}-${imageType}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showPersonaSuccessToast(`Exported ${boardsWithPersonas.length} boards as ${imageType.toUpperCase()} in a ZIP.`);
    } catch (error) {
        console.error('Error exporting personas as ZIP:', error);
        alert('Error exporting personas. Please try again.');
    }
}

function exportPersonasAsPNGZip() {
    return exportPersonasAsZIP('png');
}

function exportPersonasAsJPEGZip() {
    return exportPersonasAsZIP('jpeg');
}
function showPersonaHistoryModal(versions) {
    // Create modal HTML
    const modalHTML = `
        <div class="modal show" id="personaHistoryModal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Persona History & Versions</h3>
                    <button class="close-btn" id="closePersonaHistoryModal">&times;</button>
                </div>
                <div class="modal-body">
                    <div id="personaVersionsList" style="display: flex; flex-direction: column; gap: 0.5rem;"></div>
                </div>
                <div class="modal-footer">
                    <div class="form-actions">
                        <button type="button" class="btn btn-secondary" id="closePersonaHistory">Close</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Add modal to DOM
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    const modal = document.getElementById('personaHistoryModal');
    const versionsList = document.getElementById('personaVersionsList');
    
    // Populate versions list
    versions.forEach(version => {
        const versionItem = document.createElement('div');
        versionItem.className = 'version-item';
        versionItem.style.cssText = `
            padding: 1rem;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            background: #f9f9f9;
            cursor: pointer;
            transition: all 0.2s ease;
        `;
        
        const boardCount = version.boardCount || 1;
        const personaCount = version.personaCount || (version.data ? version.data.length : 0);
        
        versionItem.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h4 style="margin: 0 0 0.5rem 0; color: #333;">${version.name}</h4>
                    <p style="margin: 0; color: #666; font-size: 0.9rem;">${new Date(version.timestamp).toLocaleString()}</p>
                    <p style="margin: 0.25rem 0 0 0; color: #888; font-size: 0.8rem;">${boardCount} board${boardCount !== 1 ? 's' : ''}, ${personaCount} persona${personaCount !== 1 ? 's' : ''}</p>
                </div>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.8rem;" onclick="loadPersonaVersion('${version.id}')">Load</button>
                    <button class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; color: #d32f2f;" onclick="deletePersonaVersion('${version.id}')">Delete</button>
                </div>
            </div>
        `;
        
        versionItem.addEventListener('mouseenter', () => {
            versionItem.style.background = '#f0f8ff';
            versionItem.style.borderColor = '#2196f3';
        });
        
        versionItem.addEventListener('mouseleave', () => {
            versionItem.style.background = '#f9f9f9';
            versionItem.style.borderColor = '#e0e0e0';
        });
        
        versionsList.appendChild(versionItem);
    });
    
    // Close modal handlers
    const closeBtn = document.getElementById('closePersonaHistoryModal');
    const closeBtn2 = document.getElementById('closePersonaHistory');
    
    const closeModal = () => {
        modal.remove();
    };
    
    closeBtn.addEventListener('click', closeModal);
    closeBtn2.addEventListener('click', closeModal);
    
    // Close on backdrop click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });
}

window.loadPersonaVersion = function(versionId) {
    try {
        const versions = loadVersions();
        const version = versions.find(v => v.id === versionId && v.type === 'persona');
        if (!version) { alert('Version not found.'); return; }

        const personasArray = Array.isArray(version.data) ? version.data : [];
        if (personasArray.length === 0) { alert('This version has no persona data.'); return; }

        // Group personas by board (if boardId exists) or create a single board
        const boardGroups = {};
        const normalizedPersonas = personasArray
            .filter(p => p && typeof p === 'object')
            .map(p => ({
                ...createDefaultPersona(),
                ...p,
                // Prefer image field; some older versions may use photo
                image: (p.image && String(p.image).trim() !== '') ? p.image : (p.photo || ''),
                id: p.id || createDefaultPersona().id
            }))
            .filter(p => {
                const fields = [
                    p.name, p.role, p.age, p.location,
                    p.quote1, p.quote2, p.about,
                    p.behaviors, p.frustrations, p.goals, p.tasks,
                    p.image
                ];
                return fields.some(v => v && String(v).trim() !== '');
            });

        // Group by board if boardId exists, otherwise put all in one board
        if (normalizedPersonas.some(p => p.boardId)) {
            normalizedPersonas.forEach(persona => {
                const boardId = persona.boardId || 'default';
                if (!boardGroups[boardId]) {
                    boardGroups[boardId] = {
                        id: boardId,
                        name: persona.boardName || 'Persona Board',
                        personas: []
                    };
                }
                // Remove board metadata from persona
                const { boardId: _, boardName: __, ...cleanPersona } = persona;
                boardGroups[boardId].personas.push(cleanPersona);
            });
        } else {
            // Legacy format - all personas in one board
            const defaultBoard = createDefaultPersonaBoard();
            defaultBoard.personas = normalizedPersonas;
            boardGroups['default'] = defaultBoard;
        }

        // Convert to array and save all boards
        const restoredBoards = Object.values(boardGroups);
        savePersonaBoards(restoredBoards);

        // Set first board and persona as selected
        if (restoredBoards.length > 0) {
            setSelectedPersonaBoardId(restoredBoards[0].id);
            if (restoredBoards[0].personas.length > 0) {
                setSelectedPersonaId(restoredBoards[0].personas[0].id);
            }
        }

        // Re-render UI using current renderer
        renderPersonasInterface();
        updatePersonaActiveStates();

        const modal = document.getElementById('personaHistoryModal');
        if (modal) modal.remove();

        const message = `Persona version loaded! (${restoredBoards.length} boards, ${normalizedPersonas.length} personas)`;
        showPersonaSuccessToast(message);
    } catch (error) {
        console.error('Error loading persona version:', error);
        alert('Error loading persona version. Please try again.');
    }
}
window.deletePersonaVersion = function(versionId) {
    if (!confirm('Are you sure you want to delete this persona version? This action cannot be undone.')) {
        return;
    }
    
    try {
        const versions = loadVersions();
        const filteredVersions = versions.filter(v => !(v.id === versionId && v.type === 'persona'));
        saveVersions(filteredVersions);
        
        // Refresh the history modal
        const modal = document.getElementById('personaHistoryModal');
        if (modal) {
            modal.remove();
        }
        
        // Reopen with updated list
        openPersonaHistory();
        
        showPersonaSuccessToast('Persona version deleted successfully!');
    } catch (error) {
        console.error('Error deleting persona version:', error);
        alert('Error deleting persona version. Please try again.');
    }
}

function showPersonaSuccessToast(message) {
    // Remove any existing toast
    const existingToast = document.querySelector('.persona-success-toast');
    if (existingToast) {
        existingToast.remove();
    }
    
    // Create new toast
    const toast = document.createElement('div');
    toast.className = 'persona-success-toast success-toast';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #000000;
        color: white;
        padding: 12px 24px;
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        font-weight: 500;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 8px;
        opacity: 0;
        transition: opacity 0.3s ease, transform 0.3s ease;
        pointer-events: none;
        border: 1px solid #333;
    `;
    
    toast.innerHTML = `✓ ${message}`;
    
    document.body.appendChild(toast);
    
    // Show toast
    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    }, 100);
    
    // Hide toast after 3 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 300);
    }, 3000);
}

function showEmptyPersonasState() {
    const root = document.getElementById('personasMount');
    if (!root) return;
    
    // Clear the container
    const container = document.getElementById('personasContainer');
    if (container) {
        container.innerHTML = '';
    }
    
    // Show empty state message
    const emptyStateHTML = `
        <div style="
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 400px;
            text-align: center;
            color: #6b7280;
            padding: 2rem;
        ">
            <div style="
                font-size: 4rem;
                margin-bottom: 1rem;
                opacity: 0.5;
            ">👤</div>
            <h3 style="
                font-size: 1.5rem;
                font-weight: 600;
                margin-bottom: 0.5rem;
                color: #374151;
            ">No Personas</h3>
            <p style="
                font-size: 1rem;
                margin-bottom: 2rem;
                max-width: 400px;
                line-height: 1.5;
            ">You haven't created any personas yet. Click the "Add Persona" button to get started.</p>
            <button id="addFirstPersona" style="
                background: #3b82f6;
                color: white;
                border: none;
                padding: 0.75rem 1.5rem;
                border-radius: 0.5rem;
                font-size: 1rem;
                font-weight: 500;
                cursor: pointer;
                transition: background-color 0.2s;
            " onmouseover="this.style.background='#2563eb'" onmouseout="this.style.background='#3b82f6'" onclick="addFirstPersona()">
                Add Your First Persona
            </button>
        </div>
    `;
    
    if (container) {
        container.innerHTML = emptyStateHTML;
    }
}

// Global function to add the first persona (called from onclick)
window.addFirstPersona = function() {
    createFirstPersona();
};

// Legacy function removed - no longer needed with simplified system

function setupPersonasFeature(createDefaultIfEmpty = true) {
    // Simplified persona setup - use new clean interface
    renderPersonasInterface();
    
    // Setup auto-save functionality
    setupPersonaAutoSave();
}

function setupPersonaAutoSave() {
    // Debounced auto-save for persona form fields
    const debouncedSave = debounce(() => {
        saveCurrentPersona();
    }, 1000); // Save after 1 second of inactivity
    
    // Add event listeners to all persona form fields
    const personaFields = [
        'personaName', 'personaRole', 'personaAge', 'personaLocation',
        'personaQuote1', 'personaQuote2', 'personaAbout', 'personaBehaviors',
        'personaFrustrations', 'personaGoals', 'personaTasks'
    ];
    
    personaFields.forEach(fieldId => {
        const field = document.getElementById(fieldId);
        if (field) {
            field.addEventListener('input', debouncedSave);
            field.addEventListener('blur', () => {
                // Immediate save on blur for better UX
                saveCurrentPersona();
            });
        }
    });
}

function setupPersonaKeyboardNavigation() {
    // Add keyboard navigation support for better accessibility
    const personaContainer = document.getElementById('personasContainer');
    if (!personaContainer) return;
    
    // Handle Enter key on board title
    const boardTitle = document.querySelector('.persona-board-title');
    if (boardTitle) {
        boardTitle.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                boardTitle.blur();
            }
        });
    }
    
    // Handle Escape key to close menus
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // Close any open dropdowns
            const openMenus = document.querySelectorAll('.persona-menu-dropdown.show');
            openMenus.forEach(menu => menu.classList.remove('show'));
        }
    });
    
    // Add focus management for form fields
    const formFields = personaContainer.querySelectorAll('input, textarea');
    formFields.forEach((field, index) => {
        field.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                // Let default tab behavior work
                return;
            }
            
            // Handle Ctrl+S for save
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                saveCurrentPersona();
                showToast('Persona saved', 'success');
            }
        });
    });
}

// Legacy persona code removed - using simplified system

// --- Flow storage ---
function getCurrentFlowType() {
    const activeFlowBtn = document.querySelector('[data-target="as-is-flow"].active, [data-target="to-be-flow"].active');
    if (activeFlowBtn) {
        return activeFlowBtn.getAttribute('data-target') === 'as-is-flow' ? 'as-is' : 'to-be';
    }
    return 'as-is'; // default fallback
}

// --- Flow storage ---
function getCurrentFlowType() {
    const activeFlowBtn = document.querySelector('[data-target="as-is-flow"].active, [data-target="to-be-flow"].active');
    if (activeFlowBtn) {
        return activeFlowBtn.getAttribute('data-target') === 'as-is-flow' ? 'as-is' : 'to-be';
    }
    return 'as-is'; // default fallback
}

function ensureFlowDataStructure(data) {
    return {
        title: typeof data?.title === 'string' ? data.title : 'Flow 1',
        gridSize: data?.gridSize || 20,
        columnWidth: data?.columnWidth || 200,
        gridEnabled: data?.gridEnabled !== undefined ? data.gridEnabled : true
    };
}

function loadFlowData() {
    try {
        const data = localStorage.getItem(getScopedKey(BASE_FLOW_KEY));
        if (!data) return ensureFlowDataStructure(null);
        
        const parsed = JSON.parse(data);
        return ensureFlowDataStructure(parsed);
    } catch (error) {
        console.warn('Error loading flow data:', error);
        return ensureFlowDataStructure(null);
    }
}

function loadFlowBoards(key = BASE_FLOW_KEY) {
    try {
        const raw = localStorage.getItem(getScopedKey(key));
        const parsed = raw ? JSON.parse(raw) : [];
        
        if (Array.isArray(parsed)) {
            return parsed.map(board => ensureFlowDataStructure(board));
        }
        return [];
    } catch { return []; }
}

function saveFlowData(data) {
    try {
        const payload = ensureFlowDataStructure(data);
        localStorage.setItem(getScopedKey(BASE_FLOW_KEY), JSON.stringify(payload));
        updateStorageUsage();
    } catch {}
}

function saveFlowBoards(boards, key = BASE_FLOW_KEY) {
    try {
        const payload = Array.isArray(boards) ? boards : [boards];
        localStorage.setItem(getScopedKey(key), JSON.stringify(payload));
        updateStorageUsage();
    } catch {}
}

function appendExtraPersonaCard(container, persona) {
    const extra = document.createElement('div');
    extra.className = 'persona-card extra';
    extra.setAttribute('data-persona-id', persona.id);
    
    extra.innerHTML = `
        <div class="persona-header">
            <div class="persona-photo">
                <input type="file" class="personaImageInput" accept="image/*" style="display:none;" />
                <div class="persona-photo-upload personaPhotoUpload" title="Click to add a photo">📷 Add Photo</div>
                <img class="personaPhoto" alt="Persona Photo" style="display:none;" />
                <button class="remove-image-btn personaRemovePhoto" style="display:none;">Remove</button>
            </div>
            <div class="persona-identity">
                <input class="persona-name" placeholder="Name" value="${persona.name || ''}" />
                <input class="persona-role" placeholder="Role / Title" value="${persona.role || ''}" />
                <div class="persona-meta">
                    <input class="persona-age" placeholder="Age" value="${persona.age || ''}" />
                    <input class="persona-location" placeholder="Location" value="${persona.location || ''}" />
                </div>
            </div>
            <div class="persona-quotes">
                <textarea class="personaQuote1" placeholder="Primary quote">${persona.quote1 || ''}</textarea>
                <textarea class="personaQuote2" placeholder="Secondary quote (optional)">${persona.quote2 || ''}</textarea>
            </div>
            <div class="persona-menu">
                <button class="persona-menu-btn" title="Persona options">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="12" cy="5" r="2" fill="currentColor"/>
                        <circle cx="12" cy="12" r="2" fill="currentColor"/>
                        <circle cx="12" cy="19" r="2" fill="currentColor"/>
                    </svg>
                </button>
                <div class="persona-menu-dropdown">
                    <button class="persona-menu-item delete" data-action="delete">🗑️ Delete Persona</button>
                </div>
            </div>
        </div>
        <div class="persona-body">
            <section class="persona-section">
                <h4>About</h4>
                <textarea class="personaAbout" rows="4" placeholder="Short bio">${persona.about || ''}</textarea>
            </section>
            <section class="persona-section grid-2">
                <div>
                    <h4>Behavioral Considerations</h4>
                    <textarea class="personaBehaviors" rows="8" placeholder="Bulleted points">${persona.behaviors || ''}</textarea>
                </div>
                <div>
                    <h4>Frustrations</h4>
                    <textarea class="personaFrustrations" rows="8" placeholder="Bulleted points">${persona.frustrations || ''}</textarea>
                </div>
            </section>
            <section class="persona-section grid-2">
                <div>
                    <h4>Goals</h4>
                    <textarea class="personaGoals" rows="8" placeholder="Bulleted points">${persona.goals || ''}</textarea>
                </div>
                <div>
                    <h4>Tasks</h4>
                    <textarea class="personaTasks" rows="8" placeholder="Bulleted points">${persona.tasks || ''}</textarea>
                </div>
            </section>
        </div>
    `;
    container.appendChild(extra);

    const debounce = (fn, wait = 250) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); }; };
    const persist = debounce(() => {
        const id = extra.getAttribute('data-persona-id');
        const current = loadPersonas();
        const idx = current.findIndex(p => p.id === id);
        if (idx === -1) return;
        const photoEl = extra.querySelector('.personaPhoto');
        current[idx] = ensurePersona({
            ...current[idx],
            image: photoEl && photoEl.style.display !== 'none' ? (photoEl.getAttribute('src') || '') : '',
            name: extra.querySelector('.persona-name')?.value || '',
            role: extra.querySelector('.persona-role')?.value || '',
            age: extra.querySelector('.persona-age')?.value || '',
            location: extra.querySelector('.persona-location')?.value || '',
            quote1: extra.querySelector('.personaQuote1')?.value || '',
            quote2: extra.querySelector('.personaQuote2')?.value || '',
            about: extra.querySelector('.personaAbout')?.value || '',
            behaviors: extra.querySelector('.personaBehaviors')?.value || '',
            frustrations: extra.querySelector('.personaFrustrations')?.value || '',
            goals: extra.querySelector('.personaGoals')?.value || '',
            tasks: extra.querySelector('.personaTasks')?.value || ''
        });
        savePersonas(current);
    }, 250);

    extra.querySelectorAll('input, textarea').forEach(el => el.addEventListener('input', persist));

    // Add menu functionality
    const menuBtn = extra.querySelector('.persona-menu-btn');
    const menuDropdown = extra.querySelector('.persona-menu-dropdown');
    const deleteBtn = extra.querySelector('[data-action="delete"]');

    if (menuBtn && menuDropdown) {
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            menuDropdown.classList.toggle('show');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!extra.contains(e.target)) {
                menuDropdown.classList.remove('show');
            }
        });

        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                menuDropdown.classList.remove('show');
                deletePersona(persona.id);
                    });
                }
            }

    const imgInput = extra.querySelector('.personaImageInput');
    const upload = extra.querySelector('.persona-photo-upload');
    const photo = extra.querySelector('.personaPhoto');
    const remove = extra.querySelector('.personaRemovePhoto');
    const validateImage = (file) => ['image/jpeg','image/jpg','image/png','image/gif','image/webp'].includes(file.type) && file.size <= 5 * 1024 * 1024;
    const compressImageFile = (file, { maxWidth = 800, maxHeight = 800, quality = 0.9, format = 'image/jpeg' } = {}) => new Promise((resolve, reject) => {
        try {
            const reader = new FileReader();
            reader.onload = () => { const image = new Image(); image.onload = () => { let tw=image.width, th=image.height; const r=Math.min(1,maxWidth/tw,maxHeight/th); tw=Math.round(tw*r); th=Math.round(th*r); const canvas=document.createElement('canvas'); canvas.width=tw; canvas.height=th; const ctx=canvas.getContext('2d'); ctx.drawImage(image,0,0,tw,th); resolve(canvas.toDataURL(format,quality)); }; image.onerror=()=>reject(new Error('Image load failed')); image.src = reader.result; };
            reader.onerror = () => reject(new Error('Read failed'));
            reader.readAsDataURL(file);
        } catch (e) { reject(e); }
    });
    upload && imgInput && upload.addEventListener('click', () => imgInput.click());
    imgInput && imgInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file || !validateImage(file)) { imgInput.value = ''; return; }
        try {
            const dataUrl = await compressImageFile(file);
            if (photo) { photo.src = dataUrl; photo.style.display = 'block'; }
        if (upload) upload.style.display = 'none';
            if (remove) remove.style.display = 'block';
            persist();
        } catch {}
    });
    remove && remove.addEventListener('click', () => { if (photo) { photo.removeAttribute('src'); photo.style.display = 'none'; } if (upload) upload.style.display = 'block'; if (remove) remove.style.display = 'none'; persist(); });
}

// Legacy function removed - simplified to single persona system

// --- Flow storage ---
function getCurrentFlowType() {
    const activeFlowBtn = document.querySelector('[data-target="as-is-flow"].active, [data-target="to-be-flow"].active');
    if (activeFlowBtn) {
        return activeFlowBtn.getAttribute('data-target') === 'as-is-flow' ? 'as-is' : 'to-be';
    }
    return 'as-is'; // default fallback
}

function ensureFlowDataStructure(data) {
    return {
        title: typeof data?.title === 'string' ? data.title : 'Flow 1',
        gridSize: data?.gridSize || 20,
        columnWidth: data?.columnWidth || 200,
        gridEnabled: data?.gridEnabled !== undefined ? data.gridEnabled : true
    };
        }

function loadFlowData() {
    try {
        const data = localStorage.getItem(getScopedKey(BASE_FLOW_KEY));
        if (!data) return ensureFlowDataStructure(null);
        
        const parsed = JSON.parse(data);
        return ensureFlowDataStructure(parsed);
    } catch (error) {
        console.warn('Error loading flow data:', error);
        return ensureFlowDataStructure(null);
    }
}

function loadFlowBoards(key = BASE_FLOW_KEY) {
    try {
        const raw = localStorage.getItem(getScopedKey(key));
        const parsed = raw ? JSON.parse(raw) : [];
        
        if (Array.isArray(parsed)) {
            return parsed.map(board => ensureFlowDataStructure(board));
        }
        return [];
    } catch { return []; }
}

function saveFlowData(data) {
    try {
        const payload = ensureFlowDataStructure(data);
        localStorage.setItem(getScopedKey(BASE_FLOW_KEY), JSON.stringify(payload));
        updateStorageUsage();
    } catch {}
}

// Removed duplicate function - using the first implementation

// Legacy function removed - simplified to single persona system

// --- Flow storage ---
function getCurrentFlowType() {
    const activeFlowBtn = document.querySelector('[data-target="as-is-flow"].active, [data-target="to-be-flow"].active');
    if (activeFlowBtn) {
        return activeFlowBtn.getAttribute('data-target') === 'as-is-flow' ? 'as-is' : 'to-be';
    }
    return 'as-is'; // default fallback
}

function ensureFlowDataStructure(data) {
    return {
        title: typeof data?.title === 'string' ? data.title : 'Flow 1',
        gridSize: data?.gridSize || 20,
        columnWidth: data?.columnWidth || 200,
        gridEnabled: data?.gridEnabled !== undefined ? data.gridEnabled : true
    };
}

function loadFlowData() {
    try {
        const data = localStorage.getItem(getScopedKey(BASE_FLOW_KEY));
        if (!data) return ensureFlowDataStructure(null);
        
        const parsed = JSON.parse(data);
        return ensureFlowDataStructure(parsed);
    } catch (error) {
        console.warn('Error loading flow data:', error);
        return ensureFlowDataStructure(null);
    }
        }

function loadFlowBoards(key = BASE_FLOW_KEY) {
    try {
        const raw = localStorage.getItem(getScopedKey(key));
        const parsed = raw ? JSON.parse(raw) : [];
        
        if (Array.isArray(parsed)) {
            return parsed.map(board => ensureFlowDataStructure(board));
        }
        return [];
    } catch { return []; }
}

function saveFlowData(data) {
    try {
        const payload = ensureFlowDataStructure(data);
        localStorage.setItem(getScopedKey(BASE_FLOW_KEY), JSON.stringify(payload));
        updateStorageUsage();
    } catch {}
}

// Removed duplicate function - using the first implementation

// Legacy add persona hook removed - simplified to single persona system

// --- Flow storage ---
function getCurrentFlowType() {
    const activeFlowBtn = document.querySelector('[data-target="as-is-flow"].active, [data-target="to-be-flow"].active');
    if (activeFlowBtn) {
        return activeFlowBtn.getAttribute('data-target') === 'as-is-flow' ? 'as-is' : 'to-be';
    }
    return 'as-is'; // default fallback
}

function ensureFlowDataStructure(data) {
    return {
        nodes: Array.isArray(data?.nodes) ? data.nodes : [],
        edges: Array.isArray(data?.edges) ? data.edges : [],
        sections: Array.isArray(data?.sections) ? data.sections : [],
        title: typeof data?.title === 'string' ? data.title : 'Flow 1',
        gridSize: data?.gridSize || 20,
        columnWidth: data?.columnWidth || 200,
        gridEnabled: data?.gridEnabled !== undefined ? data.gridEnabled : true
    };
}

function loadFlowData() {
    try {
        const raw = localStorage.getItem(getScopedKey(BASE_FLOW_KEY));
        const parsed = raw ? JSON.parse(raw) : null;
        const data = ensureFlowDataStructure(parsed);
        
        
        return data;
    } catch (error) {
        console.warn('Error loading flow data:', error);
        return ensureFlowDataStructure(null);
    }
}

function loadFlowBoards() {
    const flowType = getCurrentFlowType();
    const key = flowType === 'as-is' ? 'jmAsIsFlow_boards' : 'jmToBeFlow_boards';
    
    try {
        const raw = localStorage.getItem(getScopedKey(key));
        const parsed = raw ? JSON.parse(raw) : null;
        if (Array.isArray(parsed)) {
            return parsed.map(board => ensureFlowDataStructure(board));
        }
        return [];
    } catch { return []; }
}

function saveFlowData(data) {
    try {
        const payload = ensureFlowDataStructure(data);
        localStorage.setItem(getScopedKey(BASE_FLOW_KEY), JSON.stringify(payload));
        updateStorageUsage();
    } catch {}
}

function saveFlowBoards(boards) {
    const flowType = getCurrentFlowType();
    const key = flowType === 'as-is' ? 'jmAsIsFlow_boards' : 'jmToBeFlow_boards';
    
    try {
        const payload = Array.isArray(boards) ? boards.map(board => ensureFlowDataStructure(board)) : [];
        localStorage.setItem(getScopedKey(key), JSON.stringify(payload));
        updateStorageUsage();
    } catch {}
}
// Make flow data functions globally available
window.loadFlowData = loadFlowData;
window.saveFlowData = saveFlowData;
window.loadFlowBoards = loadFlowBoards;
window.saveFlowBoards = saveFlowBoards;



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
    return { 
        image: '', 
        title: '', 
        description: '', 
        blur: 0, 
        lightOverlay: false 
    };
}

function loadCoverData() {
    try {
        const raw = localStorage.getItem(getScopedKey(BASE_COVER_KEY));
        if (!raw) return getDefaultCoverData();
        const parsed = JSON.parse(raw);
        return {
            image: typeof parsed?.image === 'string' ? parsed.image : '',
            title: typeof parsed?.title === 'string' ? parsed.title : '',
            description: typeof parsed?.description === 'string' ? parsed.description : '',
            blur: typeof parsed?.blur === 'number' ? parsed.blur : 0,
            lightOverlay: typeof parsed?.lightOverlay === 'boolean' ? parsed.lightOverlay : false
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
            description: typeof data?.description === 'string' ? data.description : '',
            blur: typeof data?.blur === 'number' ? data.blur : 0,
            lightOverlay: typeof data?.lightOverlay === 'boolean' ? data.lightOverlay : false
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

    snapToCorridors(points, obstacles) {
        if (!points || points.length < 3) return points;
        const snapDist = 12;
        const out = [points[0]];
        for (let i = 1; i < points.length - 1; i++) {
            const prev = out[out.length - 1];
            const curr = { x: points[i].x, y: points[i].y };
            const next = points[i + 1];
            if (prev.y === curr.y || curr.y === next.y) {
                const targetY = this.findNearest([...this.corridors.ys], curr.y, snapDist);
                if (targetY !== null) {
                    const c1 = { x: prev.x, y: prev.y, x2: curr.x, y2: targetY };
                    const c2 = { x: curr.x, y: targetY, x2: next.x, y2: next.y };
                    if (!this.segmentIntersectsAny({ x1: prev.x, y1: prev.y, x2: curr.x, y2: targetY }, obstacles) &&
                        !this.segmentIntersectsAny({ x1: curr.x, y1: targetY, x2: next.x, y2: next.y }, obstacles)) {
                        curr.y = targetY;
                    }
                }
            }
            if (prev.x === curr.x || curr.x === next.x) {
                const targetX = this.findNearest([...this.corridors.xs], curr.x, snapDist);
                if (targetX !== null) {
                    if (!this.segmentIntersectsAny({ x1: prev.x, y1: prev.y, x2: targetX, y2: curr.y }, obstacles) &&
                        !this.segmentIntersectsAny({ x1: targetX, y1: curr.y, x2: next.x, y2: next.y }, obstacles)) {
                        curr.x = targetX;
                    }
                }
            }
            out.push(curr);
        }
        out.push(points[points.length - 1]);
        return out;
    }

    detourObstacles(points, obstacles, clearance) {
        if (!points || points.length < 2) return points;
        const out = [points[0]];
        for (let i = 1; i < points.length; i++) {
            const a = out[out.length - 1];
            let b = points[i];
            if (a.x === b.x) {
                const hit = this.firstIntersectingObstacle({ x1: a.x, y1: a.y, x2: b.x, y2: b.y }, obstacles);
                if (hit) {
                    const leftX = hit.x - clearance;
                    const rightX = hit.x + hit.width + clearance;
                    const leftOk = !this.segmentIntersectsAny({ x1: a.x, y1: a.y, x2: leftX, y2: a.y }, obstacles) &&
                                   !this.segmentIntersectsAny({ x1: leftX, y1: a.y, x2: leftX, y2: b.y }, obstacles) &&
                                   !this.segmentIntersectsAny({ x1: leftX, y1: b.y, x2: b.x, y2: b.y }, obstacles);
                    const rightOk = !this.segmentIntersectsAny({ x1: a.x, y1: a.y, x2: rightX, y2: a.y }, obstacles) &&
                                    !this.segmentIntersectsAny({ x1: rightX, y1: a.y, x2: rightX, y2: b.y }, obstacles) &&
                                    !this.segmentIntersectsAny({ x1: rightX, y1: b.y, x2: b.x, y2: b.y }, obstacles);
                    if (leftOk || rightOk) {
                        const nx = leftOk && rightOk ? (Math.abs(leftX - a.x) <= Math.abs(rightX - a.x) ? leftX : rightX) : (leftOk ? leftX : rightX);
                        out.push({ x: nx, y: a.y });
                        out.push({ x: nx, y: b.y });
                    }
                }
            } else if (a.y === b.y) {
                const hit = this.firstIntersectingObstacle({ x1: a.x, y1: a.y, x2: b.x, y2: b.y }, obstacles);
                if (hit) {
                    const upY = hit.y - clearance;
                    const downY = hit.y + hit.height + clearance;
                    const upOk = !this.segmentIntersectsAny({ x1: a.x, y1: a.y, x2: a.x, y2: upY }, obstacles) &&
                                 !this.segmentIntersectsAny({ x1: a.x, y1: upY, x2: b.x, y2: upY }, obstacles) &&
                                 !this.segmentIntersectsAny({ x1: b.x, y1: upY, x2: b.x, y2: b.y }, obstacles);
                    const downOk = !this.segmentIntersectsAny({ x1: a.x, y1: a.y, x2: a.x, y2: downY }, obstacles) &&
                                   !this.segmentIntersectsAny({ x1: a.x, y1: downY, x2: b.x, y2: downY }, obstacles) &&
                                   !this.segmentIntersectsAny({ x1: b.x, y1: downY, x2: b.x, y2: b.y }, obstacles);
                    if (upOk || downOk) {
                        const ny = upOk && downOk ? (Math.abs(upY - a.y) <= Math.abs(downY - a.y) ? upY : downY) : (upOk ? upY : downOk ? downY : a.y);
                        out.push({ x: a.x, y: ny });
                        out.push({ x: b.x, y: ny });
                    }
                }
            }
            out.push(b);
        }
        return out;
    }

    findNearest(values, target, maxDist) {
        if (!values || values.length === 0) return null;
        let best = null, bestD = Infinity;
        for (const v of values) {
            const d = Math.abs(v - target);
            if (d < bestD && d <= maxDist) { best = v; bestD = d; }
        }
        return best;
    }

    segmentIntersectsAny(seg, obstacles) {
        for (const ob of obstacles) { if (this.segmentIntersectsRect(seg, ob)) return true; }
        return false;
    }

    firstIntersectingObstacle(seg, obstacles) {
        for (const ob of obstacles) { if (this.segmentIntersectsRect(seg, ob)) return ob; }
        return null;
    }

    segmentIntersectsRect(seg, rect) {
        if (seg.x1 === seg.x2) {
            const x = seg.x1;
            const y1 = Math.min(seg.y1, seg.y2);
            const y2 = Math.max(seg.y1, seg.y2);
            return x >= rect.x && x <= rect.x + rect.width && y2 >= rect.y && y1 <= rect.y + rect.height;
        } else if (seg.y1 === seg.y2) {
            const y = seg.y1;
            const x1 = Math.min(seg.x1, seg.x2);
            const x2 = Math.max(seg.x1, seg.x2);
            return y >= rect.y && y <= rect.y + rect.height && x2 >= rect.x && x1 <= rect.x + rect.width;
        }
        return false;
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
        
        // Create new toast with minimal black/white styling
        const toast = document.createElement('div');
        toast.className = 'success-toast';
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #000000;
            color: white;
            padding: 12px 24px;
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 10000;
            font-weight: 500;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 8px;
            opacity: 0;
            transition: opacity 0.3s ease, transform 0.3s ease;
            pointer-events: none;
            border: 1px solid #333;
        `;
        toast.innerHTML = `✓ ${message}`;
        document.body.appendChild(toast);
        
        // Show toast
        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';
        }, 100);
        
        // Auto-remove after 3 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.remove();
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


        // Export dropdown - look for the correct IDs based on context
        const exportBtn = document.getElementById('exportBtn') || document.getElementById('personaExportBtn') || document.getElementById('flowExportBtn');
        const exportMenu = document.getElementById('exportMenu') || document.getElementById('personaExportMenu') || document.getElementById('flowExportMenu');
        const exportDropdown = document.querySelector('.export-dropdown');

        console.log('Export elements found:', {
            exportBtn: !!exportBtn,
            exportMenu: !!exportMenu,
            exportDropdown: !!exportDropdown
        });

        if (exportBtn && exportDropdown) {
            console.log('Setting up export button event listener');
            exportBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                console.log('Export button clicked, toggling dropdown');
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
                const exportOptions = exportMenu.querySelectorAll('.export-option');
                console.log('Found export options:', exportOptions.length);
                
                exportOptions.forEach((option, index) => {
                    const format = option.getAttribute('data-format');
                    console.log(`Export option ${index}: ${format}`);
                    
                    option.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        console.log('Export option clicked:', format);
                        
                        try {
                            if (format) {
                                this.toast(`Starting ${format.toUpperCase()} export...`);
                                await this.exportData(format);
                            } else {
                                console.warn('No format specified for export option');
                                this.toast('Export format not specified');
                            }
                        } catch (error) {
                            console.error('Export error:', error);
                            this.toast(`Export failed: ${error.message}`);
                        }
                        
                        exportDropdown.classList.remove('active');
                    });
                });
            } else {
                console.warn('Export menu not found');
            }
        } else {
            console.warn('Export button or dropdown not found');
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







    // Verify that all required export libraries are loaded
    verifyExportLibraries() {
        const libraries = {
            'jsPDF': typeof window.jspdf !== 'undefined',
            'html2canvas': typeof window.html2canvas !== 'undefined',
            'JSZip': typeof window.JSZip !== 'undefined'
        };
        
        const missing = Object.entries(libraries)
            .filter(([name, loaded]) => !loaded)
            .map(([name]) => name);
            
        if (missing.length > 0) {
            console.error('Missing export libraries:', missing);
            this.toast(`Missing required libraries: ${missing.join(', ')}. Please refresh the page.`);
            return false;
        }
        
        console.log('All export libraries loaded successfully');
        return true;
    }
    async exportData(format) {
        // Verify libraries before attempting export
        if (!this.verifyExportLibraries()) {
            return;
        }
        
        switch (format) {
            case 'pdf':
                await this.exportToPDF();
                break;
            case 'png':
                await this.exportToPNG();
                break;
            case 'jpeg':
                await this.exportToJPEGAsZIP(); // Use the new ZIP method
                break;
            case 'csv':
                this.exportToCSV();
                break;
            default:
                console.warn('Unknown export format:', format);
                this.toast(`Export format '${format}' not supported`);
        }
    }
    async exportToPNG() {
        try {
            console.log('Starting PNG export...');
            
            // Check if html2canvas is available
            if (typeof window.html2canvas === 'undefined') {
                throw new Error('html2canvas library not loaded. Please refresh the page and try again.');
            }

            const journeyContainer = document.querySelector('.journey-container');
            if (!journeyContainer) {
                throw new Error('Journey map container not found');
            }

            // Show loading message
            this.toast('Generating PNG export...');

            // Capture only the visible viewport area
            const canvas = await window.html2canvas(journeyContainer, {
                backgroundColor: '#ffffff',
                scale: 2, // Higher resolution
                useCORS: true,
                allowTaint: true,
                scrollX: 0,
                scrollY: 0,
                width: journeyContainer.clientWidth,
                height: journeyContainer.clientHeight,
                windowWidth: window.innerWidth,
                windowHeight: window.innerHeight
            });

            // Convert canvas to PNG blob
            return new Promise((resolve, reject) => {
                canvas.toBlob((blob) => {
                    if (!blob) {
                        reject(new Error('Failed to generate PNG blob'));
                        return;
                    }

                    // Create download link
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `journey-map-viewport-${new Date().toISOString().split('T')[0]}.png`;
                    
                    // Trigger download
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);

                    this.toast('PNG export completed! (Viewport only)');
                    resolve();
                }, 'image/png', 0.95);
            });

        } catch (error) {
            console.error('Error exporting to PNG:', error);
            this.toast(`Error exporting to PNG: ${error.message}`);
        }
    }

    async exportToPDF() {
        try {
            console.log('Starting PDF export (viewport only)...');
            
            // Check if jsPDF is available
            if (typeof window.jspdf === 'undefined') {
                throw new Error('jsPDF library not loaded. Please refresh the page and try again.');
            }
            
            // Check if html2canvas is available
            if (typeof window.html2canvas === 'undefined') {
                throw new Error('html2canvas library not loaded. Please refresh the page and try again.');
            }
            
            // Show loading message
            this.toast('Generating PDF export (visible area only)...');
            
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('l', 'mm', 'a4'); // landscape orientation
            
            // Get the journey container that's currently visible
            const journeyContainer = document.querySelector('.journey-container');
            if (!journeyContainer) {
                throw new Error('Journey map container not found');
            }
            
            // Capture only the visible viewport area
            const canvas = await window.html2canvas(journeyContainer, {
                backgroundColor: '#ffffff',
                scale: 2, // Higher resolution
                useCORS: true,
                allowTaint: true,
                scrollX: 0,
                scrollY: 0,
                width: journeyContainer.clientWidth,
                height: journeyContainer.clientHeight,
                windowWidth: window.innerWidth,
                windowHeight: window.innerHeight
            });
            
            console.log('Canvas captured, adding to PDF...');
            console.log('Canvas dimensions:', canvas.width, 'x', canvas.height);
            
            // Convert canvas to image data
            const imgData = canvas.toDataURL('image/png');
            
            // Fit image within page with margins while preserving aspect ratio
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 10; // mm
            let imgWidth = pageWidth - (2 * margin);
            let imgHeight = (canvas.height * imgWidth) / canvas.width;

            // If image is too tall, scale it down to fit
            if (imgHeight > pageHeight - (2 * margin)) {
                imgHeight = pageHeight - (2 * margin);
                imgWidth = (canvas.width * imgHeight) / canvas.height;
            }

            // Center the image on the page
            const x = (pageWidth - imgWidth) / 2;
            const y = (pageHeight - imgHeight) / 2;
            
            // Add the image to the PDF
            doc.addImage(imgData, 'PNG', x, y, imgWidth, imgHeight);
            
            console.log('Saving PDF...');
            // Save the PDF with project title in filename
            const projectTitle = this.state?.title || 'Journey Map';
            const safeTitle = projectTitle.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
            const filename = `${safeTitle}_Journey_Map_Viewport.pdf`;
            doc.save(filename);
            console.log('PDF export completed successfully');
            this.toast('PDF export completed! (Viewport only)');
            
        } catch (error) {
            console.error('Error exporting to PDF:', error);
            this.toast(`Error exporting to PDF: ${error.message}`);
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
        pageTable.style.gridTemplateRows = 'auto auto auto auto auto auto auto auto';
        pageTable.style.minWidth = '2200px'; // Fixed width for 10 columns (200px + 10*200px)
        pageTable.style.width = 'max-content';
        pageTable.style.gap = '0';
        
        // Add main title header
        const mainTitleHeader = document.createElement('div');
        mainTitleHeader.style.gridColumn = '1 / -1';
        mainTitleHeader.style.gridRow = '1';
        mainTitleHeader.style.padding = '1.5rem 1rem';
        mainTitleHeader.style.textAlign = 'center';
        mainTitleHeader.style.fontWeight = 'bold';
        mainTitleHeader.style.fontSize = '1.8rem';
        mainTitleHeader.style.color = '#2c3e50';
        mainTitleHeader.style.borderBottom = '3px solid #3498db';
        mainTitleHeader.style.backgroundColor = '#ecf0f1';
        mainTitleHeader.style.marginBottom = '0.5rem';
        
        // Get the flowboard title from the current state
        const flowboardTitle = this.state?.title || 'Untitled Flow';
        mainTitleHeader.textContent = flowboardTitle;
        pageTable.appendChild(mainTitleHeader);
        
        // Add page info header
        const pageInfoHeader = document.createElement('div');
        pageInfoHeader.style.gridColumn = '1 / -1';
        pageInfoHeader.style.gridRow = '2';
        pageInfoHeader.style.padding = '0.8rem 1rem';
        pageInfoHeader.style.textAlign = 'center';
        pageInfoHeader.style.fontWeight = '600';
        pageInfoHeader.style.fontSize = '1rem';
        pageInfoHeader.style.color = '#7f8c8d';
        pageInfoHeader.style.borderBottom = '1px solid #bdc3c7';
        pageInfoHeader.style.backgroundColor = '#f8f9fa';
        
        pageInfoHeader.textContent = `Page ${pageNumber} of ${totalPages} • Columns ${startColumn + 1}-${endColumn}`;
        pageTable.appendChild(pageInfoHeader);
        
        // Create column headers for this page - always create 10 headers
        for (let i = 0; i < 10; i++) {
            const header = document.createElement('div');
            header.className = 'column-header';
            header.style.gridColumn = `${i + 2}`; // Start from column 2 (after row labels)
            header.style.gridRow = '3';
            
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
            rowLabel.style.gridRow = `${rowIndex + 4}`;
            
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
                cell.style.gridRow = `${rowIndex + 4}`;
                
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
            const maxTotalColumns = 30; // Limit to 30 columns maximum
            const totalColumns = Math.min(this.journeyData.length, maxTotalColumns);
            const totalPages = Math.ceil(totalColumns / maxColumnsPerPage);
            
            if (this.journeyData.length > maxTotalColumns) {
                console.warn(`Journey has ${this.journeyData.length} columns, limiting export to first ${maxTotalColumns} columns`);
            }
            
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
                    const flowboardTitle = this.state?.title || 'Untitled Flow';
                    const safeTitle = flowboardTitle.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
                    const filename = `${safeTitle}_Page_${pageIndex + 1}_of_${totalPages}.jpeg`;
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
            const flowboardTitle = this.state?.title || 'Untitled Flow';
            const safeTitle = flowboardTitle.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
            const link = document.createElement('a');
            link.download = `${safeTitle}_Journey_Map_${totalPages}_Pages.zip`;
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
            
            const maxTotalColumns = 30; // Limit to 30 columns maximum
            const totalColumns = Math.min(this.journeyData.length, maxTotalColumns);
            
            if (this.journeyData.length > maxTotalColumns) {
                console.warn(`Journey has ${this.journeyData.length} columns, limiting export to first ${maxTotalColumns} columns`);
            }
            
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
                const flowboardTitle = this.state?.title || 'Untitled Flow';
                const safeTitle = flowboardTitle.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
                const filename = `${safeTitle}_Journey_Map.jpeg`;
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
            const maxTotalColumns = 30; // Limit to 30 columns maximum
            const totalColumns = Math.min(this.journeyData.length, maxTotalColumns);
            const totalPages = Math.ceil(totalColumns / maxColumnsPerPage);
            
            if (this.journeyData.length > maxTotalColumns) {
                console.warn(`Journey has ${this.journeyData.length} columns, limiting export to first ${maxTotalColumns} columns`);
            }
            
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
            
            // Check if required libraries are available
            if (typeof window.html2canvas === 'undefined') {
                throw new Error('html2canvas library not loaded. Please refresh the page and try again.');
            }
            
            if (typeof window.JSZip === 'undefined') {
                throw new Error('JSZip library not loaded. Please refresh the page and try again.');
            }
            
            // Show loading message
            this.toast('Generating JPEG ZIP export...');
            
            const maxColumnsPerPage = 10;
            const maxTotalColumns = 30; // Limit to 30 columns maximum
            const totalColumns = Math.min(this.journeyData.length, maxTotalColumns);
            const totalPages = Math.ceil(totalColumns / maxColumnsPerPage);
            
            if (this.journeyData.length > maxTotalColumns) {
                console.warn(`Journey has ${this.journeyData.length} columns, limiting export to first ${maxTotalColumns} columns`);
            }
            
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
                    const flowboardTitle = this.state?.title || 'Untitled Flow';
                    const safeTitle = flowboardTitle.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
                    const filename = `${safeTitle}_Page_${pageIndex + 1}_of_${totalPages}.jpeg`;
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
            
            const flowboardTitle = this.state?.title || 'Untitled Flow';
            const safeTitle = flowboardTitle.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_');
            const link = document.createElement('a');
            link.download = `${safeTitle}_Journey_Map_Pages.zip`;
            link.href = URL.createObjectURL(zipBlob);
            link.click();
            
            console.log('ZIP export completed successfully');
            this.toast('JPEG ZIP export completed!');
            
        } catch (error) {
            console.error('Error exporting to JPEG ZIP:', error);
            this.toast(`Error exporting to JPEG ZIP: ${error.message}`);
        }
    }
    async exportToJPEG() {
        try {
            console.log('Starting JPEG export...');
            console.log('Current journey data length:', this.journeyData.length);
            
            const maxColumnsPerPage = 10;
            const maxTotalColumns = 30; // Limit to 30 columns maximum
            const totalColumns = Math.min(this.journeyData.length, maxTotalColumns);
            const totalPages = Math.ceil(totalColumns / maxColumnsPerPage);
            
            if (this.journeyData.length > maxTotalColumns) {
                console.warn(`Journey has ${this.journeyData.length} columns, limiting export to first ${maxTotalColumns} columns`);
            }
            
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
            this.toast('JPEG export completed!');
            
        } catch (error) {
            console.error('Error exporting to JPEG:', error);
            this.toast(`Error exporting to JPEG: ${error.message}`);
        }
    }

    exportToCSV() {
        try {
            const headers = ['Stage', 'Touch Point', 'Activities', 'Feelings and Needs', 'Mood', 'Opportunities'];
            
            // Add metadata comment at the top
            const maxTotalColumns = 30; // Limit to 30 columns maximum
            const totalColumns = Math.min(this.journeyData.length, maxTotalColumns);
            const maxColumnsPerPage = 10;
            const totalPages = Math.ceil(totalColumns / maxColumnsPerPage);
            
            if (this.journeyData.length > maxTotalColumns) {
                console.warn(`Journey has ${this.journeyData.length} columns, limiting export to first ${maxTotalColumns} columns`);
            }
            
            const metadataComment = `# Journey Map Export\n# Total Columns: ${totalColumns}${this.journeyData.length > maxTotalColumns ? ` (limited from ${this.journeyData.length})` : ''}\n# Recommended Pages for PDF/JPEG Export: ${totalPages} (max 10 columns per page)\n# Generated on: ${new Date().toLocaleString()}\n\n`;
            
            const csvContent = [
                metadataComment,
                headers.join(','),
                ...this.journeyData.slice(0, totalColumns).map(column => [
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
    setupProjectCreationModal();
    setupRightTocScrollEffect();
    setupProjectCollapse();
    setupProjectNameHeading();
    setupStorageUsage();
    setupTocMenu();
    setupContentNavScrollEffect();
    setupSidebarBottom();
    setupSettingsModal();
    setupGlobalExportHandlers(); // Setup global export dropdown handlers
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
        try {
            window.Components.renderFlow('flowMount');
            window.flowEditor = new FlowBoards('as-is'); // Default to as-is flow
            // Update title in DOM after flow editor is initialized
            if (window.flowEditor && window.flowEditor.boards && window.flowEditor.boards[0]) {
                window.flowEditor.boards[0].editor.updateTitleInDOM();
            }
            console.log('Flow editor initialized successfully');
        } catch (error) {
            console.error('Failed to initialize flow editor:', error);
        }
    }
    // Initialize Personas with simplified system
        try {
        renderPersonasInterface();
            console.log('Personas component rendered successfully');
        } catch (error) {
            console.error('Failed to render personas component:', error);
    }
    setupTocNavigation();
    // Initial sync of project name heading
    updateProjectNameHeading();
    updateStorageUsage();
    // Apply persisted theme on load
    try {
        const s = loadSettings();
        applyTheme(s.theme || 'light');
    } catch {}
});
class FlowEditor {
    constructor(options = {}) {
        // If an initial state is provided (e.g., when cloning a board), use a deep copy of it.
        // Otherwise, fall back to the global persisted flow data.
        this.state = options && options.initialState
            ? JSON.parse(JSON.stringify(options.initialState))
            : loadFlowData();
        
        // Ensure state has required structure
        this.state = ensureFlowDataStructure(this.state);
        
        // Update title in DOM if this is a board editor
        setTimeout(() => {
            const titleElement = this.wrap?.querySelector('.flow-board-title');
            if (titleElement && this.state.title) {
                titleElement.textContent = this.state.title;
            }
        }, 100);
        this.wrap = options.root || null;
        
        // Make flow canvas focusable for keyboard events (Delete/Backspace)
        if (this.wrap) {
            this.wrap.setAttribute('tabindex', '0');
            this.wrap.style.outline = 'none'; // Remove focus outline
            console.log('Flow canvas made focusable for keyboard events');
        }
        
        this.grid = (this.wrap && this.wrap.querySelector) ? this.wrap.querySelector('.flow-grid') : document.getElementById('flowGrid');
        this.table = (this.wrap && this.wrap.querySelector) ? this.wrap.querySelector('.flow-table') : document.getElementById('flowTable');
        this.toolbar = document.getElementById('flowToolbar');
        this.drag = null; // { id, offsetX, offsetY }
        this.dragCandidate = null; // pending drag before threshold reached
        this.lastPointer = { clientX: 0, clientY: 0 };
        this.isDoubleClicking = false; // flag to prevent drag setup during double-click
        this.isEditingText = false; // flag to prevent hover effects during text editing
        this.snapDuringDrag = false; // disabled snapping
        this.clipboard = null; // last copied item
        this.gridSize = this.state.gridSize || 20; // grid cell size for visuals
        this.columnWidth = this.state.columnWidth || 200; // column width for visuals
        this.gridEnabled = this.state.gridEnabled !== undefined ? this.state.gridEnabled : true; // grid visuals on by default
        this.baseWidth = 100 * this.columnWidth; // 100 columns (100 * 200 = 20000px)
        this.baseHeight = 500 * this.gridSize; // 500 rows (500 * 20 = 10000px)
        this.decisionSize = 100; // fixed side length for decision (diamond) nodes; matches CSS width/height
        this.history = []; // undo stack
        this.future = []; // redo stack
        this.zoom = 1; // zoom factor (1 = 100%)
        // New drag manager flags/state
        this.pointerDragEnabled = false; // disable legacy listeners
        this.activePointerId = null;
        // State structure is already ensured in constructor
        
        this.render();
        
        this.bindToolbar();
        // Enable node movement via the drag handle only
        this.dragManager = new NodeDragManager(this);
        this.dragManager.attach();
        this.bindCanvas();
        // Use setTimeout to ensure DOM is fully rendered before binding toolbar
        setTimeout(() => {
            this.bindOverlay();
            // Add debugging to check if the 3 dots button exists
            this.debugThreeDotsButton();
            // Add direct event binding as backup
            this.bindThreeDotsButtonDirectly();
        }, 0);
        this.bindShortcuts();
        this.updateToolbarState();
        
        // Add click handler to ensure canvas gets focus for keyboard events
        if (this.wrap) {
            this.wrap.addEventListener('click', (e) => {
                // Only focus if clicking on empty canvas area (not on nodes or edges)
                if (e.target === this.wrap || e.target.classList.contains('flow-grid')) {
                    this.wrap.focus();
                    console.log('Canvas focused for keyboard events');
                }
            });
        }
        
        // Make test method available globally for debugging
        window.testFlowCentering = () => this.testCentering();
        window.forceCenterDecisionNodes = () => this.forceCenterDecisionNodes();
        window.testToolbar = () => this.testToolbar();
        window.testEdgeDeletion = () => this.testEdgeDeletion();
    }
    
    testEdgeDeletion() {
        console.log('=== TESTING EDGE DELETION ===');
        console.log('Canvas focusable:', this.wrap ? this.wrap.getAttribute('tabindex') : 'no wrap');
        console.log('Canvas focused:', document.activeElement === this.wrap);
        console.log('Selected edge ID:', this.selectedEdgeId);
        console.log('Available edges:', this.state.edges ? this.state.edges.length : 0);
        
        if (this.state.edges && this.state.edges.length > 0) {
            console.log('Selecting first edge for testing...');
            this.selectEdge(this.state.edges[0].id);
            if (this.wrap) {
                this.wrap.focus();
            }
            console.log('Edge selected and canvas focused. Now press Delete or Backspace key.');
        } else {
            console.log('No edges available to test deletion.');
        }
        
        // Add debugging method for edge deletion
        window.debugEdgeDeletion = () => {
            console.log('=== EDGE DELETION DEBUG ===');
            console.log('FlowEditor instance:', this);
            console.log('Has wrap:', !!this.wrap);
            console.log('Has grid:', !!this.grid);
            console.log('Selected edge ID:', this.selectedEdgeId);
            console.log('Edges in state:', this.state.edges ? this.state.edges.length : 0);
            console.log('Selected node:', this.grid ? this.grid.querySelector('.flow-node.selected') : null);
            console.log('SVG elements:', this.grid ? this.grid.querySelectorAll('svg').length : 0);
            console.log('Path elements with data-edge-id:', this.grid ? this.grid.querySelectorAll('[data-edge-id]').length : 0);
            console.log('window.flowEditor:', window.flowEditor);
            console.log('window.flowEditor.boards:', window.flowEditor ? window.flowEditor.boards.length : 0);
            console.log('Active editor:', window.flowEditor ? window.flowEditor.getActiveEditor() : null);
            console.log('========================');
        };
        
        // Add test method to simulate edge deletion
        window.testEdgeDeletion = () => {
            console.log('=== TESTING EDGE DELETION ===');
            const editor = window.flowEditor ? window.flowEditor.getActiveEditor() : null;
            if (!editor) {
                console.error('No active editor found');
                return;
            }
            
            console.log('Testing with editor:', editor);
            console.log('Selected edge ID:', editor.selectedEdgeId);
            
            if (editor.selectedEdgeId) {
                console.log('Attempting to delete selected edge:', editor.selectedEdgeId);
                editor.deleteSelection();
            } else {
                console.log('No edge selected. Available edges:', editor.state.edges ? editor.state.edges.length : 0);
                if (editor.state.edges && editor.state.edges.length > 0) {
                    console.log('Selecting first edge for testing:', editor.state.edges[0].id);
                    editor.selectEdge(editor.state.edges[0].id);
                }
            }
            console.log('==============================');
        };
        
    }

    bindToolbar() { /* navbar buttons are bound in bindFlowNavbarActions */ }
    

    bindCanvas() {
        if (!this.grid) return;
        // NodeDragManager handles all pointer events including node selection
        // No additional click handlers needed to avoid conflicts
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
        
        // Get toolbar buttons using the correct selectors
        const add = qs('[data-flow="overlay-add"]');
        const addDecision = qs('[data-flow="overlay-add-decision"]');
        const addStart = qs('[data-flow="overlay-add-start"]');
        const undo = qs('[data-flow="overlay-undo"]');
        const redo = qs('[data-flow="overlay-redo"]');
        const zoomInBtn = qs('[data-flow="overlay-zoom-in"]');
        const zoomOutBtn = qs('[data-flow="overlay-zoom-out"]');
        const zoomResetBtn = qs('[data-flow="overlay-zoom-reset"]');
        const more = qs('[data-flow="overlay-more"]');
        const moreMenu = qs('[data-flow="overlay-more-menu"]');
        const deleteBoard = qs('[data-flow="overlay-delete-board"]');
        
        // Get import and export buttons
        const importJson = qs('[data-flow="overlay-import-json"]');
        const exportJson = qs('[data-flow="overlay-export-json"]');
        const exportPdf = qs('[data-flow="overlay-export-pdf"]');
        const exportPng = qs('[data-flow="overlay-export-png"]');
        
        // Debug logging to help identify issues
        console.log('Toolbar binding debug:', {
            toolbar: !!toolbar,
            add: !!add,
            addDecision: !!addDecision,
            addStart: !!addStart,
            undo: !!undo,
            redo: !!redo,
            zoomInBtn: !!zoomInBtn,
            zoomOutBtn: !!zoomOutBtn,
            zoomResetBtn: !!zoomResetBtn,
            more: !!more,
            moreMenu: !!moreMenu,
            exportJson: !!exportJson,
            exportPdf: !!exportPdf,
            exportPng: !!exportPng,
            deleteBoard: !!deleteBoard
        });
        
        // Bind event listeners to toolbar buttons
        if (add) {
            add.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Add process button clicked');
                this.addNode('process');
            });
        }
        
        if (addDecision) {
            addDecision.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Add decision button clicked');
                this.addNode('decision');
            });
        }
        
        if (addStart) {
            addStart.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Add start button clicked');
                this.addNode('start');
            });
        }
        
        if (undo) {
            undo.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Undo button clicked');
                this.undo();
            });
        }
        
        if (redo) {
            redo.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Redo button clicked');
                this.redo();
            });
        }
        
        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Zoom in button clicked');
                this.zoomIn();
            });
        }
        
        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Zoom out button clicked');
                this.zoomOut();
            });
        }
        
        if (zoomResetBtn) {
            zoomResetBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Zoom reset button clicked');
                this.resetZoom();
            });
        }
        
        // DISABLED: Event delegation handler to prevent conflicts
        console.log('Event delegation handler DISABLED for testing');
        
        // Handle more menu - use event delegation for dynamic elements
        // root.addEventListener('click', (e) => {
        //     // ... disabled to prevent conflicts with direct handler
        // });
        
        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            const activeDropdown = root.querySelector('.export-dropdown.active');
            
            if (activeDropdown && 
                !activeDropdown.contains(e.target)) {
                activeDropdown.classList.remove('active');
            }
        });
        
        
        // Handle import file input
        const boardId = this.wrap?.getAttribute('data-board-id') || 'default';
        const importFileInput = document.getElementById(`flowImportFile_${boardId}`);
        if (importFileInput) {
            importFileInput.addEventListener('change', (e) => {
                const file = e.target.files && e.target.files[0];
                if (file) {
                    console.log('Import file selected:', file.name);
                    this.importJSONFile(file);
                }
                // Reset the input so the same file can be selected again
                e.target.value = '';
            });
        }
    }
    
    triggerImportJSON() {
        const boardId = this.wrap?.getAttribute('data-board-id') || 'default';
        const fileInput = document.getElementById(`flowImportFile_${boardId}`);
        if (fileInput) {
            fileInput.click();
        } else {
            // Fallback: create a temporary input and open dialog
            this.importJSON();
        }
    }
    
    debugThreeDotsButton() {
        const root = this.wrap || document;
        const threeDotsButton = root.querySelector('button[data-flow="overlay-more"]');
        const threeDotsMenu = root.querySelector('[data-flow="overlay-more-menu"]');
        
        console.log('=== 3 DOTS BUTTON DEBUG ===');
        console.log('Root element:', root);
        console.log('3 dots button found:', !!threeDotsButton);
        console.log('3 dots menu found:', !!threeDotsMenu);
        
        if (threeDotsButton) {
            console.log('Button classes:', threeDotsButton.className);
            console.log('Button data-flow:', threeDotsButton.getAttribute('data-flow'));
            console.log('Button parent:', threeDotsButton.parentElement);
            console.log('Button is visible:', threeDotsButton.offsetParent !== null);
            console.log('Button computed style:', window.getComputedStyle(threeDotsButton));
        }
        
        if (threeDotsMenu) {
            console.log('Menu display style:', threeDotsMenu.style.display);
            console.log('Menu computed display:', window.getComputedStyle(threeDotsMenu).display);
        }
        
        // Note: Test click handler removed to avoid conflicts
        
        console.log('========================');
    }
    
    bindThreeDotsButtonDirectly() {
        const root = this.wrap || document;
        
        // Simple, clean 3-dots handler for flowboards only
        const setupThreeDots = () => {
            const threeDotsButton = root.querySelector('button[data-flow="overlay-more"]');
            const exportDropdown = root.querySelector('.export-dropdown');
            
            if (threeDotsButton && exportDropdown) {
                console.log('Setting up simple 3-dots handler for flowboard');
                
                // 1. Toggle menu on button click
                threeDotsButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('3-dots clicked, toggling menu');
                    
                    exportDropdown.classList.toggle('active');
                    console.log('Menu active:', exportDropdown.classList.contains('active'));
                });
                
                // 2. Handle menu item clicks
                const menuItems = exportDropdown.querySelectorAll('button.export-option[data-flow]');
                console.log('Found menu items:', menuItems.length);
                
                menuItems.forEach(item => {
                    item.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        const action = item.getAttribute('data-flow');
                        console.log('Menu item clicked:', action);
                        
                        // Execute action
                        switch (action) {
                            case 'overlay-export-json':
                                this.exportJSON();
                                break;
                            case 'overlay-export-pdf':
                                this.exportToPDF();
                                break;
                            case 'overlay-export-png':
                                this.exportToPNG();
                                break;
                            case 'overlay-import-json':
                                this.triggerImportJSON();
                                break;
                            case 'overlay-delete-board':
                                if (confirm('Delete this flow board?')) {
                                    this.deleteCurrentBoard();
                                }
                                break;
                        }
                        
                        // Close menu
                        exportDropdown.classList.remove('active');
                    });
                });
                
                // 3. Close menu when clicking outside
                document.addEventListener('click', (e) => {
                    if (!exportDropdown.contains(e.target)) {
                        exportDropdown.classList.remove('active');
                    }
                });
                
                console.log('✅ Simple 3-dots handler setup complete');
                return true;
            }
            return false;
        };
        
        // Setup immediately or retry
        if (!setupThreeDots()) {
            setTimeout(setupThreeDots, 100);
        }
        console.log('3-dots button functionality set up with direct handlers');
    }

    bindShortcuts() {
        // Store the bound function so we can remove it later if needed
        this.boundKeydown = (e) => {
            
            // Check if user is editing text in a connector - if so, don't interfere
            const isEditingConnectorText = e.target && e.target.hasAttribute('data-edge-text') && e.target.hasAttribute('contenteditable');

            // Check if user is editing flow-board title - if so, don't interfere
            const isEditingFlowBoardTitle = e.target && e.target.classList.contains('flow-board-title') && e.target.hasAttribute('contenteditable');

            // If typing in any contenteditable element (e.g., project title), do not intercept
            const isEditingAnyContentEditable = e.target && (e.target.isContentEditable || (e.target.getAttribute && e.target.getAttribute('contenteditable') === 'true'));

            // Also do not intercept when typing in form fields (inputs/textareas or elements with role="textbox")
            const target = e.target;
            const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
            const isFormField = tag === 'input' || tag === 'textarea' || (target && target.closest && target.closest('input, textarea')) || (target && target.getAttribute && target.getAttribute('role') === 'textbox');

            // Scope all shortcuts to this flow's container only
            const isWithinThisFlow = this.wrap && this.wrap.contains(target);
            console.log('Keyboard shortcut check:', {
                hasWrap: !!this.wrap,
                isWithinThisFlow,
                target: target ? target.tagName : 'no target',
                wrapId: this.wrap ? this.wrap.id || 'no-id' : 'no-wrap'
            });
            if (!isWithinThisFlow) {
                return; // Do not handle shortcuts when focus is outside this flow
            }

            // Delete selected node or edge
            if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditingConnectorText && !isEditingFlowBoardTitle && !isEditingAnyContentEditable && !isFormField) {
                console.log('Delete key pressed');
                console.log('Node selected:', !!(this.grid && this.grid.querySelector('.flow-node.selected')));
                console.log('Edge selected:', !!this.selectedEdgeId, 'ID:', this.selectedEdgeId);

                // Delete selected node or edge
                this.deleteSelection();
                e.preventDefault();
            }
            // Copy selection
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && !isEditingConnectorText && !isEditingFlowBoardTitle && !isFormField && !isEditingAnyContentEditable) {
                this.copySelection();
                e.preventDefault();
            }
            // Paste selection
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v' && !isEditingConnectorText && !isEditingFlowBoardTitle && !isFormField && !isEditingAnyContentEditable) {
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
        
        // Add trackpad zoom support
        this.bindTrackpadZoom();
    }
    bindTrackpadZoom() {
        // Store the bound function so we can remove it later if needed
        this.boundWheel = (e) => {
            // Only handle zoom when holding Cmd/Ctrl key (Mac trackpad pinch gesture)
            if (!(e.metaKey || e.ctrlKey)) {
                return;
            }
            
            // Check if the mouse position is within this flow's container
            // This is more reliable for trackpad gestures than e.target
            const flowboardElement = this.grid || this.wrap;
            if (!flowboardElement) {
                return;
            }
            
            const rect = flowboardElement.getBoundingClientRect();
            const isOverFlowboard = e.clientX >= rect.left && e.clientX <= rect.right && 
                                  e.clientY >= rect.top && e.clientY <= rect.bottom;
            
            if (!isOverFlowboard) {
                return; // Don't handle zoom for other flows
            }
            
            // Prevent default browser zoom behavior
            e.preventDefault();
            
            // Determine zoom direction based on wheel delta
            const delta = e.deltaY;
            const zoomStep = 0.05; // Smaller step for smoother trackpad zoom
            
            if (delta < 0) {
                // Zoom in (pinch out)
                this.zoomIn(zoomStep);
            } else if (delta > 0) {
                // Zoom out (pinch in)
                this.zoomOut(zoomStep);
            }
        };
        
        // Add the wheel event listener with passive: false to allow preventDefault
        document.addEventListener('wheel', this.boundWheel, { passive: false });
    }
    addNode(kind) {
        const id = generateId('node');
        let x = 40, y = 40;
        
        // Apply grid snapping for new nodes
        // No snapping or decision centering for new nodes
        
        const node = { 
            id, 
            kind, 
            label: kind === 'process' ? 'Process' : kind === 'decision' ? 'Decision' : 'Start', 
            x, 
            y 
        };
        this.pushHistory();
        this.state.nodes.push(node);
        this.persist();
        this.render();
    }

    deleteSelection() {
        console.log('deleteSelection called, selectedEdgeId:', this.selectedEdgeId);
        
        // Check if an edge is selected
        if (this.selectedEdgeId) {
            console.log('Deleting selected edge:', this.selectedEdgeId);
            this.pushHistory();
            
            // Delete the selected edge
            this.state.edges = (this.state.edges || []).filter(e => e.id !== this.selectedEdgeId);
            console.log('Edge deleted, remaining edges:', this.state.edges.length);
            
            this.selectedEdgeId = null;
            this.persist();
            this.render();
            console.log('Edge deletion completed');
            return;
        }
        
        // Check if a node is selected
        const selected = this.grid.querySelector('.flow-node.selected');
        if (selected) {
            const id = selected.dataset.id;
            console.log('Deleting selected node:', id);
            this.pushHistory();
            
            // Delete the node and all its connections
            this.state.nodes = this.state.nodes.filter(n => n.id !== id);
            this.state.edges = (this.state.edges || []).filter(e => e.from !== id && e.to !== id);
            
            this.persist();
            this.render();
            console.log('Node deletion completed');
            return;
        }
        
        console.log('No selection to delete');
    }

    selectNode(id) {
        this.clearNodeSelections();
        this.clearConnectorSelection();
        const el = this.grid.querySelector(`.flow-node[data-id="${id}"]`);
        if (el) el.classList.add('selected');
        
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

    // Consolidated method to clear connector selection
    clearConnectorSelection() {
        console.log('clearConnectorSelection called');
        
        // Remove visual selection from connectors
        if (this.grid) {
            const selectedEdges = this.grid.querySelectorAll('.edge-selected');
            console.log('Found selected edges to clear:', selectedEdges.length);
            
            selectedEdges.forEach(edge => {
                edge.classList.remove('edge-selected');
                // Reset edge styling
                edge.setAttribute('stroke', '#2196f3');
                edge.setAttribute('stroke-width', '1');
                console.log('Cleared edge selection for:', edge.getAttribute('data-edge-id'));
            });
            
            // Also clear any hit areas that might have selection styling
            const selectedHitAreas = this.grid.querySelectorAll('path[data-edge-id].edge-selected');
            selectedHitAreas.forEach(hitArea => {
                hitArea.classList.remove('edge-selected');
                console.log('Cleared hit area selection for:', hitArea.getAttribute('data-edge-id'));
            });
        }
        
        // Clear the selected edge ID
        this.selectedEdgeId = null;
        console.log('Selected edge ID cleared');
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

    // Deselect all nodes and connectors
    deselectAll() {
        this.clearNodeSelections();
        this.clearConnectorSelection();
        this.updateToolbarState();
    }



    chooseSidesForNodes(from, to) {
        const { cx: fx, cy: fy } = this.getNodeCenter(from);
        const { cx: tx, cy: ty } = this.getNodeCenter(to);
        
        const dx = tx - fx;
        const dy = ty - fy;
        
        // Determine best sides based on relative positions
        let fromSide, toSide;
        
        if (Math.abs(dx) > Math.abs(dy)) {
            fromSide = dx > 0 ? 'right' : 'left';
            toSide = dx > 0 ? 'left' : 'right';
        } else {
            fromSide = dy > 0 ? 'bottom' : 'top';
            toSide = dy > 0 ? 'top' : 'bottom';
        }
        
        return { fromSide, toSide };
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




    pushHistory() {
        this.history.push(JSON.stringify(this.state));
        if (this.history.length > 100) this.history.shift();
        this.future.length = 0; // clear redo
        this.updateToolbarState();
    }

    undo() {
        console.log('undo() called, history length:', this.history.length);
        if (!this.history.length) {
            console.log('No history to undo');
            return;
        }
        this.future.push(JSON.stringify(this.state));
        const prev = this.history.pop();
        this.state = JSON.parse(prev);
        this.persist();
        this.render();
        this.updateToolbarState();
        console.log('Undo completed');
    }

    redo() {
        console.log('redo() called, future length:', this.future.length);
        if (!this.future.length) {
            console.log('No future to redo');
            return;
        }
        this.history.push(JSON.stringify(this.state));
        const next = this.future.pop();
        this.state = JSON.parse(next);
        this.persist();
        this.render();
        this.updateToolbarState();
        console.log('Redo completed');
    }

    persist() { 
        saveFlowData(this.state);
        // Also save all boards if this is part of a multi-board system
        if (window.flowEditor && window.flowEditor.saveAllBoards) {
            window.flowEditor.saveAllBoards();
        }
    }
    
    toast(message) {
        const el = document.createElement('div');
        el.textContent = message;
        el.style.position = 'fixed';
        el.style.top = '12px';
        el.style.right = '12px';
        el.style.background = '#4CAF50';
        el.style.color = 'white';
        el.style.padding = '12px 24px';
        el.style.borderRadius = '8px';
        el.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
        el.style.zIndex = '10000';
        el.style.fontWeight = '500';
        el.style.fontSize = '14px';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.gap = '8px';
        el.style.opacity = '0';
        el.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        el.style.pointerEvents = 'none';
        
        // Add checkmark icon
        el.innerHTML = '✅ ' + message;
        
        document.body.appendChild(el);
        
        // Trigger animation
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateX(0)';
        }, 10);
        
        // Auto-remove after 3 seconds
        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (el.parentNode) {
                    el.parentNode.removeChild(el);
                }
            }, 300);
        }, 3000);
    }
    
    updateTitleInDOM() {
        const titleElement = document.getElementById('flowTitle');
        if (titleElement && this.state.title) {
            titleElement.textContent = this.state.title;
        }
    }

    
    toggleGrid() { 
        // Toggle only grid visuals; snapping logic is removed
        this.gridEnabled = !this.gridEnabled; 
        try { this.state.gridEnabled = this.gridEnabled; this.persist(); } catch {}
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
    
    // Test method to verify toolbar functionality
    testToolbar() {
        console.log('=== Toolbar Test ===');
        const root = this.wrap || document;
        const toolbar = root.querySelector('.flow-toolbar');
        
        if (!toolbar) {
            console.error('❌ Toolbar not found!');
            return;
        }
        
        console.log('✅ Toolbar found');
        
        const buttons = {
            add: toolbar.querySelector('[data-flow="overlay-add"]'),
            addDecision: toolbar.querySelector('[data-flow="overlay-add-decision"]'),
            undo: toolbar.querySelector('[data-flow="overlay-undo"]'),
            redo: toolbar.querySelector('[data-flow="overlay-redo"]'),
            zoomIn: toolbar.querySelector('[data-flow="overlay-zoom-in"]'),
            zoomOut: toolbar.querySelector('[data-flow="overlay-zoom-out"]'),
            zoomReset: toolbar.querySelector('[data-flow="overlay-zoom-reset"]'),
            more: toolbar.querySelector('[data-flow="overlay-more"]')
        };
        
        Object.entries(buttons).forEach(([name, button]) => {
            if (button) {
                console.log(`✅ ${name} button found`);
            } else {
                console.error(`❌ ${name} button not found`);
            }
        });
        
        // Test button clicks
        console.log('Testing button clicks...');
        if (buttons.add) {
            console.log('Testing add button...');
            buttons.add.click();
        }
    }
    
    
    // Geometry helpers
    getNodeSize(node) {
        // Decision nodes are fixed-size squares for consistent geometry
        if (node && node.kind === 'decision') {
            return { w: this.decisionSize, h: this.decisionSize };
        }
        // Start nodes are fixed-size circles
        if (node && node.kind === 'start') {
            return { w: 80, h: 80 };
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
                node: this.state.nodes.find(n => n.id === this.drag.id),
                zoom: this.zoom || 1,
                lastUpdate: performance.now()
            };
        }
        
        const { node, zoom } = this.dragCache;
        if (!node) return;
        
        // Get fresh grid bounding rect to handle zoom changes
        const wrap = this.grid.getBoundingClientRect();
        
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
        
        // Throttle updates to maintain 60fps
        const now = performance.now();
        if (now - this.dragCache.lastUpdate > 16) { // ~60fps
            this.dragCache.lastUpdate = now;
        }
    }
    


    _pointerToGrid(e) {
        const rect = this.grid.getBoundingClientRect();
        const scale = this.zoom || 1;
        const x = (e.clientX - rect.left) / scale;
        const y = (e.clientY - rect.top) / scale;
        return { x, y };
    }

    // Move a node
    moveNode(nodeId, newX, newY) {
        const node = this.state.nodes.find(n => n.id === nodeId);
        if (!node) return;
        
        // Update node position
        node.x = newX;
        node.y = newY;
        
        this.persist();
        this.render();
    }

    // Move multiple nodes
    moveNodes(nodeMovements) {
        // nodeMovements should be an array of { id, x, y } objects
        nodeMovements.forEach(movement => {
            const node = this.state.nodes.find(n => n.id === movement.id);
            if (node) {
                node.x = movement.x;
                node.y = movement.y;
            }
        });
        
        this.persist();
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

    getNodeCenter(node) { 
        const sz = this.getNodeSize(node); 
        // Return coordinates in grid space - SVG viewBox handles scaling
        return { cx: node.x + sz.w / 2, cy: node.y + sz.h / 2 }; 
    }
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
        const portOffset = 0; // 0 gap between nodes - connections touch node edges
        
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
                return this.getNodeCenter(node);
        }
    }
    
    
    // Consolidated anchor point calculation - uses port positions
    getAnchor(node, side) {
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
    updateToolbarState() {
        const root = this.wrap || document;
        const toolbar = root.querySelector('.flow-toolbar');
        if (!toolbar) return;
        
        const hasSelection = !!(this.grid && this.grid.querySelector('.flow-node.selected'));
        const canUndo = this.history.length > 0;
        const canRedo = this.future.length > 0;
        
        // Update undo button state
        const undoBtn = toolbar.querySelector('[data-flow="overlay-undo"]');
        if (undoBtn) {
            undoBtn.disabled = !canUndo;
            undoBtn.style.opacity = canUndo ? '1' : '0.5';
            undoBtn.title = canUndo ? 'Undo' : 'Nothing to undo';
        }
        
        // Update redo button state
        const redoBtn = toolbar.querySelector('[data-flow="overlay-redo"]');
        if (redoBtn) {
            redoBtn.disabled = !canRedo;
            redoBtn.style.opacity = canRedo ? '1' : '0.5';
            redoBtn.title = canRedo ? 'Redo' : 'Nothing to redo';
        }
        
        console.log('Toolbar state updated:', { hasSelection, canUndo, canRedo });
    }

    exportJSON() {
        try {
            // Ensure we have a complete state with all properties
            const exportData = ensureFlowDataStructure(this.state);
            
            // Add metadata for better tracking
            exportData.exportedAt = new Date().toISOString();
            exportData.version = '1.7.5';
            
            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            
            // Generate filename with timestamp
            const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
            const filename = `${exportData.title || 'flow'}-${timestamp}.json`;
            
            a.href = url; 
            a.download = filename; 
            a.click();
            URL.revokeObjectURL(url);
            
            // Show success message
            const nodeCount = exportData.nodes.length;
            const edgeCount = exportData.edges.length;
            const sectionCount = exportData.sections.length;
            
            this.showExportSuccess(`Exported ${nodeCount} nodes, ${edgeCount} connectors, and ${sectionCount} sections to ${filename}`);
            console.log('Export completed successfully:', { nodeCount, edgeCount, sectionCount });
            
        } catch (error) {
            console.error('Export JSON error:', error);
            this.showImportError('Failed to export JSON file. Please try again.');
        }
    }
    async exportToPDF() {
        try {
            console.log('Starting PDF export (flowboard viewport only)...');
            
            // Check if jsPDF is available
            if (typeof window.jspdf === 'undefined') {
                throw new Error('jsPDF library not loaded. Please refresh the page and try again.');
            }
            
            // Check if html2canvas is available
            if (typeof window.html2canvas === 'undefined') {
                throw new Error('html2canvas library not loaded. Please refresh the page and try again.');
            }
            
            // Show loading message
            this.showExportSuccess('Generating PDF export (visible area only)...');
            
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF('l', 'mm', 'a4'); // landscape orientation
            
            // Get the flow canvas container that's currently visible (without toolbar)
            const flowCanvasWrap = this.wrap?.querySelector('.flow-canvas-wrap');
            if (!flowCanvasWrap) {
                throw new Error('Flow canvas container not found');
            }
            
            // Capture only the visible viewport area of the flow canvas
            const canvas = await window.html2canvas(flowCanvasWrap, {
                backgroundColor: '#ffffff',
                scale: 2, // Higher resolution
                useCORS: true,
                allowTaint: true,
                scrollX: 0,
                scrollY: 0,
                width: flowCanvasWrap.clientWidth,
                height: flowCanvasWrap.clientHeight,
                windowWidth: window.innerWidth,
                windowHeight: window.innerHeight
            });
            
            console.log('Canvas captured, adding to PDF...');
            console.log('Canvas dimensions:', canvas.width, 'x', canvas.height);
            
            // Convert canvas to image data
            const imgData = canvas.toDataURL('image/png');
            
            // Fit image within page with margins while preserving aspect ratio
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 10; // 10mm margins
            const maxWidth = pageWidth - (2 * margin);
            const maxHeight = pageHeight - (2 * margin);
            
            // Calculate dimensions to fit the image while preserving aspect ratio
            const imgAspectRatio = canvas.width / canvas.height;
            const pageAspectRatio = maxWidth / maxHeight;
            
            let imgWidth, imgHeight;
            if (imgAspectRatio > pageAspectRatio) {
                // Image is wider than page ratio
                imgWidth = maxWidth;
                imgHeight = maxWidth / imgAspectRatio;
            } else {
                // Image is taller than page ratio
                imgHeight = maxHeight;
                imgWidth = maxHeight * imgAspectRatio;
            }
            
            // Center the image on the page
            const x = (pageWidth - imgWidth) / 2;
            const y = (pageHeight - imgHeight) / 2;
            
            // Add the image to the PDF
            doc.addImage(imgData, 'PNG', x, y, imgWidth, imgHeight);
            
            // Generate filename with timestamp
            const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
            const filename = `${this.state.title || 'flow'}-${timestamp}.pdf`;
            
            // Save the PDF
            doc.save(filename);
            
            console.log('PDF export completed successfully');
            this.showExportSuccess(`PDF exported successfully as ${filename}`);
            
        } catch (error) {
            console.error('PDF export error:', error);
            this.showImportError(`Failed to export PDF: ${error.message}`);
        }
    }

    async exportToPNG() {
        try {
            console.log('Starting PNG export (flowboard viewport only, transparent background)...');

            if (typeof window.html2canvas === 'undefined') {
                throw new Error('html2canvas library not loaded. Please refresh the page and try again.');
            }

            // Notify user
            this.showExportSuccess('Generating PNG (visible area only, transparent background)...');

            const flowCanvasWrap = this.wrap?.querySelector('.flow-canvas-wrap');
            if (!flowCanvasWrap) {
                throw new Error('Flow canvas container not found');
            }

            // Clone the wrapper and remove elements we don't want in the export
            const cloned = flowCanvasWrap.cloneNode(true);
            cloned.setAttribute('data-export-clone', 'true');
            // Remove tables
            cloned.querySelectorAll('.flow-table, table').forEach(el => el.parentNode && el.parentNode.removeChild(el));
            // Hide grid background but keep its children (nodes/connectors)
            cloned.querySelectorAll('.flow-grid').forEach(el => {
                el.style.setProperty('background', 'transparent', 'important');
                el.style.setProperty('background-image', 'none', 'important');
                el.style.setProperty('background-color', 'transparent', 'important');
                el.style.setProperty('box-shadow', 'none', 'important');
                el.style.setProperty('border', 'none', 'important');
            });

            // Also ensure the canvas wrapper doesn't contribute any background
            cloned.style.setProperty('background', 'transparent', 'important');
            cloned.style.setProperty('background-image', 'none', 'important');
            cloned.style.setProperty('background-color', 'transparent', 'important');

            // Inject a style tag to disable grid pseudo-elements/backgrounds during export
            const style = document.createElement('style');
            style.type = 'text/css';
            style.textContent = `
                [data-export-clone] .flow-grid::before,
                [data-export-clone] .flow-grid::after { background: none !important; background-image: none !important; box-shadow: none !important; border: none !important; content: none !important; }
                [data-export-clone] .flow-canvas-wrap::before,
                [data-export-clone] .flow-canvas-wrap::after { background: none !important; background-image: none !important; box-shadow: none !important; border: none !important; content: none !important; }
            `;
            cloned.appendChild(style);
            // Ensure clone has same visible size and render it offscreen
            cloned.style.width = flowCanvasWrap.clientWidth + 'px';
            cloned.style.height = flowCanvasWrap.clientHeight + 'px';
            cloned.style.position = 'fixed';
            cloned.style.left = '-10000px';
            cloned.style.top = '-10000px';
            document.body.appendChild(cloned);

            const canvas = await window.html2canvas(cloned, {
                backgroundColor: null, // transparent background
                scale: 2,
                useCORS: true,
                allowTaint: true,
                scrollX: 0,
                scrollY: 0,
                width: flowCanvasWrap.clientWidth,
                height: flowCanvasWrap.clientHeight,
                windowWidth: window.innerWidth,
                windowHeight: window.innerHeight
            });

            // Cleanup cloned DOM
            if (cloned && cloned.parentNode) {
                cloned.parentNode.removeChild(cloned);
            }

            const dataUrl = canvas.toDataURL('image/png');

            const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
            const filename = `${this.state.title || 'flow'}-${timestamp}.png`;

            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = filename;
            a.click();

            console.log('PNG export completed successfully');
            this.showExportSuccess(`PNG exported successfully as ${filename}`);
        } catch (error) {
            console.error('PNG export error:', error);
            this.showImportError(`Failed to export PNG: ${error.message}`);
        }
    }

    showExportSuccess(message) {
        const existingAlert = document.querySelector('.export-success-alert');
        if (existingAlert) {
            existingAlert.remove();
        }
        
        const alert = document.createElement('div');
        alert.className = 'export-success-alert';
        alert.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #000000;
            color: white;
            padding: 12px 16px;
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            max-width: 300px;
            word-wrap: break-word;
            border: 1px solid #333;
        `;
        alert.innerHTML = `✓ ${message}`;
        
        document.body.appendChild(alert);
        
        // Auto-remove after 4 seconds
        setTimeout(() => {
            if (alert.parentNode) {
                alert.parentNode.removeChild(alert);
            }
        }, 4000);
    }

    importJSONFile(file) {
        if (!file) {
            console.log('No file provided to importJSONFile');
            return;
        }
        
        console.log('Importing JSON file:', file.name, 'Size:', file.size, 'bytes');
        
        // Validate file type
        if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') {
            this.showImportError('Please select a valid JSON file (.json extension)');
            return;
        }
        
        // Validate file size (limit to 10MB)
        const maxSize = 10 * 1024 * 1024; // 10MB
        if (file.size > maxSize) {
            this.showImportError('File is too large. Please select a file smaller than 10MB.');
            return;
        }
        
        // Show loading indicator
        this.showImportLoading(true);
        
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const jsonText = String(reader.result);
                const data = JSON.parse(jsonText);
                
                console.log('JSON parsed successfully:', data);
                
                // Validate JSON structure
                if (!data || typeof data !== 'object') {
                    throw new Error('Invalid JSON structure: Root must be an object');
                }
                
                if (!Array.isArray(data.nodes)) {
                    throw new Error('Invalid JSON structure: Missing or invalid "nodes" array');
                }
                
                // Validate nodes structure
                const validNodes = data.nodes.every(node => 
                    node && typeof node === 'object' && 
                    typeof node.id === 'string' && 
                    typeof node.x === 'number' && 
                    typeof node.y === 'number'
                );
                
                if (!validNodes) {
                    throw new Error('Invalid JSON structure: Nodes must have id, x, and y properties');
                }
                
                // Validate edges structure if they exist
                if (data.edges && Array.isArray(data.edges)) {
                    const validEdges = data.edges.every(edge => 
                        edge && typeof edge === 'object' && 
                        typeof edge.id === 'string' && 
                        typeof edge.from === 'string' && 
                        typeof edge.to === 'string'
                    );
                    
                    if (!validEdges) {
                        console.warn('Some edges have invalid structure, they will be skipped');
                        data.edges = data.edges.filter(edge => 
                            edge && typeof edge === 'object' && 
                            typeof edge.id === 'string' && 
                            typeof edge.from === 'string' && 
                            typeof edge.to === 'string'
                        );
                    }
                }
                
                // Import successful - merge imported data with current state structure
                this.pushHistory();
                
                // Create a complete state object with all properties
                const importedState = {
                    nodes: data.nodes,
                    edges: data.edges || [],
                    sections: data.sections || [],
                    title: data.title || this.state.title || 'Imported Flow',
                    gridSize: data.gridSize || this.state.gridSize || 20,
                    columnWidth: data.columnWidth || this.state.columnWidth || 200,
                    gridEnabled: data.gridEnabled !== undefined ? data.gridEnabled : (this.state.gridEnabled !== undefined ? this.state.gridEnabled : true)
                };
                
                // Ensure the imported state has proper structure
                this.state = ensureFlowDataStructure(importedState);
                
                this.persist();
                this.render();
                
                const nodeCount = data.nodes.length;
                const edgeCount = (data.edges || []).length;
                const sectionCount = (data.sections || []).length;
                
                this.showImportSuccess(`Successfully imported ${nodeCount} nodes, ${edgeCount} connectors, and ${sectionCount} sections from ${file.name}`);
                console.log('Import completed successfully:', { nodeCount, edgeCount, sectionCount });
                
            } catch (error) {
                console.error('JSON import error:', error);
                this.showImportError(`Import failed: ${error.message}`);
            } finally {
                this.showImportLoading(false);
            }
        };
        
        reader.onerror = () => {
            console.error('File reading error:', reader.error);
            this.showImportError('Failed to read the file. Please try again.');
            this.showImportLoading(false);
        };
        
        reader.readAsText(file);
    }

    showImportLoading(show) {
        const existingLoader = document.querySelector('.import-loading-indicator');
        if (existingLoader) {
            existingLoader.remove();
        }
        
        if (show) {
            const loader = document.createElement('div');
            loader.className = 'import-loading-indicator';
            loader.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0,0,0,0.8);
                color: white;
                padding: 20px 30px;
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.5);
                z-index: 10001;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 16px;
                text-align: center;
            `;
            loader.innerHTML = `
                <div style="margin-bottom: 10px;">📥</div>
                <div>Importing JSON file...</div>
            `;
            
            document.body.appendChild(loader);
        }
    }

    showImportSuccess(message) {
        const existingAlert = document.querySelector('.import-success-alert');
        if (existingAlert) {
            existingAlert.remove();
        }
        
        const alert = document.createElement('div');
        alert.className = 'import-success-alert';
        alert.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #44aa44;
            color: white;
            padding: 12px 16px;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            max-width: 300px;
            word-wrap: break-word;
        `;
        alert.textContent = message;
        
        document.body.appendChild(alert);
        
        // Auto-remove after 4 seconds
        setTimeout(() => {
            if (alert.parentNode) {
                alert.parentNode.removeChild(alert);
            }
        }, 4000);
    }
    importJSON() {
        console.log('Import JSON triggered');
        
        // Try to find existing file input for this board
        const boardId = this.wrap?.getAttribute('data-board-id') || 'default';
        let fileInput = document.getElementById(`flowImportFile_${boardId}`);
        
        // If no existing input found, create a new one
        if (!fileInput) {
            console.log('No existing file input found, creating new one');
            fileInput = this.createFileInput(boardId);
        }
        
        if (fileInput) {
            // Clear any previous selection to ensure the dialog opens
            fileInput.value = '';
            
            // Add a small delay to ensure the input is ready
            setTimeout(() => {
                try {
                    fileInput.click();
                    console.log('File selection dialog opened');
                } catch (error) {
                    console.error('Error opening file dialog:', error);
                    this.showImportError('Unable to open file selection dialog. Please try again.');
                }
            }, 10);
        } else {
            console.error('Failed to create or find file input');
            this.showImportError('Unable to initialize file import. Please refresh the page and try again.');
        }
    }

    createFileInput(boardId) {
        try {
            // Create a new file input element
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.id = `flowImportFile_${boardId}`;
            fileInput.accept = 'application/json,.json';
            fileInput.style.display = 'none';
            fileInput.style.position = 'absolute';
            fileInput.style.left = '-9999px';
            fileInput.style.top = '-9999px';
            
            // Add change event listener
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files && e.target.files[0];
                if (file) {
                    console.log('Import file selected:', file.name);
                    this.importJSONFile(file);
                    
                    // Clean up the temporary input after use
                    setTimeout(() => {
                        if (fileInput.parentNode) {
                            fileInput.parentNode.removeChild(fileInput);
                        }
                    }, 100);
                } else {
                    console.log('No file selected');
                }
            });
            
            // Add to document body
            document.body.appendChild(fileInput);
            
            console.log('Created new file input for board:', boardId);
            return fileInput;
        } catch (error) {
            console.error('Error creating file input:', error);
            return null;
        }
    }
    showImportError(message) {
        // Show user-friendly error message
        const existingAlert = document.querySelector('.import-error-alert');
        if (existingAlert) {
            existingAlert.remove();
        }
        
        const alert = document.createElement('div');
        alert.className = 'import-error-alert';
        alert.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #ff4444;
            color: white;
            padding: 12px 16px;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px;
            max-width: 300px;
            word-wrap: break-word;
        `;
        alert.textContent = message;
        
        document.body.appendChild(alert);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (alert.parentNode) {
                alert.parentNode.removeChild(alert);
            }
        }, 5000);
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
        
        // Create new toast with minimal black/white styling
        const toast = document.createElement('div');
        toast.className = 'success-toast';
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #000000;
            color: white;
            padding: 12px 24px;
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            z-index: 10000;
            font-weight: 500;
            font-size: 14px;
            display: flex;
            align-items: center;
            gap: 8px;
            opacity: 0;
            transition: opacity 0.3s ease, transform 0.3s ease;
            pointer-events: none;
            border: 1px solid #333;
        `;
        toast.innerHTML = `✓ ${message}`;
        document.body.appendChild(toast);
        
        // Show toast
        setTimeout(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';
        }, 100);
        
        // Auto-remove after 3 seconds
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.remove();
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
            open.addEventListener('click', () => { this.state = JSON.parse(JSON.stringify(v.data)); this.persist(); this.render(); modal.classList.remove('show'); });
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
        // Don't apply zoom here - we'll do it after SVG is created
        // this.applyZoom();

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
            el.className = 'flow-node' + (n.kind === 'decision' ? ' decision' : n.kind === 'start' ? ' start' : '');
            el.dataset.id = n.id;
            // Accessibility
            el.setAttribute('role', 'group');
            el.setAttribute('aria-label', (n.kind === 'decision' ? 'Decision: ' : n.kind === 'start' ? 'Start: ' : 'Step: ') + (n.label || 'Untitled'));
            el.tabIndex = 0;
            // snap node CENTER to the midpoint between vertical lines for render
            const sz = this.getNodeSize(n);
            const sx = n.x;
            const sy = n.y;
            el.style.left = sx + 'px';
            el.style.top = sy + 'px';
            
            // Removed grid alignment/centering decorations
            // Apply size: decision nodes use fixed size; start nodes use fixed circle size; process nodes may persist w/h
            if (n.kind === 'decision') {
                const side = this.decisionSize;
                el.style.width = side + 'px';
                el.style.height = side + 'px';
            } else if (n.kind === 'start') {
                const diameter = 80; // Fixed circle size
                el.style.width = diameter + 'px';
                el.style.height = diameter + 'px';
            } else {
                if (typeof n.w === 'number') el.style.width = n.w + 'px';
                if (typeof n.h === 'number') el.style.height = n.h + 'px';
            }
            snappedPos.set(n.id, { x: sx, y: sy });
            el.innerHTML = `
                <div class="drag-handle" aria-hidden="true"></div>
                <div class="label" data-placeholder="Text..."></div>
                <div class="connection-dots" aria-hidden="true">
                    <div class="connection-dot top" data-side="top"></div>
                    <div class="connection-dot right" data-side="right"></div>
                    <div class="connection-dot bottom" data-side="bottom"></div>
                    <div class="connection-dot left" data-side="left"></div>
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
            // Node selection is handled by NodeDragManager to avoid conflicts
            
            // Add connection dot event listeners for line connector functionality
            this.bindConnectionDots(el, n);
            
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
                            try { this.persist(); } catch {}
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
                    // Only remove control characters, excessive whitespace, and special symbols
                    // Keep all letters, numbers, and common punctuation for better international support
                    const cleaned = raw.replace(/[\x00-\x1F\x7F-\x9F]/g, '').replace(/\s+/g, ' ').trim();
                    if (cleaned !== raw) {
                        labelEl.textContent = cleaned;
                        return true;
                    }
                    return false;
                };
                const updateDecisionDisplay = () => {
                    if (n.kind !== 'decision') return;
                    const full = (n.label || '').trim();
                    const maxChars = 10;
                    // Truncate display text but preserve all characters for better international support
                    const shown = full.length > maxChars ? full.slice(0, maxChars) + '...' : full;
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
                        // Don't sanitize decision letters during typing - only on blur
                        const next = (labelEl.textContent || '').trim();
                        if (next !== originalText) {
                            this.pushHistory();
                            n.label = next;
                            originalText = next;
                            this.persist();
                        }
                        adjustHeight();
                        this.renderEdgesOnly();
                        if (n.kind === 'decision') updateDecisionDisplay();
                    });
                };
                labelEl.addEventListener('input', () => {
                    // Don't sanitize decision letters during typing - only on blur
                    // This prevents interference with Thai and other Unicode text input
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
            grid.appendChild(el);
            // Lock initial size for process nodes on first render
            if (n.kind !== 'decision') {
                if (typeof n.w !== 'number' || typeof n.h !== 'number') {
                    const r = el.getBoundingClientRect();
                    n.w = Math.max(140, Math.round(r.width));
                    n.h = Math.max(44, Math.round(r.height));
                    try { this.persist(); } catch {}
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
                            this.persist();
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
        this.renderTable();
        
        // Render edges/connections
        this.renderEdgesOnly();
        
        // Apply zoom AFTER SVG is created so both grid and SVG get scaled together
        this.applyZoom();
        
        // Update SVG viewBox to match current grid dimensions
        this.updateSVGViewBox();
    }

    // Zoom controls
    applyZoom() {
        const scale = Math.max(0.25, Math.min(3, this.zoom));
        this.zoom = scale;
        if (this.grid) {
            this.grid.style.transformOrigin = 'top left';
            this.grid.style.transform = `scale(${scale})`;
        }
        
        // Don't scale SVG - let the coordinate system handle zoom naturally
        // The SVG coordinates will be scaled by the parent grid transform
        const svg = this.grid.querySelector('.flow-edges-svg');
        if (svg) {
            // Reset any previous scaling to avoid conflicts
            svg.style.transform = '';
            svg.style.transformOrigin = '';
        }
        
        // Update all connectors to maintain proper positioning
        this.scheduleEdgeUpdate();
    }

    // Update SVG viewBox to match current grid dimensions
    updateSVGViewBox() {
        const svg = this.grid.querySelector('.flow-edges-svg');
        if (svg) {
            const gridWidth = parseInt(this.grid.style.width) || this.baseWidth;
            const gridHeight = parseInt(this.grid.style.height) || this.baseHeight;
            svg.setAttribute('viewBox', `0 0 ${gridWidth} ${gridHeight}`);
            // Ensure SVG fills the entire grid area
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');
        }
    }

    // Schedule edge update for smooth performance
    scheduleEdgeUpdate() {
        if (this.edgeUpdateFrame) return;
        this.edgeUpdateFrame = requestAnimationFrame(() => {
            this.updateSVGViewBox(); // Update viewBox before rendering
            this.renderEdgesOnly();
            this.edgeUpdateFrame = null;
        });
    }

    // Consolidated connector update method
    scheduleConnectorUpdate(nodeId = null) {
        if (nodeId) {
            this.updateNodeConnectors(nodeId);
        }
        this.scheduleEdgeUpdate();
    }

    // Zigzag connector for simple path routing
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

        // Use simple zigzag connector to ensure connections work
        return this.zigzagConnector(start.x, start.y, end.x, end.y, {
            mode: (sideA === "left" || sideA === "right") ? "horizontal-first" : "vertical-first"
        });
    }

    // Update connectors for a moved node
    updateNodeConnectors(nodeId) {
        // Filter connectors that are connected to this node
        const connectedEdges = (this.state.edges || []).filter(edge => 
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

    zoomIn(step = 0.1) { 
        this.zoom = (this.zoom || 1) + step; 
        this.applyZoom(); 
        this.updateSVGViewBox();
        // Update connectors after zoom
        this.scheduleEdgeUpdate();
    }
    zoomOut(step = 0.1) { 
        this.zoom = (this.zoom || 1) - step; 
        this.applyZoom(); 
        this.updateSVGViewBox();
        // Update connectors after zoom
        this.scheduleEdgeUpdate();
    }
    resetZoom() {
        this.zoom = 1;
        this.applyZoom();
        this.updateSVGViewBox();
        // Update connectors after zoom reset
        this.scheduleEdgeUpdate();
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

    // Edge rendering method - now implements line connector functionality
    renderEdgesOnly(isRealTimeUpdate = false) {
        if (!this.grid) return;
        
        // For real-time updates during dragging, reuse existing SVG to improve performance
        let svg = this.grid.querySelector('.flow-edges-svg');
        if (!svg || !isRealTimeUpdate) {
            // Remove existing SVG if it exists
            if (svg) {
                svg.remove();
            }
            
            // Create SVG container for edges
            svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.classList.add('flow-edges-svg');
            svg.style.position = 'absolute';
            svg.style.top = '0';
            svg.style.left = '0';
            svg.style.width = '100%';
            svg.style.height = '100%';
            svg.style.pointerEvents = 'none';
            svg.style.zIndex = '5';
            
            // Set viewBox to match the grid dimensions for proper coordinate scaling
            const gridWidth = parseInt(this.grid.style.width) || this.baseWidth;
            const gridHeight = parseInt(this.grid.style.height) || this.baseHeight;
            svg.setAttribute('viewBox', `0 0 ${gridWidth} ${gridHeight}`);
            svg.setAttribute('preserveAspectRatio', 'none');
            
            // Add arrowhead marker definition (only for new SVG)
            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            
            // Create minimal arrowhead marker
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.setAttribute('id', 'arrowhead');
            marker.setAttribute('markerWidth', '8');
            marker.setAttribute('markerHeight', '6');
            marker.setAttribute('refX', '7'); // Position arrow tip at the end of the path
            marker.setAttribute('refY', '3');
            marker.setAttribute('orient', 'auto');
            marker.setAttribute('markerUnits', 'strokeWidth');
            marker.setAttribute('viewBox', '0 0 8 6');
            
            // Create a minimal arrowhead shape
            const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            polygon.setAttribute('points', '0 1, 6 3, 0 5');
            polygon.setAttribute('fill', '#2196f3');
            polygon.setAttribute('stroke', 'none');
            
            marker.appendChild(polygon);
            defs.appendChild(marker);
            svg.appendChild(defs);
            
            // Add SVG to grid (only for new SVG)
            this.grid.appendChild(svg);
        }
        
        // For real-time updates, clear existing paths and re-render
        if (isRealTimeUpdate) {
            // Remove all existing path elements
            const existingPaths = svg.querySelectorAll('path');
            existingPaths.forEach(path => path.remove());
            
            // Update edge label positions for real-time updates
            this.updateEdgeLabelPositions();
        } else {
            // For full re-render, also clean up existing HTML text labels
            const existingTextLabels = this.grid.querySelectorAll('.edge-text-label');
            existingTextLabels.forEach(label => label.remove());
        }
        
        // Render all edges (with safety check)
        if (this.state.edges && Array.isArray(this.state.edges)) {
            this.state.edges.forEach(edge => {
                this.renderEdge(edge, svg);
            });
        }
        
        // Always render edge labels to ensure they persist
        this.renderEdgeLabels(svg);
    }
    
    // Render a single edge with improved styling
    renderEdge(edge, svg) {
        const fromNode = this.state.nodes.find(n => n.id === edge.from);
        const toNode = this.state.nodes.find(n => n.id === edge.to);
        
        if (!fromNode || !toNode) return;
        
        // Map port names to side names
        const portToSide = { 't': 'top', 'r': 'right', 'b': 'bottom', 'l': 'left' };
        const fromSide = portToSide[edge.fromPort] || 'right';
        const toSide = portToSide[edge.toPort] || 'left';
        
        // Calculate connection points
        const fromPoint = this.getConnectionPoint(fromNode, fromSide);
        const toPoint = this.getConnectionPoint(toNode, toSide);
        const pathData = this.createPathData(fromPoint, toPoint, fromSide, toSide);
        
        // Create path element
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        
        path.setAttribute('d', pathData);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#2196f3');
        path.setAttribute('stroke-width', '1');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('marker-end', 'url(#arrowhead)');
        path.setAttribute('data-edge-id', edge.id);
        path.style.cursor = 'pointer';
        path.style.pointerEvents = 'stroke';
        path.style.filter = 'drop-shadow(0 1px 2px rgba(33, 150, 243, 0.2))';
        
        // Create an invisible hit area for easier clicking (add first so it's behind the visible path)
        const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hitArea.setAttribute('d', pathData);
        hitArea.setAttribute('fill', 'none');
        hitArea.setAttribute('stroke', 'transparent');
        hitArea.setAttribute('stroke-width', '12'); // Large hit area
        hitArea.setAttribute('data-edge-id', edge.id);
        hitArea.style.cursor = 'pointer';
        hitArea.style.pointerEvents = 'all';
        svg.insertBefore(hitArea, svg.firstChild); // Insert at the beginning
        
        // Add enhanced hover effects
        path.addEventListener('mouseenter', () => {
            path.setAttribute('stroke-width', '1.5');
            path.setAttribute('stroke', '#1ea1f2');
            path.style.filter = 'drop-shadow(0 2px 4px rgba(30, 161, 242, 0.4))';
        });
        
        path.addEventListener('mouseleave', () => {
            path.setAttribute('stroke-width', '1');
            path.setAttribute('stroke', '#2196f3');
            path.style.filter = 'drop-shadow(0 1px 2px rgba(33, 150, 243, 0.2))';
        });
        
        // Add click handler for edge selection/deletion
        const handleEdgeClick = (e) => {
            console.log('Edge clicked:', edge.id);
            this.selectEdge(edge.id);
            
            // Ensure canvas gets focus for keyboard events (Delete/Backspace)
            if (this.wrap) {
                this.wrap.focus();
            }
            
            // Don't stop propagation completely - let canvas receive focus
            // e.stopPropagation(); // Removed to allow proper focus management
        };
        
        path.addEventListener('click', handleEdgeClick);
        hitArea.addEventListener('click', handleEdgeClick);
        
        // Add double-click handler for text editing
        path.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            e.preventDefault();
            console.log('Double-click detected on edge:', edge.id);
            this.selectEdge(edge.id); // Ensure edge is selected first
            if (this.wrap) {
                this.wrap.focus(); // Ensure canvas has focus
            }
            this.startEdgeTextEditing(edge, path, fromPoint, toPoint);
        });
        
        svg.appendChild(path);
    }
    
    // Get connection point for a node and side - consolidated method
    getConnectionPoint(node, side) {
        return this.getPortPosition(node, side);
    }
    // Create path data for connection line with improved routing
    createPathData(fromPoint, toPoint, fromSide = null, toSide = null) {
        const dx = toPoint.x - fromPoint.x;
        const dy = toPoint.y - fromPoint.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Special handling for bottom-to-bottom connections in the same row
        if (fromSide === 'bottom' && toSide === 'bottom' && Math.abs(dy) < 20) {
            // Both nodes are connected from bottom and are in the same row
            // Create a more pronounced curve that goes down and then up
            const curveDepth = Math.max(distance * 0.3, 40); // Minimum 40px curve depth
            const midX = (fromPoint.x + toPoint.x) / 2;
            
            // Control points for a smooth U-shaped curve
            const controlPoint1X = fromPoint.x + (dx * 0.3);
            const controlPoint1Y = fromPoint.y + curveDepth;
            const controlPoint2X = toPoint.x - (dx * 0.3);
            const controlPoint2Y = toPoint.y + curveDepth;
            
            return `M ${fromPoint.x} ${fromPoint.y} C ${controlPoint1X} ${controlPoint1Y}, ${controlPoint2X} ${controlPoint2Y}, ${toPoint.x} ${toPoint.y}`;
        }
        
        // Calculate the angle for proper arrow direction
        const angle = Math.atan2(dy, dx);
        
        // Determine routing strategy based on distance and direction
        if (distance < 100) {
            // Short distance: simple curve
            const controlOffset = Math.min(distance * 0.4, 50);
            const controlPoint1X = fromPoint.x + Math.cos(angle) * controlOffset;
            const controlPoint1Y = fromPoint.y + Math.sin(angle) * controlOffset;
            const controlPoint2X = toPoint.x - Math.cos(angle) * controlOffset;
            const controlPoint2Y = toPoint.y - Math.sin(angle) * controlOffset;
            
            return `M ${fromPoint.x} ${fromPoint.y} C ${controlPoint1X} ${controlPoint1Y}, ${controlPoint2X} ${controlPoint2Y}, ${toPoint.x} ${toPoint.y}`;
        } else {
            // Longer distance: use orthogonal routing for cleaner appearance
            const midX = (fromPoint.x + toPoint.x) / 2;
            const midY = (fromPoint.y + toPoint.y) / 2;
            
            // Calculate control points for smoother orthogonal routing
            const controlOffset = Math.min(distance * 0.3, 80);
            
            let controlPoint1X, controlPoint1Y, controlPoint2X, controlPoint2Y;
            
            if (Math.abs(dx) > Math.abs(dy)) {
                // Horizontal routing
                const horizontalOffset = Math.sign(dx) * controlOffset;
                controlPoint1X = fromPoint.x + horizontalOffset;
                controlPoint1Y = fromPoint.y;
                controlPoint2X = toPoint.x - horizontalOffset;
                controlPoint2Y = toPoint.y;
            } else {
                // Vertical routing
                const verticalOffset = Math.sign(dy) * controlOffset;
                controlPoint1X = fromPoint.x;
                controlPoint1Y = fromPoint.y + verticalOffset;
                controlPoint2X = toPoint.x;
                controlPoint2Y = toPoint.y - verticalOffset;
            }
            
            return `M ${fromPoint.x} ${fromPoint.y} C ${controlPoint1X} ${controlPoint1Y}, ${controlPoint2X} ${controlPoint2Y}, ${toPoint.x} ${toPoint.y}`;
        }
    }
    
    // Select an edge with improved state management
    selectEdge(edgeId) {
        console.log('selectEdge called with ID:', edgeId);
        
        // Clear node selections when selecting a connector
        this.clearNodeSelections();
        
        // Clear any existing edge selection first
        this.clearConnectorSelection();
        
        // Add selection to current edge (both visible path and hit area)
        const edgePaths = this.grid.querySelectorAll(`[data-edge-id="${edgeId}"]`);
        console.log('Found edge path elements:', edgePaths.length);
        
        if (edgePaths.length > 0) {
            edgePaths.forEach(edgePath => {
                edgePath.classList.add('edge-selected');
                // Only apply visual styling to visible paths (not transparent hit areas)
                if (edgePath.getAttribute('stroke') !== 'transparent') {
                    edgePath.setAttribute('stroke', '#ff4444');
                    edgePath.setAttribute('stroke-width', '3');
                }
            });
            
            // Store selected edge ID
            this.selectedEdgeId = edgeId;
            console.log('Selected edge ID set to:', this.selectedEdgeId);
            this.updateToolbarState();
        } else {
            console.warn('Edge path element not found for ID:', edgeId);
        }
    }
    // Start text editing for an edge
    startEdgeTextEditing(edge, pathElement, fromPoint, toPoint) {
        console.log('Starting edge text editing for:', edge.id);
        
        // Calculate proper midpoint (curve-aware)
        const midpoint = this.getEdgeTextMidpoint(fromPoint, toPoint, edge);
        
        // Check if text element already exists
        let textElement = this.grid.querySelector(`[data-edge-text="${edge.id}"]`);
        
        if (!textElement) {
            // Create HTML text element instead of SVG for better editing support
            textElement = document.createElement('div');
            textElement.setAttribute('data-edge-text', edge.id);
            textElement.className = 'edge-text-label';
            textElement.style.position = 'absolute';
            textElement.style.left = `${midpoint.x}px`;
            textElement.style.top = `${midpoint.y}px`;
            textElement.style.transform = 'translate(-50%, -50%)';
            textElement.style.pointerEvents = 'all';
            textElement.style.cursor = 'text';
            textElement.style.userSelect = 'text';
            textElement.style.zIndex = '1000';
            textElement.style.minWidth = '20px';
            textElement.style.minHeight = '16px';
            textElement.style.background = 'white';
            textElement.style.border = '1px solid #e0e0e0';
            textElement.style.boxShadow = 'none';
            
            // Add click handler for editing (single click works for all edges)
            textElement.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                console.log('Click detected on edge text:', edge.id);
                
                // Always start editing when clicked
                this.setupEdgeTextEditing(textElement, edge);
            });
            
            // Add double-click handler for editing (backup)
            textElement.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                e.preventDefault();
                console.log('Double-click detected on edge text:', edge.id);
                this.setupEdgeTextEditing(textElement, edge);
            });
            
            // Add to grid (not SVG)
            this.grid.appendChild(textElement);
        }
        
        // Set up text editing
        this.setupEdgeTextEditing(textElement, edge);
    }
    // Setup text editing for edge text element
    setupEdgeTextEditing(textElement, edge) {
        // Check if already editing to prevent multiple edits
        if (textElement.hasAttribute('data-editing')) {
            // If already editing, just ensure text is selected for easy deletion
            setTimeout(() => {
                textElement.focus();
                if (window.getSelection) {
                    const selection = window.getSelection();
                    const range = document.createRange();
                    range.selectNodeContents(textElement);
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
            }, 10);
            return;
        }
        
        // Mark as editing to prevent duplicate setups
        textElement.setAttribute('data-editing', 'true');
        
        // Show the text element when editing starts
        textElement.style.display = 'block';
        textElement.style.opacity = '1';
        textElement.style.fontStyle = 'normal';
        
        // Set initial text if edge has label
        if (edge.label && edge.label.trim() !== '') {
            textElement.textContent = edge.label;
        } else {
            textElement.textContent = '';
        }
        
        // Make text editable
        textElement.setAttribute('contenteditable', 'true');
        textElement.setAttribute('spellcheck', 'false');
        
        // Focus and select text
        setTimeout(() => {
            textElement.focus();
            
            // Ensure the element is properly focused and text is selectable
            textElement.style.userSelect = 'text';
            textElement.style.webkitUserSelect = 'text';
            textElement.style.mozUserSelect = 'text';
            textElement.style.msUserSelect = 'text';
            
            // Select all text for easy replacement
            if (window.getSelection) {
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(textElement);
                selection.removeAllRanges();
                selection.addRange(range);
                
                // Also try to set cursor position to end if selection fails
                if (selection.rangeCount === 0) {
                    const newRange = document.createRange();
                    newRange.setStart(textElement, 0);
                    newRange.setEnd(textElement, textElement.childNodes.length);
                    selection.addRange(newRange);
                }
            }
        }, 50);
        
        // Add event listeners for saving text
        const saveText = () => {
            const newText = textElement.textContent.trim().substring(0, 20);
            
            // Update edge data
            edge.label = newText;
            
            // Remove contenteditable and editing flag
            textElement.removeAttribute('contenteditable');
            textElement.removeAttribute('data-editing');
            
            // Update text content and visibility
            if (newText) {
                textElement.textContent = newText;
                textElement.style.display = 'block';
                textElement.style.opacity = '1';
                textElement.style.fontStyle = 'normal';
            } else {
                textElement.textContent = '';
                textElement.style.display = 'none'; // Hide completely when empty for clean line
                textElement.style.opacity = '1';
                textElement.style.fontStyle = 'normal';
            }
            
            // Save the flow data - use persist() for proper multi-board synchronization
            this.persist();
            
            console.log('Edge text saved:', newText);
        };
        
        // Save on blur (click outside)
        textElement.addEventListener('blur', saveText, { once: true });
        
        // Handle all keydown events in a single listener
        textElement.addEventListener('keydown', (e) => {
            // Prevent global shortcuts from interfering with text editing
            e.stopPropagation();
            
            if (e.key === 'Enter') {
                e.preventDefault();
                saveText();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                textElement.removeAttribute('contenteditable');
                textElement.removeAttribute('data-editing');
                
                // Restore original text and visibility
                if (edge.label && edge.label.trim() !== '') {
                    textElement.textContent = edge.label;
                    textElement.style.display = 'block';
                    textElement.style.opacity = '1';
                    textElement.style.fontStyle = 'normal';
                } else {
                    textElement.textContent = '';
                    textElement.style.display = 'none'; // Hide completely when empty for clean line
                    textElement.style.opacity = '1';
                    textElement.style.fontStyle = 'normal';
                }
            }
            // Allow all other keys (including backspace, delete, arrow keys, etc.) to work normally
        });
        
        // Limit input to 20 characters
        textElement.addEventListener('input', (e) => {
            if (textElement.textContent.length > 20) {
                textElement.textContent = textElement.textContent.substring(0, 20);
                // Move cursor to end
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(textElement);
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        });
        
        // Add a focus event to ensure text is selected when focused
        textElement.addEventListener('focus', (e) => {
            setTimeout(() => {
                if (window.getSelection) {
                    const selection = window.getSelection();
                    const range = document.createRange();
                    range.selectNodeContents(textElement);
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
            }, 10);
        });
    }
    
    // Render existing edge labels
    renderEdgeLabels(svg) {
        // Clear existing edge labels first to prevent duplicates
        const existingLabels = this.grid.querySelectorAll('[data-edge-text]');
        existingLabels.forEach(label => label.remove());
        
        (this.state.edges || []).forEach(edge => {
            const fromNode = this.state.nodes.find(n => n.id === edge.from);
            const toNode = this.state.nodes.find(n => n.id === edge.to);
            
            if (fromNode && toNode) {
                const portToSide = { 't': 'top', 'r': 'right', 'b': 'bottom', 'l': 'left' };
                const fromSide = portToSide[edge.fromPort] || 'right';
                const toSide = portToSide[edge.toPort] || 'left';
                const fromPoint = this.getConnectionPoint(fromNode, fromSide);
                const toPoint = this.getConnectionPoint(toNode, toSide);
                
                // Calculate proper midpoint (curve-aware)
                const midpoint = this.getEdgeTextMidpoint(fromPoint, toPoint, edge);
                
                // Create HTML text element for ALL edges (even empty ones)
                const textElement = document.createElement('div');
                textElement.setAttribute('data-edge-text', edge.id);
                textElement.className = 'edge-text-label';
                textElement.style.position = 'absolute';
                textElement.style.left = `${midpoint.x}px`;
                textElement.style.top = `${midpoint.y}px`;
                textElement.style.transform = 'translate(-50%, -50%)';
                textElement.style.pointerEvents = 'all';
                textElement.style.cursor = 'text';
                textElement.style.userSelect = 'text';
                textElement.style.zIndex = '1000';
                textElement.style.minWidth = '20px';
                textElement.style.minHeight = '16px';
                textElement.style.background = 'white';
                textElement.style.border = '1px solid #e0e0e0';
                textElement.style.boxShadow = 'none';
                
                // Set text content - hide text element completely when empty for clean line display
                if (edge.label && edge.label.trim() !== '') {
                    textElement.textContent = edge.label;
                    textElement.style.display = 'block';
                    textElement.style.opacity = '1';
                } else {
                    textElement.textContent = '';
                    textElement.style.display = 'none'; // Hide completely when empty for clean line
                    textElement.style.opacity = '1';
                }
                
                // Add click handler for editing (single click works for all edges)
                textElement.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    console.log('Click detected on edge text:', edge.id);
                    this.setupEdgeTextEditing(textElement, edge);
                });
                
                // Add double-click handler for editing (backup)
                textElement.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    console.log('Double-click detected on edge text:', edge.id);
                    this.setupEdgeTextEditing(textElement, edge);
                });
                
                // Add to grid (not SVG)
                this.grid.appendChild(textElement);
            }
        });
    }
    
    // Calculate midpoint along a cubic Bezier curve
    getCurveMidpoint(p0, p1, p2, p3) {
        // For cubic Bezier curve: B(t) = (1-t)³P₀ + 3(1-t)²tP₁ + 3(1-t)t²P₂ + t³P₃
        // At t = 0.5 (midpoint):
        const t = 0.5;
        const oneMinusT = 1 - t;
        const oneMinusTSquared = oneMinusT * oneMinusT;
        const oneMinusTCubed = oneMinusTSquared * oneMinusT;
        const tSquared = t * t;
        const tCubed = tSquared * t;
        
        const x = oneMinusTCubed * p0.x + 3 * oneMinusTSquared * t * p1.x + 3 * oneMinusT * tSquared * p2.x + tCubed * p3.x;
        const y = oneMinusTCubed * p0.y + 3 * oneMinusTSquared * t * p1.y + 3 * oneMinusT * tSquared * p2.y + tCubed * p3.y;
        
        return { x, y };
    }
    
    // Get proper midpoint for edge text based on connector type
    getEdgeTextMidpoint(fromPoint, toPoint, edge) {
        const dx = toPoint.x - fromPoint.x;
        const dy = toPoint.y - fromPoint.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Check if this is a curve connector by looking at the path element
        const pathElement = this.grid.querySelector(`path[data-edge-id="${edge.id}"]`);
        if (pathElement) {
            const pathData = pathElement.getAttribute('d');
            
            // Check if it's a cubic Bezier curve (starts with M and contains C)
            if (pathData && pathData.includes('C')) {
                // Parse the curve control points from the path
                const pathParts = pathData.split(' ');
                if (pathParts.length >= 8) {
                    // Format: M x y C cx1 cy1, cx2 cy2, x y
                    const p0 = { x: parseFloat(pathParts[1]), y: parseFloat(pathParts[2]) };
                    const p1 = { x: parseFloat(pathParts[4]), y: parseFloat(pathParts[5]) };
                    const p2 = { x: parseFloat(pathParts[6]), y: parseFloat(pathParts[7]) };
                    const p3 = { x: parseFloat(pathParts[8]), y: parseFloat(pathParts[9]) };
                    
                    // Calculate actual midpoint along the curve
                    return this.getCurveMidpoint(p0, p1, p2, p3);
                }
            }
        }
        
        // Fallback to simple midpoint for straight lines
        return {
            x: (fromPoint.x + toPoint.x) / 2,
            y: (fromPoint.y + toPoint.y) / 2
        };
    }
    
    // Get proper midpoint for edge text in export context (without relying on DOM elements)
    getEdgeTextMidpointForExport(fromPoint, toPoint, edge, fromSide, toSide) {
        const dx = toPoint.x - fromPoint.x;
        const dy = toPoint.y - fromPoint.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Use the same path creation logic to determine if it's a curve
        // This matches the logic in createPathData method
        if (distance < 100) {
            // Short distance: simple curve - calculate midpoint along curve
            const controlOffset = Math.min(distance * 0.4, 50);
            const angle = Math.atan2(dy, dx);
            const controlPoint1X = fromPoint.x + Math.cos(angle) * controlOffset;
            const controlPoint1Y = fromPoint.y + Math.sin(angle) * controlOffset;
            const controlPoint2X = toPoint.x - Math.cos(angle) * controlOffset;
            const controlPoint2Y = toPoint.y - Math.sin(angle) * controlOffset;
            
            // Calculate midpoint along the curve using the same control points
            const p0 = fromPoint;
            const p1 = { x: controlPoint1X, y: controlPoint1Y };
            const p2 = { x: controlPoint2X, y: controlPoint2Y };
            const p3 = toPoint;
            
            return this.getCurveMidpoint(p0, p1, p2, p3);
        } else {
            // Longer distance: orthogonal routing - calculate midpoint along curve
            const controlOffset = Math.min(distance * 0.3, 80);
            let controlPoint1X, controlPoint1Y, controlPoint2X, controlPoint2Y;
            
            if (Math.abs(dx) > Math.abs(dy)) {
                // Horizontal routing
                const horizontalOffset = Math.sign(dx) * controlOffset;
                controlPoint1X = fromPoint.x + horizontalOffset;
                controlPoint1Y = fromPoint.y;
                controlPoint2X = toPoint.x - horizontalOffset;
                controlPoint2Y = toPoint.y;
            } else {
                // Vertical routing
                const verticalOffset = Math.sign(dy) * controlOffset;
                controlPoint1X = fromPoint.x;
                controlPoint1Y = fromPoint.y + verticalOffset;
                controlPoint2X = toPoint.x;
                controlPoint2Y = toPoint.y - verticalOffset;
            }
            
            // Calculate midpoint along the curve using the same control points
            const p0 = fromPoint;
            const p1 = { x: controlPoint1X, y: controlPoint1Y };
            const p2 = { x: controlPoint2X, y: controlPoint2Y };
            const p3 = toPoint;
            
            return this.getCurveMidpoint(p0, p1, p2, p3);
        }
    }

    // Helper method to calculate midpoint along a cubic Bezier curve
    getCurveMidpoint(p0, p1, p2, p3) {
        // Calculate the midpoint of a cubic Bezier curve at t = 0.5
        const t = 0.5;
        const oneMinusT = 1 - t;
        
        const x = Math.pow(oneMinusT, 3) * p0.x + 
                  3 * Math.pow(oneMinusT, 2) * t * p1.x + 
                  3 * oneMinusT * Math.pow(t, 2) * p2.x + 
                  Math.pow(t, 3) * p3.x;
                  
        const y = Math.pow(oneMinusT, 3) * p0.y + 
                  3 * Math.pow(oneMinusT, 2) * t * p1.y + 
                  3 * oneMinusT * Math.pow(t, 2) * p2.y + 
                  Math.pow(t, 3) * p3.y;
        
        return { x, y };
    }

    // Update edge label positions when nodes move
    updateEdgeLabelPositions() {
        (this.state.edges || []).forEach(edge => {
            const fromNode = this.state.nodes.find(n => n.id === edge.from);
            const toNode = this.state.nodes.find(n => n.id === edge.to);
            
            if (fromNode && toNode) {
                const textElement = this.grid.querySelector(`[data-edge-text="${edge.id}"]`);
                if (textElement) {
                    const portToSide = { 't': 'top', 'r': 'right', 'b': 'bottom', 'l': 'left' };
                    const fromSide = portToSide[edge.fromPort] || 'right';
                    const toSide = portToSide[edge.toPort] || 'left';
                    const fromPoint = this.getConnectionPoint(fromNode, fromSide);
                    const toPoint = this.getConnectionPoint(toNode, toSide);
                    
                    // Calculate proper midpoint (curve-aware)
                    const midpoint = this.getEdgeTextMidpoint(fromPoint, toPoint, edge);
                    
                    // Update position
                    textElement.style.left = `${midpoint.x}px`;
                    textElement.style.top = `${midpoint.y}px`;
                }
            }
        });
    }
    
    // Bind connection dots for line connector functionality
    bindConnectionDots(nodeEl, node) {
        const connectionDots = nodeEl.querySelectorAll('.connection-dot');
        
        connectionDots.forEach(dot => {
            const side = dot.getAttribute('data-side');
            
            dot.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                
                
                // Only start connection drag if not already in progress
                if (!this.connectionDrag || !this.connectionDrag.active) {
                    this.startConnectionDrag(node, side, e);
                }
            });
            
            // Improved hover feedback
            dot.addEventListener('mouseenter', () => {
                if (!this.isEditingText && (!this.connectionDrag || !this.connectionDrag.active)) {
                    dot.style.background = '#1ea1f2';
                    dot.style.transform = side === 'right' || side === 'left' 
                        ? 'translateY(-50%) scale(1.3)' 
                        : 'translateX(-50%) scale(1.3)';
                }
            });
            
            dot.addEventListener('mouseleave', () => {
                if (!this.isEditingText && !dot.classList.contains('connecting')) {
                    dot.style.background = '';
                    dot.style.transform = side === 'right' || side === 'left' 
                        ? 'translateY(-50%) scale(1)' 
                        : 'translateX(-50%) scale(1)';
                }
            });
        });
    }
    
    // Start connection drag from a connection dot
    startConnectionDrag(fromNode, fromSide, e) {
        if (this.isEditingText) return;
        
        // Clean up any existing connection drag
        if (this.connectionDrag) {
            this.cleanupConnectionDrag();
        }
        
        // Create bound handlers for proper cleanup
        const boundMoveHandler = this.handleConnectionDragMove.bind(this);
        const boundEndHandler = this.handleConnectionDragEnd.bind(this);
        
        this.connectionDrag = {
            fromNode: fromNode,
            fromSide: fromSide,
            active: true,
            previewLine: null,
            boundMoveHandler: boundMoveHandler,
            boundEndHandler: boundEndHandler
        };
        
        // Create preview line
        this.createConnectionPreview();
        
        // Bind mouse move and mouse up events
        document.addEventListener('mousemove', boundMoveHandler);
        document.addEventListener('mouseup', boundEndHandler);
        
        // Add visual feedback to the starting dot
        const fromNodeEl = this.grid.querySelector(`[data-id="${fromNode.id}"]`);
        const fromDot = fromNodeEl?.querySelector(`.connection-dot[data-side="${fromSide}"]`);
        if (fromDot) {
            fromDot.classList.add('connecting');
        }
    }
    
    // Handle connection drag movement
    handleConnectionDragMove(e) {
        if (!this.connectionDrag || !this.connectionDrag.active) return;
        
        // Update preview line
        this.updateConnectionPreview(e);
        
        // Check for valid drop targets
        this.updateConnectionTargets(e);
    }
    
    // Handle connection drag end
    handleConnectionDragEnd(e) {
        if (!this.connectionDrag || !this.connectionDrag.active) return;
        
        // Find target node and side
        const targetInfo = this.findConnectionTarget(e);
        
        if (targetInfo) {
            // Create connection
            this.createConnection(
                this.connectionDrag.fromNode,
                this.connectionDrag.fromSide,
                targetInfo.node,
                targetInfo.side
            );
        }
        
        // Clean up
        this.cleanupConnectionDrag();
    }
    
    // Create connection preview line
    createConnectionPreview() {
        if (!this.grid) return;
        
        // Remove existing preview
        const existingPreview = this.grid.querySelector('.connection-preview');
        if (existingPreview) {
            existingPreview.remove();
        }
        
        // Create preview SVG
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('connection-preview');
        svg.style.position = 'absolute';
        svg.style.top = '0';
        svg.style.left = '0';
        svg.style.width = '100%';
        svg.style.height = '100%';
        svg.style.pointerEvents = 'none';
        svg.style.zIndex = '1000';
        
        // Add minimal arrowhead marker for preview
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', 'preview-arrowhead');
        marker.setAttribute('markerWidth', '8');
        marker.setAttribute('markerHeight', '6');
        marker.setAttribute('refX', '7');
        marker.setAttribute('refY', '3');
        marker.setAttribute('orient', 'auto');
        marker.setAttribute('markerUnits', 'strokeWidth');
        marker.setAttribute('viewBox', '0 0 8 6');
        
        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', '0 1, 6 3, 0 5');
        polygon.setAttribute('fill', '#1ea1f2');
        polygon.setAttribute('stroke', 'none');
        
        marker.appendChild(polygon);
        defs.appendChild(marker);
        svg.appendChild(defs);
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#1ea1f2');
        path.setAttribute('stroke-width', '1');
        path.setAttribute('stroke-dasharray', '8,4');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('marker-end', 'url(#preview-arrowhead)');
        path.style.filter = 'drop-shadow(0 2px 6px rgba(30, 161, 242, 0.5))';
        
        svg.appendChild(path);
        this.grid.appendChild(svg);
        
        this.connectionDrag.previewLine = path;
    }
    
    // Update connection preview line
    updateConnectionPreview(e) {
        if (!this.connectionDrag || !this.connectionDrag.previewLine) return;
        
        const fromPoint = this.getConnectionPoint(this.connectionDrag.fromNode, this.connectionDrag.fromSide);
        const toPoint = this._pointerToGrid(e);
        
        const pathData = this.createPathData(fromPoint, toPoint, this.connectionDrag.fromSide, null);
        this.connectionDrag.previewLine.setAttribute('d', pathData);
    }
    
    // Update connection targets (highlight valid drop targets)
    updateConnectionTargets(e) {
        // Remove previous highlights
        const prevTargets = this.grid.querySelectorAll('.available-target');
        prevTargets.forEach(target => target.classList.remove('available-target'));
        
        // Find potential targets
        const targetInfo = this.findConnectionTarget(e);
        if (targetInfo) {
            const targetNodeEl = this.grid.querySelector(`[data-id="${targetInfo.node.id}"]`);
            const targetDot = targetNodeEl?.querySelector(`.connection-dot[data-side="${targetInfo.side}"]`);
            if (targetDot) {
                targetDot.classList.add('available-target');
            }
        }
    }
    
    // Find connection target at mouse position
    findConnectionTarget(e) {
        const element = document.elementFromPoint(e.clientX, e.clientY);
        const connectionDot = element?.closest('.connection-dot');
        
        if (connectionDot) {
            const nodeEl = connectionDot.closest('.flow-node');
            const nodeId = nodeEl?.getAttribute('data-id');
            const side = connectionDot.getAttribute('data-side');
            
            if (nodeId && side) {
                const node = this.state.nodes.find(n => n.id === nodeId);
                if (node && node.id !== this.connectionDrag.fromNode.id) {
                    return { node, side };
                }
            }
        }
        
        return null;
    }
    
    // Create connection between nodes
    createConnection(fromNode, fromSide, toNode, toSide) {
        // Map side names to port names for consistency
        const sideToPort = { 'top': 't', 'right': 'r', 'bottom': 'b', 'left': 'l' };
        const fromPort = sideToPort[fromSide] || 'r';
        const toPort = sideToPort[toSide] || 'l';
        
        // Check if connection already exists
        const existingConnection = (this.state.edges || []).find(edge => 
            edge.from === fromNode.id && edge.to === toNode.id &&
            edge.fromPort === fromPort && edge.toPort === toPort
        );
        
        if (existingConnection) {
            console.log('Connection already exists');
            return;
        }
        
        // Create new edge
        const edge = {
            id: this.generateId('edge'),
            from: fromNode.id,
            to: toNode.id,
            fromPort: fromPort,
            toPort: toPort,
            fromSide: fromSide,  // Keep for backward compatibility
            toSide: toSide       // Keep for backward compatibility
        };
        
        // Add to state
        this.state.edges.push(edge);
        
        // Save and render - use persist() to ensure proper multi-board synchronization
        this.pushHistory();
        this.persist(); // This will save to both single flow and boards storage
        this.renderEdgesOnly(); // This will now render text elements for all edges
        
        // Log connector creation for debugging
        console.log('Connector created:', {
            id: edge.id,
            from: edge.from,
            to: edge.to,
            fromPort: edge.fromPort,
            toPort: edge.toPort,
            totalConnectors: this.state.edges.length
        });
        
        // Visual feedback
        this.showConnectionSuccess();
    }
    // Clean up connection drag with improved state management
    cleanupConnectionDrag() {
        if (!this.connectionDrag) return;
        
        // Remove preview line
        const preview = this.grid.querySelector('.connection-preview');
        if (preview) {
            preview.remove();
        }
        
        // Remove visual feedback from starting dot
        const fromNodeEl = this.grid.querySelector(`[data-id="${this.connectionDrag.fromNode.id}"]`);
        const fromDot = fromNodeEl?.querySelector(`.connection-dot[data-side="${this.connectionDrag.fromSide}"]`);
        if (fromDot) {
            fromDot.classList.remove('connecting');
        }
        
        // Remove target highlights
        const targets = this.grid.querySelectorAll('.available-target');
        targets.forEach(target => target.classList.remove('available-target'));
        
        // Store bound functions for proper cleanup
        if (this.connectionDrag.boundMoveHandler) {
            document.removeEventListener('mousemove', this.connectionDrag.boundMoveHandler);
        }
        if (this.connectionDrag.boundEndHandler) {
            document.removeEventListener('mouseup', this.connectionDrag.boundEndHandler);
        }
        
        // Reset drag state
        this.connectionDrag = null;
    }
    
    // Show connection success feedback
    showConnectionSuccess() {
        // Create success toast
        const toast = document.createElement('div');
        toast.classList.add('success-toast');
        toast.textContent = 'Connection created successfully!';
        document.body.appendChild(toast);
        
        // Show toast
        setTimeout(() => toast.classList.add('show'), 100);
        
        // Hide toast
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }
    
    // Generate unique ID
    generateId(prefix) {
        return prefix + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
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
        
        // Add nodes to state
        this.pushHistory();
        this.state.nodes.push(startNode, stepNode, endNode);
        
        this.baseHeight = y + h + 400;
        this.persist();
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
        // Simple grid arrangement for nodes
        const nodes = [...this.state.nodes];
        const cols = Math.ceil(Math.sqrt(nodes.length));
        const nodeSpacing = 200;
        const startX = 80;
        const startY = 80;
        
        nodes.forEach((node, i) => {
            const row = Math.floor(i / cols);
            const col = i % cols;
            node.x = startX + col * nodeSpacing;
            node.y = startY + row * 120;
        });
        
        this.pushHistory();
        this.persist();
        this.render();
    }

    copySelection() {
        const selectedNodeEl = this.grid && this.grid.querySelector('.flow-node.selected');
        if (selectedNodeEl) {
            const id = selectedNodeEl.dataset.id;
            const node = this.state.nodes.find(n => n.id === id);
            if (node) this.clipboard = { type: 'node', data: JSON.parse(JSON.stringify(node)) };
        }
    }

    pasteSelection() {
        if (!this.clipboard) return;
        if (this.clipboard.type === 'node' && this.clipboard.data) {
            const base = this.clipboard.data;
            const copy = { ...base, id: generateId('node'), x: (base.x || 0) + 20, y: (base.y || 0) + 20 };
            this.pushHistory();
            this.state.nodes.push(copy);
            this.persist();
            this.render();
        }
    }
    
    // Cleanup method to remove event listeners
    cleanup() {
        // Remove keyboard event listener
        if (this.boundKeydown) {
            document.removeEventListener('keydown', this.boundKeydown);
        }
        
        // Remove wheel event listener for trackpad zoom
        if (this.boundWheel) {
            document.removeEventListener('wheel', this.boundWheel);
        }
        
        // Clean up drag manager
        if (this.dragManager) {
            this.dragManager.detach();
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
        
        // Check if clicking on a connector - if so, don't deselect
        const connectorEl = e.target.closest && e.target.closest('path[data-edge-id]');
        if (connectorEl) {
            return; // Let the connector handle its own selection
        }
        
        const nodeEl = e.target.closest && e.target.closest('.flow-node');
        if (!nodeEl) { 
            editor.deselectAll(); 
            return; 
        }
        const id = nodeEl.dataset.id;
        const node = editor.state.nodes.find(n => n.id === id);
        if (!node) return;
        
        // Select the node
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
        this.dragAnimationFrame = requestAnimationFrame(() => {
            this.updatePositionSmooth();
        });
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
            // Update connectors for final position using optimized method
            editor.scheduleConnectorUpdate(this.drag.id);
            try { editor.persist(); } catch {}
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
        const { node } = this.dragCache;
        if (!node) return;
        
        // Use current zoom level instead of cached zoom to handle zoom changes during drag
        const currentZoom = editor.zoom || 1;
        
        // Get fresh grid bounding rect to handle zoom changes
        const wrap = editor.grid.getBoundingClientRect();
        const rawLeft = (this.dragMousePos.clientX - wrap.left - this.drag.offsetX) / currentZoom;
        const rawTop = (this.dragMousePos.clientY - wrap.top - this.drag.offsetY) / currentZoom;

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
        // Optimize update frequency for better performance (33ms = ~30fps)
        const shouldUpdateByTime = (now - this.dragCache.lastUpdate) > 33;
        const lastPos = this.dragCache.lastEdgeUpdatePos || { x: node.x, y: node.y };
        const dx = node.x - lastPos.x;
        const dy = node.y - lastPos.y;
        // Balanced threshold for responsive updates without excessive calls
        const movedFar = (dx*dx + dy*dy) > 32;
        if (shouldUpdateByTime || movedFar) {
            this.dragCache.lastUpdate = now;
            this.dragCache.lastEdgeUpdatePos = { x: node.x, y: node.y };
            // Update connectors for the moving node using optimized method
            editor.scheduleConnectorUpdate(this.drag.id);
        }
    };
    
}

// Multi-board container: stacked independent canvases
class FlowBoards {
    constructor(flowType = null) {
        this.flowType = flowType || getCurrentFlowType();
        console.log(`Initializing FlowBoards with flow type: ${this.flowType}`);
        this.root = document.getElementById('flowBoards');
        this.boards = [];
        
        // Bind keyboard shortcuts for undo/redo
        this.bindKeyboardShortcuts();
        
        // If root doesn't exist yet, wait for it or create it
        if (!this.root) {
            console.warn('flowBoards element not found, attempting to render flow component first');
            if (window.Components && typeof window.Components.renderFlow === 'function') {
                window.Components.renderFlow('flowMount');
                this.root = document.getElementById('flowBoards');
            }
        }
        
        if (this.root) {
            this.loadSavedBoards();
        } else {
            console.error('Failed to initialize FlowBoards: flowBoards element not found');
        }
    }
    
    loadSavedBoards() {
        // Clear existing boards
        this.boards = [];
        if (this.root) {
            this.root.innerHTML = '';
        }
        
        // Load boards for this flow type
        const savedBoards = this.loadFlowBoardsByType(this.flowType);
        
        if (savedBoards.length > 0) {
            // Load saved boards
            savedBoards.forEach((boardData, index) => {
                this.addBoard(boardData);
            });
        }
        // Allow empty state - no automatic board creation
        this.renderEmptyStateIfNeeded();
    }
    
    loadFlowBoardsByType(flowType) {
        const key = flowType === 'as-is' ? 'jmAsIsFlow_boards' : 'jmToBeFlow_boards';
        console.log(`Loading ${flowType} flow data from key: ${key}`);
        
        try {
            const raw = localStorage.getItem(getScopedKey(key));
            const parsed = raw ? JSON.parse(raw) : null;
            if (Array.isArray(parsed)) {
                console.log(`Found ${parsed.length} boards for ${flowType} flow`);
                return parsed.map(board => ensureFlowDataStructure(board));
            }
            console.log(`No boards found for ${flowType} flow`);
            return [];
        } catch { return []; }
    }
    
    saveAllBoards() {
        const boardsData = this.boards.map(board => board.editor ? board.editor.state : null).filter(Boolean);
        this.saveFlowBoardsByType(this.flowType, boardsData);
    }
    
    saveFlowBoardsByType(flowType, boards) {
        const key = flowType === 'as-is' ? 'jmAsIsFlow_boards' : 'jmToBeFlow_boards';
        console.log(`Saving ${flowType} flow data to key: ${key} (${boards.length} boards)`);
        
        try {
            const payload = Array.isArray(boards) ? boards.map(board => ensureFlowDataStructure(board)) : [];
            localStorage.setItem(getScopedKey(key), JSON.stringify(payload));
            updateStorageUsage();
        } catch {}
    }

    ensureAtLeastOne() {
        if (!this.boards.length) this.addBoard();
    }

    renderEmptyStateIfNeeded() {
        if (this.boards.length === 0) {
            this.renderEmptyState();
        } else {
            this.hideEmptyState();
        }
    }

    renderEmptyState() {
        if (!this.root) return;
        
        // Clear any existing empty state
        const existingEmptyState = this.root.querySelector('.flow-empty-state');
        if (existingEmptyState) {
            existingEmptyState.remove();
        }
        
        // Create empty state UI
        const emptyStateDiv = document.createElement('div');
        emptyStateDiv.className = 'flow-empty-state';
        emptyStateDiv.innerHTML = `
            <div class="flow-empty-content">
                <div class="flow-empty-icon">📊</div>
                <h3>No Flow Boards Yet</h3>
                <p>Create your first flow board to start mapping your processes and workflows.</p>
                <button class="flow-create-first-board-btn" id="createFirstFlowBoard">
                    Create First Flow Board
                </button>
            </div>
        `;
        
        this.root.appendChild(emptyStateDiv);
        
        // Add event listener for create button
        const createBtn = emptyStateDiv.querySelector('#createFirstFlowBoard');
        if (createBtn) {
            createBtn.addEventListener('click', () => {
                this.addBoard();
                this.hideEmptyState();
            });
        }
    }

    hideEmptyState() {
        const emptyState = this.root?.querySelector('.flow-empty-state');
        if (emptyState) {
            emptyState.remove();
        }
    }

    addBoard(initialState = null) {
        const id = generateId('board');
        const wrap = document.createElement('div');
        
        // Apply alternating styling based on board count
        const isEven = this.boards.length % 2 === 0;
        const boardClass = isEven ? 'flow-board flow-board-even' : 'flow-board flow-board-odd';
        
        wrap.className = boardClass;
        // Tag the wrapper with its board id so FlowEditor can resolve per-board inputs
        wrap.setAttribute('data-board-id', id);
        
        // Generate title for this board
        const boardNumber = this.boards.length + 1;
        const boardTitle = `Flow ${boardNumber}`;
        
        wrap.innerHTML = `
            <div class="flow-board-title-container">
                <h3 class="flow-board-title" data-board-id="${id}" contenteditable="true">${boardTitle}</h3>
            </div>
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
                    <button class="btn btn-secondary icon-only" data-flow="overlay-add-start" title="Add start" aria-label="Add start">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <circle cx="12" cy="12" r="9" stroke="#333" stroke-width="1.5" fill="none"/>
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
                        <button class="btn btn-secondary icon-only" data-flow="overlay-more" title="Other options" aria-label="Other options">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                <circle cx="12" cy="5" r="2" fill="#333"/>
                                <circle cx="12" cy="12" r="2" fill="#333"/>
                                <circle cx="12" cy="19" r="2" fill="#333"/>
                            </svg>
                        </button>
                        <div class="export-menu" data-flow="overlay-more-menu">
                            <button class="export-option" data-flow="overlay-import-json">📥 Import JSON</button>
                            <hr style="margin: 8px 0; border: none; border-top: 1px solid #e0e0e0;">
                            <button class="export-option" data-flow="overlay-export-pdf">📄 Export as PDF</button>
                            <button class="export-option" data-flow="overlay-export-png">🖼️ Export as PNG (no bg)</button>
                            <button class="export-option" data-flow="overlay-export-json">🧾 Export as JSON</button>
                            <hr style="margin: 8px 0; border: none; border-top: 1px solid #e0e0e0;">
                            <button class="export-option" data-flow="overlay-delete-board">🗑️ Delete Flow Board</button>
                        </div>
                    </div>
                </div>
            </div>
            <input type="file" id="flowImportFile_${id}" accept="application/json,.json" style="display:none" />
            <div class="flow-canvas-wrap" style="position:relative;">
                <svg class="flow-svg" id="svg_${id}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Flow" style="position:absolute; left:0; top:0; z-index:1;"></svg>
                <div class="flow-grid" id="grid_${id}" style="position:relative; z-index:1;"></div>
            </div>
        `;
        this.root.appendChild(wrap);
        const editor = new FlowEditor({ root: wrap, initialState });
        this.boards.push({ id, wrap, editor });
        
        // Save all boards when a new board is added
        this.saveAllBoards();
        
        // Add event listeners for board title
        const titleElement = wrap.querySelector('.flow-board-title');
        if (titleElement) {
            let saveTimeout;
            
            const saveTitle = () => {
                const newTitle = titleElement.textContent.trim() || `Flow ${boardNumber}`;
                // Store title in the editor's state
                if (editor.state) {
                    editor.state.title = newTitle;
                    editor.persist();
                }
                // Save all boards when title changes
                this.saveAllBoards();
            };
            
            titleElement.addEventListener('input', () => {
                clearTimeout(saveTimeout);
                saveTimeout = setTimeout(saveTitle, 500); // Debounce saves
            });
            
            titleElement.addEventListener('blur', saveTitle);
            
            titleElement.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    titleElement.blur();
                }
            });
            
            // Add focus event to select all text when clicked
            titleElement.addEventListener('focus', () => {
                // Select all text when focused for easy deletion
                setTimeout(() => {
                    const selection = window.getSelection();
                    const range = document.createRange();
                    range.selectNodeContents(titleElement);
                    selection.removeAllRanges();
                    selection.addRange(range);
                }, 0);
            });
        }
        
        // Debug: Log toolbar creation
        console.log('Flow board created with toolbar:', {
            boardId: id,
            toolbar: !!wrap.querySelector('.flow-toolbar'),
            buttons: wrap.querySelectorAll('.flow-toolbar button').length,
            toolbarHTML: wrap.querySelector('.flow-toolbar')?.outerHTML?.substring(0, 200) + '...'
        });
        
        // Hide empty state since we now have a board
        this.hideEmptyState();
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
            
            // Save all boards after deletion
            this.saveAllBoards();
            
            // If no boards left, show empty state instead of removing flow area
            if (this.boards.length === 0) {
                this.renderEmptyState();
            }
        } catch (err) {
            console.error('Failed to remove board:', err);
        }
    }
}

// Extend FlowBoards with navbar proxy helpers
FlowBoards.prototype.getActiveEditor = function() {
    console.log('getActiveEditor called');
    console.log('Boards available:', this.boards ? this.boards.length : 0);
    
    // Return the last (most recent) board's editor
    if (!this.boards || this.boards.length === 0) {
        console.log('No boards available');
        return null;
    }
    const current = this.boards[this.boards.length - 1];
    console.log('Current board:', current);
    console.log('Current board has editor:', current && !!current.editor);
    
    return current && current.editor ? current.editor : null;
};

FlowBoards.prototype.saveVersion = function() {
    // Ensure there's at least one board before saving
    if (!this.boards || this.boards.length === 0) {
        console.log('No boards found, creating a new board for save');
        this.addBoard();
    }
    
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
    console.log('FlowBoards.deleteSelection called');
    console.log('Number of boards:', this.boards ? this.boards.length : 0);
    
    const editor = this.getActiveEditor && this.getActiveEditor();
    console.log('Active editor found:', !!editor);
    console.log('Editor has deleteSelection method:', editor && typeof editor.deleteSelection === 'function');
    
    if (editor && typeof editor.deleteSelection === 'function') {
        console.log('Calling editor.deleteSelection()');
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

FlowBoards.prototype.exportToPDF = function() {
    const editor = this.getActiveEditor && this.getActiveEditor();
    if (editor && typeof editor.exportToPDF === 'function') {
        return editor.exportToPDF();
    }
    console.warn('No active flow editor available for export PDF');
};

FlowBoards.prototype.exportToPNG = function() {
    const editor = this.getActiveEditor && this.getActiveEditor();
    if (editor && typeof editor.exportToPNG === 'function') {
        return editor.exportToPNG();
    }
    console.warn('No active flow editor available for export PNG');
};

FlowBoards.prototype.importJSONFile = function(file) {
    const editor = this.getActiveEditor && this.getActiveEditor();
    if (editor && typeof editor.importJSONFile === 'function') {
        return editor.importJSONFile(file);
    }
    console.warn('No active flow editor available for import JSON');
};

FlowBoards.prototype.importJSON = function() {
    const editor = this.getActiveEditor && this.getActiveEditor();
    if (editor && typeof editor.importJSON === 'function') {
        return editor.importJSON();
    }
    console.warn('No active flow editor available for import JSON');
};

FlowBoards.prototype.bindKeyboardShortcuts = function() {
    // Store the bound function so we can remove it later if needed
    this.boundKeydown = (e) => {
        // Check if user is editing text in a connector - if so, don't interfere
        const isEditingConnectorText = e.target && e.target.hasAttribute('data-edge-text') && e.target.hasAttribute('contenteditable');

        // Check if user is editing flow-board title - if so, don't interfere
        const isEditingFlowBoardTitle = e.target && e.target.classList.contains('flow-board-title') && e.target.hasAttribute('contenteditable');

        // If typing in any contenteditable element (e.g., project title), do not intercept
        const isEditingAnyContentEditable = e.target && (e.target.isContentEditable || (e.target.getAttribute && e.target.getAttribute('contenteditable') === 'true'));

        // Also do not intercept when typing in form fields (inputs/textareas or elements with role="textbox")
        const isFormField = e.target && (
            e.target.tagName === 'INPUT' || 
            e.target.tagName === 'TEXTAREA' || 
            e.target.getAttribute('role') === 'textbox'
        );

        // Debug: Log all keydown events to see what's happening
        if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
            console.log('FlowBoards keydown event captured:', {
                key: e.key,
                ctrlKey: e.ctrlKey,
                metaKey: e.metaKey,
                target: e.target,
                targetClass: e.target.className,
                isEditingConnectorText,
                isEditingFlowBoardTitle,
                isEditingAnyContentEditable,
                isFormField
            });
        }

        // Undo (Ctrl/Cmd + Z)
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !isEditingConnectorText && !isEditingFlowBoardTitle && !isFormField && !isEditingAnyContentEditable) {
            console.log('Ctrl+Z pressed - attempting undo via FlowBoards');
            this.undo();
            e.preventDefault();
        }
        // Redo (Ctrl/Cmd + Y)
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y' && !isEditingConnectorText && !isEditingFlowBoardTitle && !isFormField && !isEditingAnyContentEditable) {
            console.log('Ctrl+Y pressed - attempting redo via FlowBoards');
            this.redo();
            e.preventDefault();
        }
    };
    
    // Add the event listener
    document.addEventListener('keydown', this.boundKeydown);
    console.log('FlowBoards keyboard shortcuts bound');
};
// Global function to render projects in the sidebar
function renderProjects() {
    const listEl = document.getElementById('projectList');
    if (!listEl) return;
    
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
                if (window.flowEditor && window.flowEditor.boards && window.flowEditor.boards[0]) {
                    window.flowEditor.boards[0].editor.state = loadFlowData();
                    window.flowEditor.boards[0].editor.render();
                }
                // refresh cover data for new project
                refreshCoverUI();
                renderProjects();
                updateProjectNameHeading();
                updateStorageUsage();
            }
        });
    });
}

function setupProjectSidebar() {
    console.log('Setting up project sidebar...'); // Debug log
    const listEl = document.getElementById('projectList');
    const addBtn = document.getElementById('addProjectBtn');
    if (!listEl || !addBtn) {
        console.error('Missing elements: listEl =', listEl, 'addBtn =', addBtn); // Debug log
        return;
    }
    console.log('Project sidebar elements found, attaching event listeners...'); // Debug log

    addBtn.addEventListener('click', () => {
        openProjectCreationModal();
    });

    renderProjects();
}

// --- Project Creation Modal ---
function openProjectCreationModal() {
    const modal = document.getElementById('projectCreationModal');
    const input = document.getElementById('projectNameInput');
    if (modal && input) {
        modal.classList.add('show');
        input.value = 'Untitled Project';
        input.focus();
        input.select();
    }
}

function closeProjectCreationModal() {
    const modal = document.getElementById('projectCreationModal');
    if (modal) {
        modal.classList.remove('show');
    }
}

function createProject(name) {
    if (!name || !name.trim()) return;
    
    const projects = loadProjects();
    const id = generateId('proj');
    projects.unshift({ id, name: name.trim(), createdAt: new Date().toISOString() });
    saveProjects(projects);
    setCurrentProjectId(id);
    // initialize empty data for this project
    localStorage.setItem(getScopedKey(BASE_STORAGE_KEY, id), JSON.stringify([]));
    localStorage.setItem(getScopedKey(BASE_COVER_KEY, id), JSON.stringify({ image: '', title: '', description: '' }));
    localStorage.setItem(getScopedKey(BASE_FLOW_KEY, id), JSON.stringify({ nodes: [], sections: [], title: 'Flow 1' }));
    window.journey.journeyData = loadJourneyData();
    window.journey.renderJourneyMap();
    if (window.flowEditor && window.flowEditor.boards && window.flowEditor.boards[0]) {
        window.flowEditor.boards[0].editor.state = loadFlowData();
        window.flowEditor.boards[0].editor.render();
    }
    // refresh cover data for new project
    refreshCoverUI();
    renderProjects();
    updateProjectNameHeading();
    updateStorageUsage();
    renderSidebarBottom();
    console.log('New project created:', name, 'with ID:', id);
}

function setupProjectCreationModal() {
    const modal = document.getElementById('projectCreationModal');
    const form = document.getElementById('projectCreationForm');
    const input = document.getElementById('projectNameInput');
    const closeBtn = document.getElementById('closeProjectCreationModal');
    const cancelBtn = document.getElementById('cancelProjectCreation');
    
    if (!modal || !form || !input) return;
    
    // Form submission
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (name) {
            createProject(name);
            closeProjectCreationModal();
        }
    });
    
    // Close button
    if (closeBtn) {
        closeBtn.addEventListener('click', closeProjectCreationModal);
    }
    
    // Cancel button
    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeProjectCreationModal);
    }
    
    // Close on backdrop click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeProjectCreationModal();
        }
    });
    
    // Handle Enter key
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            form.dispatchEvent(new Event('submit'));
        }
    });
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
            theme: s.theme || 'light',
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
        const hasFlowContent = Array.isArray(flowData.nodes) && flowData.nodes.length;
        toc.querySelectorAll('.toc-subitem, .toc-item').forEach(btn => {
            const key = btn.getAttribute('data-target');
            const label = (btn.textContent || '').trim().toLowerCase();
            
            // Only enable these 4 specific features
            const enabledFeatures = ['personas', 'journey', 'as-is-flow', 'to-be-flow'];
            
            // Check if this is one of the enabled features
            if (enabledFeatures.includes(key)) {
                if (key === 'journey') {
                    if (hasJourneyContent) {
                        btn.classList.add('toc-available-content');
                    } else {
                        btn.classList.add('toc-available-empty');
                    }
                } else if (key === 'personas') {
                    const list = loadPersonasList();
                    const hasContent = list.some(p => !!(p.name || p.role || p.about || p.image || p.behaviors || p.frustrations || p.goals || p.tasks));
                    btn.classList.add(hasContent ? 'toc-available-content' : 'toc-available-empty');
                } else if (key === 'as-is-flow' || key === 'to-be-flow') {
                    if (hasFlowContent) {
                        btn.classList.add('toc-available-content');
                    } else {
                        btn.classList.add('toc-available-empty');
                    }
                }
                // Ensure enabled items are clickable
                btn.classList.remove('toc-unavailable');
                btn.removeAttribute('disabled');
                return;
            }
            
            // All other features are disabled
            btn.classList.add('toc-unavailable');
            try { btn.setAttribute('disabled', 'disabled'); } catch {}
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
    const asIsFlowBtn = toc.querySelector('[data-target="as-is-flow"]');
    const toBeFlowBtn = toc.querySelector('[data-target="to-be-flow"]');
    const personasBtn = toc.querySelector('[data-target="personas"]');
    const flowBtns = [asIsFlowBtn, toBeFlowBtn].filter(Boolean);
    const coverMount = document.getElementById('coverMount');
    const journeyMount = document.getElementById('journeyMount');
    const flowMount = document.getElementById('flowMount');
    const personasMount = document.getElementById('personasMount');
    const informationHierarchyMount = document.getElementById('informationHierarchyMount');
    const contentNav = document.getElementById('contentNavMount');

    // Disable all TOC items except the allowed ones
    const allowedTargets = new Set(['cover', 'personas', 'as-is-flow', 'to-be-flow', 'journey', 'information-hierarchy']);
    toc.querySelectorAll('.toc-item, .toc-subitem').forEach((btn) => {
        const target = btn.getAttribute('data-target');
        const isAllowed = target && allowedTargets.has(target);
        if (!isAllowed) {
            btn.classList.add('toc-unavailable');
            btn.setAttribute('disabled', '');
            btn.setAttribute('aria-disabled', 'true');
        } else {
            btn.classList.remove('toc-unavailable');
            btn.removeAttribute('disabled');
            btn.removeAttribute('aria-disabled');
        }
    });

    const activate = (key) => {
        try { localStorage.setItem(getScopedKey(BASE_ACTIVE_TAB_KEY), key); } catch {}
        if (key === 'cover') {
            if (coverMount) coverMount.style.display = 'block';
            if (journeyMount) journeyMount.style.display = 'none';
            if (flowMount) flowMount.style.display = 'none';
            if (personasMount) personasMount.style.display = 'none';
            if (informationHierarchyMount) informationHierarchyMount.style.display = 'none';
            if (contentNav) contentNav.style.display = 'block';
            // show cover has no custom navbar; reuse default
            if (window.Components && typeof window.Components.renderContentNavbar === 'function') {
                window.Components.renderContentNavbar('contentNavMount');
                setupContentNavScrollEffect();
            }
            // Setup cover feature functionality (including image upload)
            setupCoverFeature();
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
            if (personasMount) personasMount.style.display = 'none';
            if (informationHierarchyMount) informationHierarchyMount.style.display = 'none';
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
        } else if (key === 'as-is-flow' || key === 'to-be-flow') {
            if (coverMount) coverMount.style.display = 'none';
            if (journeyMount) journeyMount.style.display = 'none';
            if (flowMount) flowMount.style.display = 'block';
            if (personasMount) personasMount.style.display = 'none';
            if (informationHierarchyMount) informationHierarchyMount.style.display = 'none';
            if (contentNav) contentNav.style.display = 'block';
            
            // Ensure flow area is properly rendered and initialized
            const flowArea = flowMount && flowMount.querySelector('.flow-area');
            if (!flowArea && window.Components && typeof window.Components.renderFlow === 'function') {
                console.log('Rendering flow component...');
                window.Components.renderFlow('flowMount');
            }
            
            // Save current state before switching flow types
            if (window.flowEditor) {
                window.flowEditor.saveAllBoards();
            }
            
            // Create new flow editor instance to load correct data for the selected flow type
            const flowType = key === 'as-is-flow' ? 'as-is' : 'to-be';
            window.flowEditor = new FlowBoards(flowType);
            
            // Update navbar with correct title for the flow type
            // Pass the flowType directly to ensure correct title is shown immediately
            if (window.Components && typeof window.Components.renderFlowNavbar === 'function') {
                window.Components.renderFlowNavbar('contentNavMount', flowType);
                setupContentNavScrollEffect();
                // Delay binding to ensure DOM elements are rendered
                setTimeout(() => {
                    bindFlowNavbarActions();
                }, 100);
            }
            
            // Double-check that we have a working flow editor
            if (!window.flowEditor || !window.flowEditor.root) {
                console.warn('Flow editor initialization failed, retrying...');
                if (window.Components && typeof window.Components.renderFlow === 'function') {
                    window.Components.renderFlow('flowMount');
                }
                window.flowEditor = new FlowBoards(flowType);
            }
            
            // Allow empty state - don't auto-create boards
            console.log('Flow editor ready, allowing empty state');
            
            // Flow uses its own navbar
            if (window.Components && typeof window.Components.renderFlowNavbar === 'function') {
                window.Components.renderFlowNavbar('contentNavMount', flowType);
                setupContentNavScrollEffect();
                // Delay binding to ensure DOM elements are rendered
                setTimeout(() => {
                    bindFlowNavbarActions();
                }, 100);
            }
            
            // Update active states for flow tabs
            flowBtns.forEach(b => b.classList.remove('active'));
            if (key === 'as-is-flow') {
                asIsFlowBtn && asIsFlowBtn.classList.add('active');
            } else if (key === 'to-be-flow') {
                toBeFlowBtn && toBeFlowBtn.classList.add('active');
            }
            journeyBtn && journeyBtn.classList.remove('active');
            coverBtn && coverBtn.classList.remove('active');
            // Remove active from all other tabs
            toc.querySelectorAll('[data-target]').forEach(btn => {
                if (!['as-is-flow', 'to-be-flow'].includes(btn.getAttribute('data-target'))) {
                    btn.classList.remove('active');
                }
            });
        } else if (key === 'personas') {
            if (coverMount) coverMount.style.display = 'none';
            if (journeyMount) journeyMount.style.display = 'none';
            if (flowMount) flowMount.style.display = 'none';
            if (personasMount) personasMount.style.display = 'block';
            if (informationHierarchyMount) informationHierarchyMount.style.display = 'none';
            if (contentNav) contentNav.style.display = 'block';
            // Render navbar (reuse default) and personas component
            if (window.Components && typeof window.Components.renderContentNavbar === 'function') {
                window.Components.renderContentNavbar('contentNavMount', 'Persona');
                setupContentNavScrollEffect();
                
                // Setup persona-specific navbar functionality
                setupPersonaNavbar();
                
                // Additional retry for export functionality in case of timing issues
                setTimeout(() => {
                    setupPersonaNavbar();
                }, 500);
            }
            // Initialize personas with simplified system
            renderPersonasInterface();
            
            // Restore selected persona if any
                const selectedPersonaId = getSelectedPersonaId();
                if (selectedPersonaId) {
                updatePersonaActiveStates();
            }
            // Extra personas removed - simplified to single persona system
            // Add persona functionality removed - simplified to single persona system
            // Active state
            personasBtn && personasBtn.classList.add('active');
            ;[journeyBtn, coverBtn, asIsFlowBtn, toBeFlowBtn].filter(Boolean).forEach(b=>b.classList.remove('active'));
            toc.querySelectorAll('[data-target]').forEach(btn => { if (btn.getAttribute('data-target') !== 'personas') btn.classList.remove('active'); });
        } else if (key === 'information-hierarchy') {
            if (coverMount) coverMount.style.display = 'none';
            if (journeyMount) journeyMount.style.display = 'none';
            if (flowMount) flowMount.style.display = 'none';
            if (personasMount) personasMount.style.display = 'none';
            if (informationHierarchyMount) informationHierarchyMount.style.display = 'block';
            if (contentNav) contentNav.style.display = 'block';
            // Render navbar and information hierarchy component
            if (window.Components && typeof window.Components.renderContentNavbar === 'function') {
                window.Components.renderContentNavbar('contentNavMount', 'Information Hierarchy');
                setupContentNavScrollEffect();
                
                // Render information hierarchy interface
                renderInformationHierarchyInterface();

                // Bind add icon to create a fresh Information Hierarchy board
                const addIcon = document.getElementById('addColumnBtn');
                if (addIcon) {
                    addIcon.addEventListener('click', () => {
                        try { localStorage.removeItem(getScopedKey('ihData')); } catch {}
                        const ihMount = document.getElementById('informationHierarchyMount');
                        if (ihMount) ihMount.innerHTML = '';
                        renderInformationHierarchyInterface();
                        showSuccessToast('Created new Information Hierarchy board');
                    });
                }
            }
            
            // Update active states for the clicked tab
            toc.querySelectorAll('[data-target]').forEach(btn => {
                btn.classList.remove('active');
                if (btn.getAttribute('data-target') === key) {
                    btn.classList.add('active');
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
            if (personasMount) personasMount.style.display = 'none';
            if (informationHierarchyMount) informationHierarchyMount.style.display = 'none';
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
            // Block interaction for grey/unavailable items
            if (tab.classList.contains('toc-unavailable') || tab.hasAttribute('disabled')) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
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
        if (['cover','journey','as-is-flow','to-be-flow','personas'].includes(last)) activate(last);
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
    console.log('Save button found:', !!save);
    console.log('History button found:', !!historyBtn);
    console.log('Export button found:', !!exportBtn);
    console.log('Import button found:', !!importBtn);
    console.log('window.flowEditor:', !!window.flowEditor);
    console.log('window.flowEditor type:', typeof window.flowEditor);
    
    // If no buttons found, retry after a short delay
    if (!add && !save && !historyBtn && !exportBtn && !importBtn) {
        console.warn('No flow navbar buttons found, retrying in 200ms...');
        setTimeout(() => {
            bindFlowNavbarActions();
        }, 200);
        return;
    }
    
    if (!window.flowEditor) {
        console.warn('window.flowEditor not available, attempting to initialize...');
        // Try to initialize flow editor if not available
        const flowArea = document.getElementById('flowMount') && document.getElementById('flowMount').querySelector('.flow-area');
        if (flowArea) {
            const currentFlowType = getCurrentFlowType();
            window.flowEditor = new FlowBoards(currentFlowType);
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
            const currentFlowType = getCurrentFlowType();
            window.flowEditor = new FlowBoards(currentFlowType);
            if (window.flowEditor && typeof window.flowEditor.addBoard === 'function') {
                window.flowEditor.addBoard(emptyState);
            }
            console.log('Empty flow area and first empty board created.');
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
        console.log('Save button clicked');
        if (window.flowEditor && typeof window.flowEditor.saveVersion === 'function') {
            window.flowEditor.saveVersion();
        } else {
            console.warn('Flow editor not available for save');
        }
    });
    historyBtn && historyBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent delegated handler from also firing
        console.log('History button clicked');
        if (window.flowEditor && typeof window.flowEditor.openHistory === 'function') {
            window.flowEditor.openHistory();
        } else {
            console.warn('Flow editor not available for history');
        }
    });
    undo && undo.addEventListener('click', () => {
        console.log('Undo button clicked');
        if (window.flowEditor && typeof window.flowEditor.undo === 'function') {
            window.flowEditor.undo();
        } else {
            console.warn('Flow editor not available for undo');
        }
    });
    redo && redo.addEventListener('click', () => {
        console.log('Redo button clicked');
        if (window.flowEditor && typeof window.flowEditor.redo === 'function') {
            window.flowEditor.redo();
        } else {
            console.warn('Flow editor not available for redo');
        }
    });
    del && del.addEventListener('click', () => {
        console.log('Delete button clicked');
        if (window.flowEditor && typeof window.flowEditor.deleteSelection === 'function') {
            window.flowEditor.deleteSelection();
        } else {
            console.warn('Flow editor not available for delete');
        }
    });
    addArea && addArea.addEventListener('click', () => {
        console.log('Add area button clicked');
        if (window.flowEditor && typeof window.flowEditor.addAreaBelow === 'function') {
            window.flowEditor.addAreaBelow();
        } else {
            console.warn('Flow editor not available for add area');
        }
    });
    if (exportBtn && exportMenu) {
        console.log('Export button found, binding events');
        exportBtn.addEventListener('click', (e) => { 
            e.stopPropagation(); 
            console.log('Export button clicked');
            exportBtn.parentElement.classList.toggle('active'); 
        });
        document.addEventListener('click', () => exportBtn.parentElement.classList.remove('active'), { once: true });
        exportMenu.querySelectorAll('.export-option').forEach(opt => {
            opt.addEventListener('click', (e) => {
                const fmt = opt.getAttribute('data-format');
                console.log('Export option clicked:', fmt);
                if (window.flowEditor) {
                    if (fmt === 'json' && typeof window.flowEditor.exportJSON === 'function') {
                        window.flowEditor.exportJSON();
                    } else {
                        console.warn('Export function not available for format:', fmt);
                    }
                } else {
                    console.warn('Flow editor not available for export');
                }
            });
        });
    }
    if (importBtn && importFile) {
        console.log('Import button found, binding events');
        importBtn.addEventListener('click', () => {
            console.log('Import button clicked');
            try {
                // Clear any previous selection to ensure dialog opens
                importFile.value = '';
                importFile.click();
            } catch (error) {
                console.error('Error opening file dialog:', error);
                alert('Unable to open file selection dialog. Please try again.');
            }
        });
        importFile.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            console.log('Import file selected:', file ? file.name : 'none');
            
            if (!file) {
                console.log('No file selected');
                return;
            }
            
            // Try multiple import methods for better compatibility
            let importSuccessful = false;
            
            // Method 1: Try window.flowEditor
            if (window.flowEditor && typeof window.flowEditor.importJSONFile === 'function') {
                try {
                    window.flowEditor.importJSONFile(file);
                    importSuccessful = true;
                    console.log('Import successful via window.flowEditor');
                } catch (error) {
                    console.warn('Import failed via window.flowEditor:', error);
                }
            }
            
            // Method 2: Try FlowBoards instance
            if (!importSuccessful && window.flowBoards && typeof window.flowBoards.importJSONFile === 'function') {
                try {
                    window.flowBoards.importJSONFile(file);
                    importSuccessful = true;
                    console.log('Import successful via window.flowBoards');
                } catch (error) {
                    console.warn('Import failed via window.flowBoards:', error);
                }
            }
            
            // Method 3: Try active editor
            if (!importSuccessful && window.flowEditor && window.flowEditor.boards && window.flowEditor.boards.length > 0) {
                try {
                    const activeEditor = window.flowEditor.boards[0].editor;
                    if (activeEditor && typeof activeEditor.importJSONFile === 'function') {
                        activeEditor.importJSONFile(file);
                        importSuccessful = true;
                        console.log('Import successful via active editor');
                    }
                } catch (error) {
                    console.warn('Import failed via active editor:', error);
                }
            }
            
            if (!importSuccessful) {
                console.error('All import methods failed');
                alert('Import failed: No active flow editor available. Please ensure you have a flow board open.');
            }
            
            // Reset the input so the same file can be selected again
            e.target.value = '';
        });
    }
    if (exampleBtn) {
        exampleBtn.addEventListener('click', () => {
            try {
                if (!window.flowEditor || !window.flowEditor.boards || !window.flowEditor.boards.length) return;
                const editor = window.flowEditor.boards[0].editor;
                if (!editor) return;
                editor.state.nodes = [];
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
            window.flowEditor = new FlowBoards('as-is');
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

// Note: Manual fix handlers removed - using proper direct handlers instead

// Global function to test 3 dots button functionality
window.testThreeDotsButton = function() {
    console.log('=== TESTING 3 DOTS BUTTON ===');
    
    const allThreeDotsButtons = document.querySelectorAll('button[data-flow="overlay-more"]');
    console.log('Found', allThreeDotsButtons.length, '3 dots buttons');
    
    if (allThreeDotsButtons.length === 0) {
        console.error('No 3 dots buttons found!');
        return;
    }
    
    const firstButton = allThreeDotsButtons[0];
    console.log('Testing first button:', firstButton);
    
    // Simulate a click
    console.log('Simulating click on first button...');
    firstButton.click();
    
    // Check if menu appeared
    setTimeout(() => {
        const menu = firstButton.parentElement.querySelector('[data-flow="overlay-more-menu"]');
        if (menu) {
            const isVisible = menu.style.display === 'block';
            console.log('Menu visibility after click:', isVisible);
            if (isVisible) {
                console.log('✅ 3 dots button is working!');
            } else {
                console.log('❌ 3 dots button clicked but menu not visible');
            }
        } else {
            console.log('❌ Menu element not found');
        }
    }, 100);
};

// Enhanced individual board export function
window.exportIndividualBoard = function(boardId, format = 'json') {
    console.log(`=== EXPORTING INDIVIDUAL BOARD ${boardId} as ${format} ===`);
    
    if (!window.flowEditor) {
        console.error('Flow editor not available');
        return;
    }
    
    const board = window.flowEditor.boards.find(b => b.id === boardId);
    if (!board || !board.editor) {
        console.error(`Board ${boardId} not found or has no editor`);
        return;
    }
    
    const editor = board.editor;
    console.log('Found board editor:', editor);
    
    switch (format) {
        case 'json':
            if (typeof editor.exportJSON === 'function') {
                editor.exportJSON();
                console.log('✅ JSON export initiated');
            } else {
                console.error('exportJSON method not available');
            }
            break;
        case 'pdf':
            if (typeof editor.exportToPDF === 'function') {
                editor.exportToPDF();
                console.log('✅ PDF export initiated');
            } else {
                console.error('exportToPDF method not available');
            }
            break;
        case 'png':
            if (typeof editor.exportToPNG === 'function') {
                editor.exportToPNG();
                console.log('✅ PNG export initiated');
            } else {
                console.error('exportToPNG method not available');
            }
            break;
        default:
            console.error('Unsupported export format:', format);
    }
};

// Auto-fix 3 dots buttons when flow boards are created
const originalAddBoard = FlowBoards.prototype.addBoard;
FlowBoards.prototype.addBoard = function(initialState) {
    const result = originalAddBoard.call(this, initialState);
    
    // Note: 3-dots buttons are now handled by direct event listeners in FlowEditor
    console.log('Board created - 3-dots buttons handled by FlowEditor direct handlers');
    
    return result;
};
// bindFlowActionBar removed (reverted)

function refreshCoverUI() {
    const uploadArea = document.getElementById('coverUploadArea');
    const previewWrap = document.getElementById('coverImagePreview');
    const previewImg = document.getElementById('coverImageEl');
    const titleInput = document.getElementById('coverTitle');
    const descInput = document.getElementById('coverDescription');

    if (!uploadArea || !previewWrap || !previewImg || !titleInput || !descInput) {
        console.warn('Cover elements not found for refresh');
        return;
    }

    // Load and display current project's cover data
    const data = loadCoverData();
    titleInput.value = data.title || '';
    descInput.value = data.description || '';
    if (data.image) {
        // Force image reload by clearing src first, then setting it
        previewImg.src = '';
        // Use setTimeout to ensure the src is cleared before setting new one
        setTimeout(() => {
            previewImg.src = data.image;
        }, 10);
        previewWrap.style.display = 'block';
        uploadArea.style.display = 'none';
    } else {
        previewImg.src = '';
        previewWrap.style.display = 'none';
        uploadArea.style.display = 'block';
    }
}

function setupCoverFeature() {
    const uploadArea = document.getElementById('coverUploadArea');
    const fileInput = document.getElementById('coverImageInput');
    const previewWrap = document.getElementById('coverImagePreview');
    const previewImg = document.getElementById('coverImageEl');
    const hoverRemoveBtn = document.getElementById('hoverRemoveCoverImageBtn');
    const titleInput = document.getElementById('coverTitle');
    const descInput = document.getElementById('coverDescription');

    if (!uploadArea || !fileInput || !previewWrap || !previewImg || !hoverRemoveBtn || !titleInput || !descInput) {
        console.warn('Cover elements not found');
        return;
    }

    // Prevent duplicate event listeners by removing existing ones first
    if (uploadArea._coverEventListenersAdded) {
        console.log('Cover feature already initialized, refreshing UI only');
        refreshCoverUI();
        return;
    }
    uploadArea._coverEventListenersAdded = true;

    // Initialize from storage
    refreshCoverUI();

    // Helper functions
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
        if (!allowed.includes(file.type)) { 
            alert('Please select a valid image (JPG, PNG, GIF, WebP).'); 
            return false; 
        }
        if (file.size > maxSize) { 
            alert('File size must be less than 5MB.'); 
            return false; 
        }
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

    // File upload handling
    const handleFileSelect = (file) => {
        if (!file || !validateImage(file)) return;

        compressImageFile(file).then((imageData) => {
            previewImg.src = imageData;
            previewWrap.style.display = 'block';
            uploadArea.style.display = 'none';
            
            // Save to storage
            const currentData = loadCoverData();
            currentData.image = imageData;
            currentData.title = titleInput.value;
            currentData.description = descInput.value;
            saveCoverData(currentData);
        }).catch(() => {
            // Fallback to uncompressed
            const reader = new FileReader();
            reader.onload = (e) => {
                const imageData = e.target.result;
                previewImg.src = imageData;
                previewWrap.style.display = 'block';
                uploadArea.style.display = 'none';
                
                // Save to storage
                const currentData = loadCoverData();
                currentData.image = imageData;
                currentData.title = titleInput.value;
                currentData.description = descInput.value;
                saveCoverData(currentData);
            };
            reader.readAsDataURL(file);
        });
    };

    // Upload area click
    uploadArea.addEventListener('click', () => {
        fileInput.click();
    });
    
    // File input change
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            handleFileSelect(file);
        }
    });

    // Drag and drop on upload area
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = 'rgba(255, 255, 255, 0.8)';
        uploadArea.style.background = 'rgba(255, 255, 255, 0.3)';
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.style.borderColor = 'rgba(255, 255, 255, 0.5)';
        uploadArea.style.background = 'rgba(255, 255, 255, 0.1)';
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = 'rgba(255, 255, 255, 0.5)';
        uploadArea.style.background = 'rgba(255, 255, 255, 0.1)';
        const file = e.dataTransfer.files[0];
        if (file) {
            handleFileSelect(file);
        }
    });

    // Hover remove icon button
    hoverRemoveBtn.addEventListener('click', () => {
        previewWrap.style.display = 'none';
        uploadArea.style.display = 'block';
        previewImg.src = '';
        
        // Save to storage
        const currentData = loadCoverData();
        currentData.image = '';
        currentData.title = titleInput.value;
        currentData.description = descInput.value;
        saveCoverData(currentData);
    });

    // Auto-save on title/description change
    const saveData = debounce(() => {
        const currentData = loadCoverData();
        currentData.title = titleInput.value;
        currentData.description = descInput.value;
        saveCoverData(currentData);
    }, 300);

    titleInput.addEventListener('input', saveData);
    descInput.addEventListener('input', saveData);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + U to open upload
        if ((e.ctrlKey || e.metaKey) && e.key === 'u') {
            e.preventDefault();
            fileInput.click();
        }
    });

    console.log('Cover photo feature initialized successfully');
}
function setupProjectCollapse() {
    const sidebar = document.getElementById('projectSidebar');
    const toggleBtn = document.getElementById('toggleProjectSidebar');
    if (!sidebar || !toggleBtn) {
        console.warn('Project collapse setup failed: sidebar or toggle button not found', { sidebar: !!sidebar, toggleBtn: !!toggleBtn });
        return;
    }
    console.log('Project collapse setup successful');
    
    // Create collapsed project name element
    const collapsedProjectName = document.createElement('div');
    collapsedProjectName.className = 'collapsed-project-name';
    collapsedProjectName.style.display = 'none';
    sidebar.appendChild(collapsedProjectName);
    
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
        // Ensure sidebar is not collapsed by default for better UX
        if (s.sidebarCollapsed === undefined && !localStorage.getItem('uiSidebarCollapsed')) {
            initialCollapsed = false;
        }
        sidebar.classList.toggle('collapsed', initialCollapsed);
        document.body.classList.toggle('sidebar-collapsed', initialCollapsed);
        const width = initialCollapsed ? '0px' : '260px';
        document.body.style.setProperty('--sidebar-current-width', width);
        
        // Update collapsed project name visibility
        if (initialCollapsed) {
            updateCollapsedProjectName();
        } else {
            // Hide collapsed project name when not collapsed
            collapsedProjectName.style.display = 'none';
        }
    } catch {}
    
    // Handle toggle button click
    const handleToggleClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Toggle button clicked, current state:', document.body.classList.contains('sidebar-collapsed'));
        
        const isCollapsed = sidebar.classList.toggle('collapsed');
        document.body.classList.toggle('sidebar-collapsed', isCollapsed);
        // Update CSS variable for smooth layout shift
        const width = isCollapsed ? '0px' : '260px';
        document.body.style.setProperty('--sidebar-current-width', width);
        
        // Update collapsed project name visibility
        if (isCollapsed) {
            updateCollapsedProjectName();
        } else {
            // Hide collapsed project name when expanded
            const collapsedProjectName = sidebar.querySelector('.collapsed-project-name');
            if (collapsedProjectName) {
                collapsedProjectName.style.display = 'none';
            }
        }
        
        // Persist state per project in settings
        try {
            saveSettings({ sidebarCollapsed: isCollapsed });
            // Also persist a global fallback for early-boot usage and cross-project consistency
            localStorage.setItem('uiSidebarCollapsed', String(isCollapsed));
        } catch {}
        
        console.log('Toggle completed, new state:', isCollapsed ? 'collapsed' : 'expanded');
    };
    
    // Add multiple event listeners to ensure it works
    toggleBtn.addEventListener('click', handleToggleClick);
    toggleBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        handleToggleClick(e);
    });
    
    // Make toggle function globally accessible for debugging
    window.toggleSidebar = () => {
        console.log('Manual toggle called');
        handleToggleClick({ preventDefault: () => {}, stopPropagation: () => {} });
    };
    
    // Handle expand click on collapsed sidebar header (when visible)
    sidebar.addEventListener('click', (e) => {
        if (document.body.classList.contains('sidebar-collapsed') && 
            e.target.closest('.sidebar-header')) {
            // Toggle sidebar when clicking on collapsed header
            toggleBtn.click();
        }
    });
    
    // Handle expand button click
    const expandBtn = document.getElementById('expandSidebarBtn');
    if (expandBtn) {
        expandBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleBtn.click();
        });
    }
    
    // Add tooltip to collapsed sidebar header
    sidebar.addEventListener('mouseenter', (e) => {
        if (document.body.classList.contains('sidebar-collapsed')) {
            const header = sidebar.querySelector('.sidebar-header');
            if (header && !header.getAttribute('title')) {
                header.setAttribute('title', 'Click to expand sidebar');
            }
        }
    });
    
    // Function to update collapsed project name
    function updateCollapsedProjectName() {
        try {
            const currentId = getCurrentProjectId();
            const projects = loadProjects();
            const current = projects.find(p => p.id === currentId);
            const projectName = current ? current.name : 'Project';
            
            // Truncate name if too long
            const truncatedName = projectName.length > 8 ? 
                projectName.substring(0, 8) + '...' : projectName;
            
            collapsedProjectName.textContent = truncatedName;
            collapsedProjectName.style.display = 'block';
        } catch (error) {
            console.error('Error updating collapsed project name:', error);
            collapsedProjectName.style.display = 'none';
        }
    }
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
    const exportJSONBtn = document.getElementById('tocExportJSONBtn');
    const exportPDFBtn = document.getElementById('tocExportPDFBtn');
    const exportPNGBtn = document.getElementById('tocExportPNGBtn');
    const exportJPEGBtn = document.getElementById('tocExportJPEGBtn');
    
    if (!btn || !dropdown || !menu || !deleteBtn) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        console.log('TOC Menu button clicked, toggling dropdown');
        dropdown.classList.toggle('active');
    });
    
    document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target)) dropdown.classList.remove('active');
    });
    
    // Delete project functionality
    deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.journey && typeof window.journey.deleteCurrentProject === 'function') {
            window.journey.deleteCurrentProject();
        }
        dropdown.classList.remove('active');
    });
    
    // Export functionality - determine current context and use appropriate export function
    function getCurrentContext() {
        const activeTocItem = document.querySelector('.toc-item.active, .toc-subitem.active');
        if (activeTocItem) {
            const target = activeTocItem.getAttribute('data-target');
            if (target === 'as-is-flow' || target === 'to-be-flow') {
                return 'flow';
            } else if (target === 'personas') {
                return 'persona';
            } else if (target === 'journey') {
                return 'journey';
            }
        }
        return 'journey'; // default to journey
    }
    
    function handleExport(format) {
        const context = getCurrentContext();
        console.log(`TOC Menu: Exporting ${format} for context: ${context}`);
        console.log('Available objects:', {
            flowEditor: !!window.flowEditor,
            journey: !!window.journey,
            exportPersonasAsPNG: typeof exportPersonasAsPNG,
            exportPersonasAsCSV: typeof exportPersonasAsCSV
        });
        
        dropdown.classList.remove('active');
        
        if (context === 'flow' && window.flowEditor) {
            // Use flow editor export functions
            switch (format) {
                case 'json':
                    if (typeof window.flowEditor.exportJSON === 'function') {
                        window.flowEditor.exportJSON();
                    }
                    break;
                case 'pdf':
                    if (typeof window.flowEditor.exportToPDF === 'function') {
                        window.flowEditor.exportToPDF();
                    }
                    break;
                case 'png':
                    if (typeof window.flowEditor.exportToPNG === 'function') {
                        window.flowEditor.exportToPNG();
                    }
                    break;
                case 'jpeg':
                    // JPEG export for flow boards
                    if (typeof window.flowEditor.exportToPNG === 'function') {
                        window.flowEditor.exportToPNG(); // Use PNG as fallback for JPEG
                    }
                    break;
            }
        } else if (context === 'persona') {
            // Persona exports
            switch (format) {
                case 'json': {
                    const personasData = window.loadPersonas ? window.loadPersonas() : [];
                    const jsonData = JSON.stringify(personasData, null, 2);
                    const blob = new Blob([jsonData], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `personas-${new Date().toISOString().slice(0, 10)}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                    break;
                }
                case 'pdf':
                    if (typeof exportPersonasAsPDF === 'function') {
                        exportPersonasAsPDF();
                    }
                    break;
                case 'png':
                    if (typeof exportPersonasAsPNGZip === 'function') {
                        exportPersonasAsPNGZip();
                    }
                    break;
                case 'jpeg':
                    if (typeof exportPersonasAsJPEGZip === 'function') {
                        exportPersonasAsJPEGZip();
                    }
                    break;
            }
        } else if (context === 'journey' && window.journey) {
            // Use journey map export functions
            switch (format) {
                case 'json':
                    // For JSON export, use CSV export as alternative
                    if (typeof window.journey.exportToCSV === 'function') {
                        window.journey.exportToCSV();
                    }
                    break;
                case 'pdf':
                    if (typeof window.journey.exportToPDF === 'function') {
                        window.journey.exportToPDF();
                    }
                    break;
                case 'png':
                    if (typeof window.journey.exportToPNG === 'function') {
                        window.journey.exportToPNG();
                    }
                    break;
                case 'jpeg':
                    if (typeof window.journey.exportToJPEGAsZIP === 'function') {
                        window.journey.exportToJPEGAsZIP();
                    } else if (typeof window.journey.exportToJPEG === 'function') {
                        window.journey.exportToJPEG();
                    }
                    break;
            }
        } else {
            console.warn(`No export function available for context: ${context}, format: ${format}`);
        }
    }
    
    // Add event listeners for export buttons
    if (exportJSONBtn) {
        exportJSONBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleExport('json');
        });
    }
    
    if (exportPDFBtn) {
        exportPDFBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleExport('pdf');
        });
    }
    
    if (exportPNGBtn) {
        exportPNGBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleExport('png');
        });
    }
    
    if (exportJPEGBtn) {
        exportJPEGBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleExport('jpeg');
        });
    }
}

function setupProjectNameHeading() {
    const h2 = document.getElementById('projectNameHeading');
    if (!h2) return;
    h2.contentEditable = 'true';
    h2.setAttribute('spellcheck', 'false');
    h2.setAttribute('title', 'Click to rename project');

    const commitName = () => {
        const raw = (h2.textContent || '').trim();
        const projects = loadProjects();
        const currentId = getCurrentProjectId();
        const idx = projects.findIndex(p => p.id === currentId);
        // Allow empty project name to be saved (user can fully delete the text)
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
        // Prevent bubbling so global shortcuts don't capture Backspace/Delete while editing title
        e.stopPropagation();
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

// Global debug function for flow toolbar
window.debugFlowToolbar = function() {
    console.log('=== Flow Toolbar Debug ===');
    console.log('window.flowEditor exists:', !!window.flowEditor);
    console.log('window.flowEditor.boards:', window.flowEditor?.boards?.length || 0);
    
    if (window.flowEditor && window.flowEditor.boards && window.flowEditor.boards.length > 0) {
        const currentBoard = window.flowEditor.boards[window.flowEditor.boards.length - 1];
        console.log('Current board:', currentBoard);
        
        if (currentBoard && currentBoard.wrap) {
            const toolbar = currentBoard.wrap.querySelector('.flow-toolbar');
            console.log('Toolbar found:', !!toolbar);
            if (toolbar) {
                console.log('Toolbar buttons:', toolbar.querySelectorAll('button').length);
                console.log('Toolbar HTML:', toolbar.outerHTML);
            }
        }
        
        if (currentBoard && currentBoard.editor) {
            console.log('Testing toolbar with editor...');
            currentBoard.editor.testToolbar();
        }
    } else {
        console.log('No flow boards found. Try clicking on a flow section in the TOC first.');
    }
};

// Comprehensive flow section test
window.testFlowSection = function() {
    console.log('=== Comprehensive Flow Section Test ===');
    
    // Step 1: Check if flow mount exists
    const flowMount = document.getElementById('flowMount');
    console.log('1. Flow mount element exists:', !!flowMount);
    if (flowMount) {
        console.log('   - Display style:', flowMount.style.display);
        console.log('   - Has children:', flowMount.children.length > 0);
    }
    
    // Step 2: Check if components are available
    console.log('2. Components available:', !!window.Components);
    console.log('   - renderFlow function:', typeof window.Components?.renderFlow);
    console.log('   - renderFlowNavbar function:', typeof window.Components?.renderFlowNavbar);
    
    // Step 3: Check current flow editor state
    console.log('3. Flow editor state:');
    console.log('   - window.flowEditor exists:', !!window.flowEditor);
    if (window.flowEditor) {
        console.log('   - boards count:', window.flowEditor.boards?.length || 0);
        console.log('   - root element:', !!window.flowEditor.root);
    }
    
    // Step 4: Try to manually activate flow section
    console.log('4. Attempting manual flow section activation...');
    try {
        // Find and click a flow button
        const flowButtons = document.querySelectorAll('[data-target="as-is-flow"], [data-target="to-be-flow"]');
        console.log('   - Found flow buttons:', flowButtons.length);
        
        if (flowButtons.length > 0) {
            console.log('   - Clicking first flow button...');
            flowButtons[0].click();
            
            // Wait a bit and check again
            setTimeout(() => {
                console.log('5. After activation:');
                console.log('   - Flow mount display:', document.getElementById('flowMount')?.style.display);
                console.log('   - Flow editor exists:', !!window.flowEditor);
                console.log('   - Flow boards count:', window.flowEditor?.boards?.length || 0);
                
                if (window.flowEditor && window.flowEditor.boards && window.flowEditor.boards.length > 0) {
                    const board = window.flowEditor.boards[0];
                    const toolbar = board.wrap?.querySelector('.flow-toolbar');
                    console.log('   - Toolbar exists:', !!toolbar);
                    if (toolbar) {
                        console.log('   - Toolbar buttons:', toolbar.querySelectorAll('button').length);
                    }
                }
            }, 1000);
        } else {
            console.log('   - No flow buttons found in TOC');
        }
    } catch (error) {
        console.error('   - Error during activation:', error);
    }
};

// Manual flow activation function
window.activateFlowSection = function() {
    console.log('=== Manual Flow Section Activation ===');
    
    try {
        // Step 1: Ensure flow mount is visible
        const flowMount = document.getElementById('flowMount');
        if (!flowMount) {
            console.error('Flow mount element not found!');
            return;
        }
        
        // Hide other sections
        const coverMount = document.getElementById('coverMount');
        const journeyMount = document.getElementById('journeyMount');
        const contentNav = document.getElementById('contentNavMount');
        
        if (coverMount) coverMount.style.display = 'none';
        if (journeyMount) journeyMount.style.display = 'none';
        if (contentNav) contentNav.style.display = 'block';
        
        // Show flow section
        flowMount.style.display = 'block';
        console.log('Flow mount made visible');
        
        // Step 2: Render flow component if needed
        const flowArea = flowMount.querySelector('.flow-area');
        if (!flowArea && window.Components && typeof window.Components.renderFlow === 'function') {
            console.log('Rendering flow component...');
            window.Components.renderFlow('flowMount');
        }
        
        // Step 3: Initialize flow editor if needed
        if (!window.flowEditor) {
            console.log('Initializing flow editor...');
            window.flowEditor = new FlowBoards('as-is');
        }
        
        // Step 4: Allow empty state - don't auto-create boards
        console.log('Flow editor ready, allowing empty state');
        
        // Step 5: Render flow navbar
        if (window.Components && typeof window.Components.renderFlowNavbar === 'function') {
            console.log('Rendering flow navbar...');
            window.Components.renderFlowNavbar('contentNavMount', 'as-is');
        }
        
        // Step 6: Check results
        setTimeout(() => {
            console.log('=== Activation Results ===');
            console.log('Flow editor exists:', !!window.flowEditor);
            console.log('Flow boards count:', window.flowEditor?.boards?.length || 0);
            
            if (window.flowEditor && window.flowEditor.boards && window.flowEditor.boards.length > 0) {
                const board = window.flowEditor.boards[0];
                const toolbar = board.wrap?.querySelector('.flow-toolbar');
                console.log('Toolbar exists:', !!toolbar);
                if (toolbar) {
                    console.log('Toolbar buttons:', toolbar.querySelectorAll('button').length);
                    console.log('✅ Flow section activated successfully!');
                } else {
                    console.log('❌ Toolbar not found in flow board');
                }
            } else {
                console.log('❌ No flow boards created');
            }
        }, 500);
        
    } catch (error) {
        console.error('Error during manual activation:', error);
    }
};

// Note: Global event listener removed - using direct handlers instead