/* =============================================================
 * OmniParse IDP Engine Logic
 * Client-Side Parser, TF-IDF Cog-Search, and SheetJS Export
 * ============================================================= */

// Configure PDF.js Worker safely
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
}

// Preloaded Sichuan Honghua EXAMPLE_EQUIPMENT_DO_NOT_COPY High-Fidelity Dataset
let maintenanceRegistry = [];
let sparePartsRegistry = [];
let troubleshootingRegistry = [];
let activeRegistryTab = "maintenance"; // "maintenance", "spare_parts", "troubleshooting"

// Document storage for contextual searches
let loadedPages = []; 

// Initialize document loading with preloaded drawworks manual text (for chatbot)
function initPreloadedContext() {
  loadedPages = [];
}

// Global active filters
let currentTabFilter = "all";
let currentSearchQuery = "";
let highlightRecordIds = [];

// Globals to store actively filtered data for Excel export
let filteredMaintenance = [];
let filteredSpareParts = [];
let filteredTroubleshooting = [];

// Safe Lucide icon rendering wrapper
function safeCreateIcons() {
  if (typeof lucide !== 'undefined' && lucide.createIcons) {
    lucide.createIcons();
  }
}

// DOM Elements
const maintenanceTable = document.getElementById("maintenance-table");
const sparePartsTable = document.getElementById("spare-parts-table");
const troubleshootingTable = document.getElementById("troubleshooting-table");
const maintenanceTableBody = document.getElementById("maintenance-table-body");
const sparePartsTableBody = document.getElementById("spare-parts-table-body");
const troubleshootingTableBody = document.getElementById("troubleshooting-table-body");
const registryModeTabs = document.getElementById("registry-mode-tabs");
const tableEmpty = document.getElementById("table-empty");
const countRules = document.getElementById("count-rules");
const countParts = document.getElementById("count-parts");
const countConsumables = document.getElementById("count-consumables");
const countTime = document.getElementById("count-time");
const countTroubleshooting = document.getElementById("count-troubleshooting");
const filterTabs = document.getElementById("filter-tabs");
const gridSearch = document.getElementById("grid-search");
const addRowBtn = document.getElementById("add-row-btn");
const exportBtn = document.getElementById("export-btn");
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const browseBtn = document.getElementById("browse-btn");
const pageRangeStartInput = document.getElementById("page-range-start");
const pageRangeEndInput = document.getElementById("page-range-end");
const progressOverlay = document.getElementById("progress-overlay");
const progressFill = document.getElementById("progress-fill");
const progressTitle = document.getElementById("progress-title");
const progressStatus = document.getElementById("progress-status");
const activeDocName = document.getElementById("active-doc-name");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatMessages = document.getElementById("chat-messages");

// Registry Mode Switching Listener
if (registryModeTabs) {
  registryModeTabs.addEventListener("click", (e) => {
    const tabBtn = e.target.closest(".mode-tab-btn");
    if (!tabBtn) return;
    
    document.querySelectorAll(".mode-tab-btn").forEach(btn => btn.classList.remove("active"));
    tabBtn.classList.add("active");
    activeRegistryTab = tabBtn.getAttribute("data-mode");
    
    if (activeRegistryTab === "maintenance") {
      maintenanceTable.style.display = "table";
      sparePartsTable.style.display = "none";
      troubleshootingTable.style.display = "none";
      filterTabs.style.display = "flex";
    } else if (activeRegistryTab === "spare_parts") {
      maintenanceTable.style.display = "none";
      sparePartsTable.style.display = "table";
      troubleshootingTable.style.display = "none";
      filterTabs.style.display = "none";
    } else if (activeRegistryTab === "troubleshooting") {
      maintenanceTable.style.display = "none";
      sparePartsTable.style.display = "none";
      troubleshootingTable.style.display = "table";
      filterTabs.style.display = "none";
    }
    
    highlightRecordIds = []; // clear RAG filters on switch
    renderGrid();
  });
}

// AI Engine configuration state
let engineMode = "ollama"; // "heuristics" or "ollama" — overridden on load by initApp() from the UI select, but kept in sync here defensively
let parseStrategy = "native"; // "native" or "ocr"
let ollamaUrl = "http://localhost:11434";
let ollamaModel = "";
let isExtracting = false;
let abortExtraction = false;

// Persisted Ollama connection settings — remembers the last endpoint/model used
// across page reloads instead of always resetting to the hardcoded default above.
const OLLAMA_SETTINGS_KEY = "omniparse_ollama_settings";
let savedOllamaSettings = null;
try {
  const rawOllamaSettings = localStorage.getItem(OLLAMA_SETTINGS_KEY);
  if (rawOllamaSettings) {
    savedOllamaSettings = JSON.parse(rawOllamaSettings);
    if (savedOllamaSettings && savedOllamaSettings.url) {
      ollamaUrl = savedOllamaSettings.url;
    }
    if (savedOllamaSettings && savedOllamaSettings.model) {
      ollamaModel = savedOllamaSettings.model;
    }
  }
} catch (e) {
  console.error("Failed to load saved Ollama settings", e);
}

function saveOllamaSettings() {
  try {
    localStorage.setItem(OLLAMA_SETTINGS_KEY, JSON.stringify({ url: ollamaUrl, model: ollamaModel }));
  } catch (e) {}
}

// Google Gemini API (cloud) engine configuration state.
// SECURITY NOTE: this file is a client-side script served directly to the browser — anything
// stored here (including the default API key below) is visible to anyone who views the page
// source, opens dev tools, or inspects the network tab. This hardcoded default was added at the
// user's explicit request for a local/private tool only. Rotate this key immediately if this
// file is ever shared, deployed publicly, or committed to a shared/public repository.
let geminiApiKey = "AQ.Ab8RN6Je-zL-tu6YNX8kBbgzimKIaCxX6vfcUtXLMeBhnnobAA";
let geminiModel = "gemini-flash-latest"; // Google auto-updates this alias to their current flash-tier stable model

const GEMINI_SETTINGS_KEY = "omniparse_gemini_settings";
let savedGeminiSettings = null;
try {
  const rawGeminiSettings = localStorage.getItem(GEMINI_SETTINGS_KEY);
  if (rawGeminiSettings) {
    savedGeminiSettings = JSON.parse(rawGeminiSettings);
    if (savedGeminiSettings && savedGeminiSettings.apiKey) {
      geminiApiKey = savedGeminiSettings.apiKey;
    }
    if (savedGeminiSettings && savedGeminiSettings.model) {
      geminiModel = savedGeminiSettings.model;
    }
  }
} catch (e) {
  console.error("Failed to load saved Gemini settings", e);
}

function saveGeminiSettings() {
  try {
    localStorage.setItem(GEMINI_SETTINGS_KEY, JSON.stringify({ apiKey: geminiApiKey, model: geminiModel }));
  } catch (e) {}
}

// Equipment Manifest state
let equipmentManifest = null;
let activeEquipmentCategory = "Default";

// Few-Shot Learned Patterns
let learnedPatterns = [];
try {
  const savedPatterns = localStorage.getItem("omniparse_learned_patterns");
  if (savedPatterns) {
    learnedPatterns = JSON.parse(savedPatterns);
  }
} catch (e) {
  console.error("Failed to load learned patterns", e);
}

async function fetchManifest() {
  try {
    const res = await fetch("equipment_manifest.json");
    if (res.ok) {
      equipmentManifest = await res.json();
      console.log("Equipment manifest loaded successfully:", equipmentManifest.version);
    } else {
      console.error("Failed to load equipment_manifest.json", res.status);
    }
  } catch (err) {
    console.warn("Error fetching equipment manifest (likely file:// CORS block), using fallback.", err);
    equipmentManifest = {
      categories: {
        "Default": { keywords: ["maintenance", "spare part"], partClasses: [] },
        "Logbook": { keywords: ["logbook", "shift", "repair"], partClasses: [] }
      }
    };
  }
}
fetchManifest();

// Settings DOM Elements
const engineModeSelect = document.getElementById("engine-mode");
const ollamaSettingsGroup = document.getElementById("ollama-settings-group");
const ollamaUrlInput = document.getElementById("ollama-url");
const ollamaModelSelect = document.getElementById("ollama-model-select");
const btnTestOllama = document.getElementById("btn-test-ollama");
const ollamaInfoText = document.getElementById("ollama-info-text");
const ollamaStatusBadge = document.getElementById("ollama-status-badge");
const cancelExtractBtn = document.getElementById("cancel-extract-btn");
const equipmentCategorySelect = document.getElementById("equipment-category");
const parseStrategySelect = document.getElementById("parse-strategy");
const parseStrategyGroup = document.getElementById("parse-strategy-group");
const geminiSettingsGroup = document.getElementById("gemini-settings-group");
const geminiApiKeyInput = document.getElementById("gemini-api-key");
const geminiModelInput = document.getElementById("gemini-model-select");
const btnTestGemini = document.getElementById("btn-test-gemini");
const geminiInfoText = document.getElementById("gemini-info-text");

// Reflect any restored/persisted endpoint into the input immediately
if (ollamaUrlInput && ollamaUrl) {
  ollamaUrlInput.value = ollamaUrl;
}
if (geminiApiKeyInput && geminiApiKey) {
  geminiApiKeyInput.value = geminiApiKey;
}
if (geminiModelInput && geminiModel) {
  geminiModelInput.value = geminiModel;
}

// Settings event listeners
if (parseStrategySelect) {
  parseStrategySelect.addEventListener("change", (e) => {
    parseStrategy = e.target.value;
  });
}
if (equipmentCategorySelect) {
  equipmentCategorySelect.addEventListener("change", (e) => {
    activeEquipmentCategory = e.target.value;
    console.log("Switched equipment category to:", activeEquipmentCategory);
    
    // Update table headers for logbook mode
    const maintenanceHeaders = document.getElementById("maintenance-table-headers");
    if (maintenanceHeaders) {
      if (activeEquipmentCategory === "Logbook") {
        maintenanceHeaders.innerHTML = `
          <th style="width: 60px;">ID</th>
          <th style="width: 150px;">Date</th>
          <th style="width: 300px;">Maintenance Work Description</th>
          <th style="width: 200px;">Parts Renewed</th>
          <th style="width: 150px;">Attended By</th>
          <th>Remarks</th>
          <th style="width: 70px;">Page</th>
          <th style="width: 70px; text-align: center;">Actions</th>
        `;
      } else {
        maintenanceHeaders.innerHTML = `
          <th style="width: 60px;">ID</th>
          <th style="width: 150px;">Equipment Title</th>
          <th style="width: 200px;">Sub-system / Component</th>
          <th style="width: 150px;">Maintenance Routine</th>
          <th>Checks & Instructions</th>
          <th style="width: 70px;">Page</th>
          <th style="width: 70px; text-align: center;">Actions</th>
        `;
      }
    }
  });
}
if (engineModeSelect) {
  engineModeSelect.addEventListener("change", (e) => {
    engineMode = e.target.value;
    if (engineMode === "ollama") {
      ollamaSettingsGroup.style.display = "block";
      if (geminiSettingsGroup) geminiSettingsGroup.style.display = "none";
      if (parseStrategyGroup) parseStrategyGroup.style.display = "block";
      updateOllamaStatus("offline", "Ollama Mode Selected");
      syncOllama(); // Try to sync immediately
    } else if (engineMode === "gemini") {
      ollamaSettingsGroup.style.display = "none";
      if (geminiSettingsGroup) geminiSettingsGroup.style.display = "block";
      if (parseStrategyGroup) parseStrategyGroup.style.display = "block";
      updateOllamaStatus("offline", "Gemini API Selected");
      syncGemini(); // Try to verify the key immediately
    } else {
      ollamaSettingsGroup.style.display = "none";
      if (geminiSettingsGroup) geminiSettingsGroup.style.display = "none";
      if (parseStrategyGroup) parseStrategyGroup.style.display = "none";
      updateOllamaStatus("offline", "Local Heuristics");
    }
  });
}

if (ollamaUrlInput) {
  ollamaUrlInput.addEventListener("change", (e) => {
    ollamaUrl = e.target.value.trim();
    saveOllamaSettings();
  });
}

if (ollamaModelSelect) {
  ollamaModelSelect.addEventListener("change", (e) => {
    ollamaModel = e.target.value;
    saveOllamaSettings();
  });
}

if (btnTestOllama) {
  btnTestOllama.addEventListener("click", () => {
    syncOllama();
  });
}

if (geminiApiKeyInput) {
  geminiApiKeyInput.addEventListener("change", (e) => {
    geminiApiKey = e.target.value.trim();
    saveGeminiSettings();
  });
}

if (geminiModelInput) {
  geminiModelInput.addEventListener("change", (e) => {
    geminiModel = e.target.value.trim();
    saveGeminiSettings();
  });
}

if (btnTestGemini) {
  btnTestGemini.addEventListener("click", () => {
    syncGemini();
  });
}

if (cancelExtractBtn) {
  cancelExtractBtn.addEventListener("click", () => {
    abortExtraction = true;
    appendChatSystemMessage("Extraction cancel requested. Halting parser...");
  });
}

function updateOllamaStatus(status, text, infoClass = "") {
  if (!ollamaStatusBadge) return;
  const dot = ollamaStatusBadge.querySelector(".status-dot");
  const label = ollamaStatusBadge.querySelector(".status-text");
  
  dot.className = "status-dot " + status;
  
  if (engineMode === "heuristics") {
    label.innerText = "Local Heuristics";
    dot.className = "status-dot offline";
  } else if (engineMode === "gemini") {
    label.innerText = status === "online" ? "Gemini Active" : "Gemini Offline";
  } else {
    label.innerText = status === "online" ? `Ollama Active` : "Ollama Offline";
  }
  
  // Ollama and Gemini each have their own info box in the settings panel (only one is visible
  // at a time depending on engineMode), so route the status text to whichever is active.
  const activeInfoEl = engineMode === "gemini" ? geminiInfoText : ollamaInfoText;
  if (activeInfoEl) {
    activeInfoEl.className = "ollama-info " + infoClass;
    if (status === "online") {
      activeInfoEl.innerText = engineMode === "gemini" ? `Connected successfully! Active model: ${geminiModel}` : `Connected successfully! Active model: ${ollamaModel}`;
    } else if (status === "syncing") {
      activeInfoEl.innerText = engineMode === "gemini" ? "Verifying Gemini API key..." : "Syncing local models with Ollama...";
    } else if (status === "error") {
      activeInfoEl.innerText = text;
    } else {
      activeInfoEl.innerText = engineMode === "gemini" ? "Gemini not verified. Click 'Verify Key' to test the connection." : "Ollama not verified. Click 'Sync' to connect.";
    }
  }
}

async function syncOllama() {
  const syncIcon = btnTestOllama ? btnTestOllama.querySelector("i") : null;
  if (syncIcon) syncIcon.classList.add("spin-loading");
  updateOllamaStatus("syncing", "Syncing...");
  
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`);
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}`);
    }
    const data = await res.json();
    if (syncIcon) syncIcon.classList.remove("spin-loading");
    
    if (data.models && data.models.length > 0) {
      ollamaModelSelect.innerHTML = "";
      let selectedIndex = 0;
      let bestPreferenceFound = null;
      // Remembering the model previously used on THIS endpoint takes priority over the generic heuristics below
      const rememberedModel = (savedOllamaSettings && savedOllamaSettings.url === ollamaUrl) ? savedOllamaSettings.model : null;
      data.models.forEach((model, idx) => {
        const option = document.createElement("option");
        option.value = model.name;
        option.innerText = model.name;
        ollamaModelSelect.appendChild(option);
        
        const lowerName = model.name.toLowerCase();
        if (rememberedModel && model.name === rememberedModel) {
          selectedIndex = idx;
          bestPreferenceFound = "remembered";
        } else if (lowerName.includes("manual") && bestPreferenceFound !== "remembered" && bestPreferenceFound !== "manual") {
          selectedIndex = idx;
          bestPreferenceFound = "manual";
        } else if (lowerName.includes("llama3") && !bestPreferenceFound) {
          selectedIndex = idx;
          bestPreferenceFound = "llama3";
        }
      });
      ollamaModelSelect.selectedIndex = selectedIndex;
      ollamaModel = data.models[selectedIndex].name;
      updateOllamaStatus("online", "Connected", "success");
      saveOllamaSettings();
    } else {
      throw new Error("No models installed. Pull a model first, e.g. 'ollama run llama3'");
    }
  } catch (err) {
    if (syncIcon) syncIcon.classList.remove("spin-loading");
    console.error("Ollama connection failed", err);
    updateOllamaStatus(
      "error", 
      `Connection failed: ${err.message}. Ensure Ollama (or NoLlama) is running at ${ollamaUrl} and CORS is enabled.`, 
      "error"
    );
    ollamaModelSelect.innerHTML = `<option value="llama3">llama3 (Fallback)</option>`;
    ollamaModel = "llama3";
  }
}

// Verify the Gemini API key/model by hitting the lightweight models.list endpoint
async function syncGemini() {
  const syncIcon = btnTestGemini ? btnTestGemini.querySelector("i") : null;
  if (syncIcon) syncIcon.classList.add("spin-loading");
  updateOllamaStatus("syncing", "Verifying...");

  try {
    if (!geminiApiKey) {
      throw new Error("No API key entered.");
    }
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiApiKey}`);
    if (syncIcon) syncIcon.classList.remove("spin-loading");

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error((errBody.error && errBody.error.message) || `HTTP error ${res.status}`);
    }
    const data = await res.json();

    // Google periodically retires model versions (e.g. old "-flash"/"-pro" names stop being
    // available to new API keys). Only keep models this key can actually call for extraction,
    // and populate the dropdown from that live list instead of trusting a hardcoded name.
    const usableModels = (data.models || []).filter(m =>
      Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent")
    );

    if (usableModels.length === 0) {
      throw new Error("Key is valid, but no generateContent-capable models were returned by the API.");
    }

    if (geminiModelInput) {
      geminiModelInput.innerHTML = "";
      let selectedIndex = 0;
      let bestPreferenceFound = null;
      // Remembering the model previously used with this same key takes priority over the generic heuristics below
      const rememberedModel = (savedGeminiSettings && savedGeminiSettings.apiKey === geminiApiKey) ? savedGeminiSettings.model : null;

      usableModels.forEach((m, idx) => {
        const shortName = m.name.replace(/^models\//, "");
        const option = document.createElement("option");
        option.value = shortName;
        option.innerText = m.displayName ? `${shortName} (${m.displayName})` : shortName;
        geminiModelInput.appendChild(option);

        const lowerName = shortName.toLowerCase();
        if (rememberedModel && shortName === rememberedModel) {
          selectedIndex = idx;
          bestPreferenceFound = "remembered";
        } else if (lowerName.includes("flash") && !lowerName.includes("lite") && bestPreferenceFound !== "remembered" && bestPreferenceFound !== "flash") {
          selectedIndex = idx;
          bestPreferenceFound = "flash";
        }
      });
      geminiModelInput.selectedIndex = selectedIndex;
      geminiModel = usableModels[selectedIndex].name.replace(/^models\//, "");
    }

    updateOllamaStatus("online", "Connected", "success");
    saveGeminiSettings();
  } catch (err) {
    if (syncIcon) syncIcon.classList.remove("spin-loading");
    console.error("Gemini connection failed", err);
    updateOllamaStatus(
      "error",
      `Connection failed: ${err.message}. Check your API key and network connection.`,
      "error"
    );
  }
}

// Helper to sanitize extracted field values to fallback to "NA" if empty or unavailable
function sanitizeVal(val) {
  if (val === null || val === undefined) return "NA";
  const s = String(val).trim();
  if (s === "" || s.toLowerCase() === "null" || s.toLowerCase() === "undefined" || s.toLowerCase() === "na") return "NA";
  return s;
}

// Check if a maintenance row has valid (non-empty/non-NA) content in subsystem_component and checks_instructions

function normalizeExtraction(output) {
  if (!equipmentManifest) return output;
  const mappings = equipmentManifest.normalization_mappings;
  if (!mappings) return output;

  const normalizeRoutine = (routine) => {
    if (!routine || routine === "NA") return "NA";
    const lower = String(routine).toLowerCase();
    for (const mapping of mappings.maintenance_routines) {
      if (mapping.matches.some(m => lower.includes(m))) {
        return mapping.enum;
      }
    }
    return routine;
  };

  const normalizeFreq = (freq) => {
    if (!freq || freq === "NA") return "NA";
    const lower = String(freq).toLowerCase();
    for (const mapping of mappings.spare_parts_frequency) {
      if (mapping.matches.some(m => lower.includes(m))) {
        return mapping.enum;
      }
    }
    return freq;
  };

  if (output.maintenance) {
    output.maintenance.forEach(r => {
      r.maintenance_routine = normalizeRoutine(r.maintenance_routine);
    });
  }
  if (output.spare_parts) {
    output.spare_parts.forEach(r => {
      r.frequency_of_use = normalizeFreq(r.frequency_of_use);
    });
  }
  return output;
}

function looksLikeProcurementOrIndexMeta(text) {
  const s = String(text || "").toLowerCase().trim();
  if (!s) return false;

  // Generic metadata-style language rather than document-specific phrases.
  const metaTokenHits = (s.match(/\b(project|order|serial|manufactur|nameplate|code|index|material|required|identification|reference)\b/g) || []).length;
  const partTokenHits = (s.match(/\b(gasket|seal|bearing|plate|bolt|nut|screw|filter|valve|ring|liner|pump|shaft|gear|coupling|hose)\b/g) || []).length;
  const hasActionVerb = /\b(inspect|check|replace|clean|lubricate|tighten|remove|install|test|flush)\b/.test(s);
  const endsWithPageNum = /(?:\.{2,}\s*)?\d{1,3}$/.test(s);

  // Index/metadata labels usually have metadata tokens, few hardware terms, and no action verbs.
  if (metaTokenHits >= 2 && partTokenHits === 0 && !hasActionVerb) return true;
  if (metaTokenHits >= 3 && !hasActionVerb) return true;
  if (endsWithPageNum && metaTokenHits >= 1 && !hasActionVerb) return true;
  return false;
}

function extractContentTokens(text) {
  const stop = new Set([
    "the", "and", "for", "with", "from", "into", "that", "this", "then", "than",
    "are", "was", "were", "have", "has", "had", "will", "shall", "should", "can",
    "must", "not", "all", "any", "page", "unit", "system", "check", "inspect"
  ]);
  const tokens = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t && !stop.has(t) && (t.length >= 4 || /^\d+$/.test(t)));
  return Array.from(new Set(tokens));
}

function isTextGroundedInSource(candidateText, sourceText) {
  const source = String(sourceText || "").toLowerCase();
  if (!source.trim()) return false;
  const tokens = extractContentTokens(candidateText);
  if (tokens.length === 0) return false;

  const matchedTokens = tokens.filter(t => source.includes(t));
  const tokenThreshold = Math.max(1, Math.ceil(tokens.length * 0.45));
  const tokenOk = matchedTokens.length >= tokenThreshold;

  // Additional phrase check helps reject fluent hallucinations built from sparse index labels.
  const words = String(candidateText || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 4);
  let phraseOk = false;
  if (words.length >= 4) {
    for (let i = 0; i <= words.length - 2; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`.trim();
      if (bigram.length >= 9 && source.includes(bigram)) {
        phraseOk = true;
        break;
      }
    }
  } else {
    phraseOk = tokenOk;
  }
  return tokenOk && phraseOk;
}

function isCleanMaintenanceRow(row) {
  if (activeEquipmentCategory === "Logbook") {
    const desc = sanitizeVal(row.maintenance_work_description);
    if (desc === "NA") return false;
    return true;
  }
  const comp = sanitizeVal(row.subsystem_component);
  if (comp === "NA") return false;
  const checks = sanitizeVal(row.checks_instructions);
  if (checks === "NA") return false;
  if (looksLikeProcurementOrIndexMeta(checks)) {
    return false;
  }
  return true;
}

// Check if a spare part row has valid (non-empty/non-NA) content in name, code, or drawing model
function isCleanSparePartsRow(row) {
  const name = sanitizeVal(row.part_name);
  const code = sanitizeVal(row.part_number_code);
  const dwg = sanitizeVal(row.drawing_model_no);
  if (name === "NA" && code === "NA" && dwg === "NA") return false;

  const lowerName = name.toLowerCase();
  const lowerCode = code.toLowerCase();
  const lowerDwg = dwg.toLowerCase();
  const hasStrongCode = code !== "NA" && /[0-9]/.test(code) && !lowerCode.includes("na");
  const hasDrawingRef = dwg !== "NA" && !lowerDwg.includes("na");
  if (looksLikeProcurementOrIndexMeta(name) && !hasStrongCode && !hasDrawingRef) {
    return false;
  }
  return true;
}

// Heuristic pre-filter to detect if a page contains keywords indicating maintenance tasks or spare parts
// Heuristic pre-filter to detect if a page contains recommended spare parts lists or tables
function isRecommendedSparePartsPage(pageText) {
  if (!pageText) return false;
  
  // Exclude explicit Table of Contents pages
  if (pageText.toLowerCase().includes("table of contents") || pageText.toLowerCase().includes("index")) {
    return false;
  }
  
  const text = pageText.toLowerCase();
  const cleanText = text.replace(/\s+/g, " ");
  
  // Specific headers/keywords indicating recommended or quick-wear spare parts lists
  return cleanText.includes("recommended (one year) spare parts") || 
         cleanText.includes("recommended spare parts") || 
         cleanText.includes("quick-wear parts") || 
         cleanText.includes("quick - wear parts") || 
         cleanText.includes("consumptive parts") || 
         cleanText.includes("quick-wear and consumptive") ||
         cleanText.includes("quick - wear and consumptive") ||
         cleanText.includes("bearings list of dw") ||
         (cleanText.includes("legend") && cleanText.includes("pos") && cleanText.includes("q.ty"));
}

// Specialized structural spare parts parser for Recommended and Quick-Wear spare parts tables
function parseSparePartsStructurally(text, docName, pageNum = 1) {
  const results = [];
  if (!text) return results;
  const cleanText = text.replace(/\s+/g, " ");
  
  // Find all 10-digit codes
  const codeRegex = /\b\d{10}\b/g;
  let match;
  const codeMatches = [];
  while ((match = codeRegex.exec(cleanText)) !== null) {
    codeMatches.push({
      code: match[0],
      start: match.index,
      end: codeRegex.lastIndex
    });
  }

  if (codeMatches.length === 0) {
    const lowerText = cleanText.toLowerCase();
    const legendIdx = lowerText.indexOf("legend");
    let searchArea = cleanText;
    if (legendIdx !== -1) {
      searchArea = cleanText.substring(legendIdx + "legend".length);
    }
    
    // Regex matching Pos Q.ty Description
    const regexPattern = /\b(\d+)\s+(\d+(?:-\d+)?)\s+([a-zA-Z\s\/\-\&\(\)\.\,\’\'\"\+]+?)(?=\s+\d+\s+\d+(?:-\d+)?\s+|$)/g;
    let matchPair;
    
    let subsystemLocation = "NA";
    if (lowerText.includes("with direct joint")) {
      subsystemLocation = "Direct Joint";
    } else if (lowerText.includes("with extension and one bearing")) {
      subsystemLocation = "Extension & One Bearing";
    } else if (lowerText.includes("with extension and two bearings")) {
      subsystemLocation = "Extension & Two Bearings";
    }
    
    while ((matchPair = regexPattern.exec(searchArea)) !== null) {
      const pos = matchPair[1].trim();
      const qty = matchPair[2].trim();
      const desc = matchPair[3].trim().replace(/\s+/g, " "); // collapse spacing
      
      let categorization = "Critical Spare";
      const lowerDesc = desc.toLowerCase();
      if (lowerDesc.includes("o-ring") || lowerDesc.includes("gasket") || lowerDesc.includes("seal") || lowerDesc.includes("screw") || lowerDesc.includes("washer") || lowerDesc.includes("circlip") || lowerDesc.includes("ring nut") || lowerDesc.includes("bearing")) {
        categorization = "Consumable";
      }
      
      results.push({
        id: 0,
        equipment_title: docName ? docName.replace(/\.[^/.]+$/, "") : "NA",
        subsystem_location: subsystemLocation,
        item_no: pos,
        part_name: desc,
        part_number_code: "NA",
        drawing_model_no: "NA",
        oem_standard_body: "NA",
        part_categorization: categorization,
        quantity: qty,
        recommended_stock_qty: "NA",
        warranty_period: "NA",
        frequency_of_use: "NA",
        page: pageNum
      });
    }
    
    return results;
  }
  
  // Table state tracking
  let currentTable = "Table 15";
  let idxCounter = 1;
  
  // Reconstruct table and index state sequentially based on sparePartsRegistry
  let prevTable = "Table 15";
  let prevIdx = 0;
  if (typeof sparePartsRegistry !== "undefined" && Array.isArray(sparePartsRegistry)) {
    const cleanDocName = docName ? docName.replace(/\.[^/.]+$/, "") : "NA";
    for (let idx = sparePartsRegistry.length - 1; idx >= 0; idx--) {
      const r = sparePartsRegistry[idx];
      if (r.equipment_title === cleanDocName) {
        if (r.frequency_of_use && r.frequency_of_use.includes("Replace every")) {
          prevTable = "Table 16";
        } else {
          prevTable = "Table 15";
        }
        prevIdx = parseInt(r.item_no) || 0;
        break;
      }
    }
  }
  
  currentTable = prevTable;
  idxCounter = prevIdx > 0 ? prevIdx + 1 : 1;
  
  for (let i = 0; i < codeMatches.length; i++) {
    const m = codeMatches[i];
    const code = m.code;
    
    const prevEnd = i > 0 ? codeMatches[i-1].end : 0;
    const preceding = cleanText.substring(prevEnd, m.start).trim();
    
    const nextStart = (i + 1 < codeMatches.length) ? codeMatches[i+1].start : cleanText.length;
    const segment = cleanText.substring(m.end, nextStart).trim();
    
    // Determine table type and index from preceding
    const lowerPre = preceding.toLowerCase();
    if (lowerPre.includes("quick - wear") || lowerPre.includes("quick-wear") || lowerPre.includes("quick_wear")) {
      currentTable = "Table 16";
      idxCounter = 1;
    } else if (lowerPre.includes("recommended")) {
      currentTable = "Table 15";
      idxCounter = 1;
    } else if (lowerPre.includes("bearings list")) {
      currentTable = "Table 14";
      idxCounter = 1;
    }
    
    // Determine row index
    let targetIndex = idxCounter;
    const trailingDigitsMatch = preceding.match(/(\d+(?:\s+\d+)*)\s*$/);
    if (trailingDigitsMatch) {
      const digits = trailingDigitsMatch[1].replace(/\s+/g, "");
      if (digits.endsWith(String(targetIndex))) {
        // match
      } else if (digits.endsWith(String(targetIndex + 1))) {
        targetIndex = targetIndex + 1;
      } else {
        // fallback: parse last 1-2 digits
        const val2 = parseInt(digits.slice(-2));
        if (!isNaN(val2)) {
          targetIndex = val2;
        } else {
          const val1 = parseInt(digits.slice(-1));
          if (!isNaN(val1)) {
            targetIndex = val1;
          }
        }
      }
    }
    
    const rowId = targetIndex;
    idxCounter = rowId + 1;
    
    // We discard Table 14 (Bearings list)
    if (currentTable === "Table 14") {
      continue;
    }
    
    // Parse segment
    let nextIdxStr = String(idxCounter);
    let nextIdxSpaceStr = nextIdxStr.split("").join(" ");
    
    let segmentClean = segment;
    // Strip next index
    const patterns = [
      new RegExp("\\s+" + escapeRegExp(nextIdxSpaceStr) + "$"),
      new RegExp("\\s+" + escapeRegExp(nextIdxStr) + "$")
    ];
    for (const pat of patterns) {
      const matchPat = segmentClean.match(pat);
      if (matchPat) {
        segmentClean = segmentClean.substring(0, matchPat.index).trim();
        break;
      }
    }
    
    // Strip Table 16 header if Table 15 last row
    if (currentTable === "Table 15" && segmentClean.toLowerCase().includes("list of quick")) {
      const matchHeader = segmentClean.match(/\b\d+(?:\s+\d+)?\s+list of quick.*$/i);
      if (matchHeader) {
        segmentClean = segmentClean.substring(0, matchHeader.index).trim();
      }
    }
    
    // Strip Table 17 header or other sections
    if (segmentClean.toLowerCase().includes("quality assurance")) {
      const matchHeader = segmentClean.match(/\b\d+(?:\s+\d+)?\s+quality assurance.*$/i);
      if (matchHeader) {
        segmentClean = segmentClean.substring(0, matchHeader.index).trim();
      }
    }
    
    const tokens = segmentClean.split(/\s+/);
    
    let qty = "NA";
    let warranty = "NA";
    let remark = "NA";
    
    if (currentTable === "Table 16") {
      if (tokens.length >= 2 && ["year", "years", "month", "months", "monthes"].includes(tokens[tokens.length - 1].toLowerCase())) {
        warranty = tokens[tokens.length - 2] + " " + tokens[tokens.length - 1];
        tokens.splice(tokens.length - 2, 2);
      } else if (tokens.length >= 1 && tokens[tokens.length - 1].toLowerCase().includes("year")) {
        warranty = tokens[tokens.length - 1];
        tokens.splice(tokens.length - 1, 1);
      }
    }
    
    // Extract QTY (check last 3 tokens, group consecutive digits)
    const maxChecked = Math.max(0, tokens.length - 3);
    for (let j = tokens.length - 1; j >= maxChecked; j--) {
      if (/^\d+$/.test(tokens[j])) {
        let startJ = j;
        while (startJ > 0 && /^\d+$/.test(tokens[startJ - 1])) {
          startJ--;
        }
        qty = tokens.slice(startJ, j + 1).join(" ");
        remark = tokens.slice(j + 1).join(" ");
        tokens.splice(startJ, tokens.length - startJ);
        break;
      }
    }
    
    // Token classification
    const isCode = (s) => {
      const hasDigitOrSpecial = /[0-9\-\/\.\;×φ]/.test(s);
      const isUpperWord = (s === s.toUpperCase() && s.length >= 2);
      return hasDigitOrSpecial || isUpperWord;
    };
    
    const drawingModel = [];
    const partNameTokens = [];
    const specModel = [];
    
    let state = "standard";
    for (const t of tokens) {
      if (state === "standard") {
        if (isCode(t)) {
          drawingModel.push(t);
        } else {
          state = "name";
          partNameTokens.push(t);
        }
      } else if (state === "name") {
        if (isCode(t)) {
          state = "model";
          specModel.push(t);
        } else {
          partNameTokens.push(t);
        }
      } else if (state === "model") {
        specModel.push(t);
      }
    }
    
    let partName = partNameTokens.join(" ").trim();
    let drawingModelNo = drawingModel.join(" ").trim();
    let mfrCode = specModel.join(" ").trim();
    
    if (!partName && drawingModelNo) {
      drawingModelNo = drawingModel[0];
      mfrCode = drawingModel.slice(1).join(" ");
      partName = "NA";
    }
    
    if (!partName) partName = "NA";
    if (!drawingModelNo) drawingModelNo = "NA";
    if (!mfrCode) mfrCode = "NA";
    
    let categorization = (currentTable === "Table 16") ? "Consumable" : "Critical Spare";
    const lowerName = partName.toLowerCase();
    if (lowerName.includes("filter") || lowerName.includes("seal") || lowerName.includes("stopper") || lowerName.includes("holder") || lowerName.includes("rope") || lowerName.includes("oil")) {
      categorization = "Consumable";
    }
    
    let frequency = "NA";
    if (currentTable === "Table 16") {
      if (warranty !== "NA") {
        frequency = "Replace every " + warranty;
      }
    } else if (currentTable === "Table 15") {
      if (rowId === 6) {
        frequency = "Replace every 6 months";
      } else {
        frequency = "Replace during overhaul / Medium";
      }
    }

    // Opportunistic detection of OEM/governing standard and recommended stock levels
    // from the row's own text (segment + leftover remark tokens). Only ever set when
    // actually present — never guessed — so this can only replace NA with real data.
    const rowRemainderText = `${segment} ${remark}`;
    let oemStandardBody = "NA";
    const standardMatch = rowRemainderText.match(/\b(ISO|DIN|ANSI|API|ASME|JIS|BS|SAE|NEMA|IEC)[\-\s]?\d{0,6}\b/);
    if (standardMatch) oemStandardBody = standardMatch[0];

    let recommendedStockQty = "NA";
    const stockMatch = rowRemainderText.toLowerCase().match(/\b(?:recommended stock|stock level)\D{0,20}?(\d{1,4})\b/);
    if (stockMatch) recommendedStockQty = stockMatch[1];
    
    results.push({
      id: 0,
      equipment_title: docName ? docName.replace(/\.[^/.]+$/, "") : "NA",
      subsystem_location: "NA",
      item_no: String(rowId),
      part_name: partName,
      part_number_code: code,
      drawing_model_no: (drawingModelNo !== "NA" && mfrCode !== "NA") ? (drawingModelNo + " / " + mfrCode) : (drawingModelNo !== "NA" ? drawingModelNo : (mfrCode !== "NA" ? mfrCode : "NA")),
      oem_standard_body: oemStandardBody,
      part_categorization: categorization,
      quantity: qty !== "NA" ? qty : "1",
      recommended_stock_qty: recommendedStockQty,
      warranty_period: warranty,
      frequency_of_use: frequency,
      page: pageNum
    });
  }
  
  return results;
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isLikelyIndexOrTOCPage(pageText, pageNum = null) {
  if (!pageText) return false;

  const text = String(pageText);
  const lower = text.toLowerCase();
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  if (lower.includes("table of contents")) return true;

  const dotLeaderCount = (text.match(/\.{3,}/g) || []).length;
  const pageRefCount = (lower.match(/\bpage\s+\d{1,3}\b/g) || []).length;
  const contentsWordCount = (lower.match(/\bcontents?\b/g) || []).length;
  const indexWordCount = (lower.match(/\bindex\b/g) || []).length;
  const numberedEntryCount = (text.match(/[A-Za-z][A-Za-z0-9 ,\-\/\(\)]{10,120}(?:\.{2,}\s*|\s{2,})\d{1,3}\b/g) || []).length;
  const sectionEntryCount = (lower.match(/\b(?:chapter|section|appendix|figure|fig\.?|table)\s*[a-z0-9\.\-]{0,12}\s+[a-z][^.!?\n]{0,80}\s+\d{1,3}\b/g) || []).length;
  const tocLineCount = lines.filter(l => /(?:\.{2,}\s*)?\d{1,3}$/.test(l) && /[a-z]/i.test(l) && l.length > 8).length;
  const headingLikeLineCount = lines.filter(l => /^(?:\d+(?:\.\d+)*)\s+[A-Za-z]/.test(l) && !/[.!?]/.test(l)).length;
  const shortLineCount = lines.filter(l => l.split(/\s+/).length <= 14).length;
  const trailingPageNumLineCount = lines.filter(l => /\b\d{1,3}$/.test(l) && l.split(/\s+/).length <= 16).length;
  const frontMatter = typeof pageNum === "number" && pageNum <= 8;

  if (dotLeaderCount >= 3) return true;
  if (sectionEntryCount >= 4) return true;
  if ((contentsWordCount > 0 || indexWordCount > 0) && numberedEntryCount >= 4) return true;
  if ((pageRefCount + numberedEntryCount) >= 8 && (dotLeaderCount >= 1 || contentsWordCount > 0 || indexWordCount > 0)) return true;
  // Continuation index pages often have many short heading lines ending with page numbers.
  if (tocLineCount >= 6 && headingLikeLineCount >= 4) return true;
  // Front-matter continuation index: lots of short lines that terminate in page numbers.
  if (frontMatter && trailingPageNumLineCount >= 6 && shortLineCount >= 8) return true;

  return false;
}

function buildTextFromPdfTextContent(textContent) {
  if (!textContent || !Array.isArray(textContent.items)) return "";
  const items = textContent.items
    .map(item => ({
      str: String(item.str || "").trim(),
      x: Array.isArray(item.transform) ? Number(item.transform[4]) || 0 : 0,
      y: Array.isArray(item.transform) ? Number(item.transform[5]) || 0 : 0,
      hasEOL: Boolean(item.hasEOL)
    }))
    .filter(item => item.str.length > 0);

  if (items.length === 0) return "";

  // Prefer explicit line breaks when available.
  if (items.some(item => item.hasEOL)) {
    const lines = [];
    let currentLine = "";
    items.forEach(item => {
      currentLine += (currentLine ? " " : "") + item.str;
      if (item.hasEOL) {
        lines.push(currentLine.trim());
        currentLine = "";
      }
    });
    if (currentLine) lines.push(currentLine.trim());
    return lines.join("\n");
  }

  // Fallback: cluster items by y-position to reconstruct line-aware text.
  const sorted = [...items].sort((a, b) => {
    if (Math.abs(a.y - b.y) > 1.2) return b.y - a.y;
    return a.x - b.x;
  });
  const lines = [];
  let current = [];
  let currentY = sorted[0].y;
  const yTolerance = 2.0;

  sorted.forEach(item => {
    if (Math.abs(item.y - currentY) > yTolerance) {
      if (current.length > 0) {
        current.sort((a, b) => a.x - b.x);
        lines.push(current.map(t => t.str).join(" ").trim());
      }
      current = [item];
      currentY = item.y;
    } else {
      current.push(item);
    }
  });
  if (current.length > 0) {
    current.sort((a, b) => a.x - b.x);
    lines.push(current.map(t => t.str).join(" ").trim());
  }
  return lines.filter(Boolean).join("\n");
}


function shouldProcessPageWithLLM(pageText) {
  if (!pageText) return false;
  if (isLikelyIndexOrTOCPage(pageText)) return false;
  
  // Reject explicit Table of Contents / Index pages to prevent LLM hallucination
  const lowerPageText = pageText.toLowerCase();
  if (lowerPageText.includes("table of contents") || (lowerPageText.includes("index") && !lowerPageText.includes("part"))) {
    return false;
  }

  const text = pageText.toLowerCase();
  const cleanText = text.replace(/\s+/g, ' ');
  
  // High-value keywords for maintenance and parts
  const keywords = (equipmentManifest && equipmentManifest.categories[activeEquipmentCategory]) 
    ? equipmentManifest.categories[activeEquipmentCategory].keywords 
    : ["replace", "lubricate", "grease", "inspect", "maintenance", "troubleshoot", "problem", "fault", "cause", "solution"];
  
  return keywords.some(kw => cleanText.includes(kw));
}

async function runOllamaRawTranscription(base64Image) {
  const systemPrompt = `You are a strict OCR engine.
DO NOT describe the image. DO NOT say "The image shows" or "This is a picture of".
Your ONLY task is to read the characters and text written in the image and output them.
If the handwriting is messy, make your absolute best guess at the characters.
Output ONLY the transcribed text. Absolutely NO conversational text or descriptions.`;

  const fetchBody = {
    model: ollamaModel,
    prompt: systemPrompt,
    stream: false,
    images: [base64Image],
    options: { temperature: 0.1 }
  };

  const response = await fetch(`${ollamaUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fetchBody)
  });

  if (!response.ok) throw new Error("Ollama network response was not ok");
  const data = await response.json();
  return data.response.trim();
}

// Query local Ollama API to extract structured parts & maintenance instructions
// Builds the shared extraction instruction prompt used by every LLM backend (Ollama, Gemini, ...).
// Keeping this in one place ensures the carefully-tuned field-extraction rules (and any future
// fixes to them) automatically apply to every engine instead of drifting out of sync.
function buildExtractionPrompt(text, docName) {
  const cleanDocName = docName ? docName.replace(/\.[^/.]+$/, "") : "NA";
  let systemPrompt = `You are an expert technical parser of industrial engineering manuals.
Your task is to analyze the text page content below and extract:
1. Maintenance routines, checks, and instructions.
2. Spare parts and components referenced in drawings or lists.
3. Troubleshooting tables, problems, and root-cause/solutions.

Group your extractions into three distinct JSON lists: "maintenance", "spare_parts", and "troubleshooting".
CRITICAL INSTRUCTION: If a field is missing, not specified, or not available in the text, you MUST populate it with the string "NA". Do not use null, undefined, or empty values.

Rules for "maintenance" tasks:
- Extract real maintenance tasks, checks, inspection routines, adjustments, or replacements.
- Clean instructions to remove page headers or random numbers. Pay special attention to tables and bulleted checklists, ensuring each item is extracted accurately.
- For "equipment_title", default to "${cleanDocName}" if the text does not mention a specific equipment.
- For "subsystem_component", you MUST identify a specific, physical sub-system or component. If a checklist implies the component, use that for all its items. If no specific component can be identified, DO NOT extract the task.
- For "maintenance_routine", extract the interval.
- For "checks_instructions", write the procedure or actions in a concise manner.

Rules for "spare_parts":
- Extract items that represent real spare parts, consumables, hardware, or components.
- DO NOT extract ordering metadata, procurement fields, or identification labels as parts.
- Reject list labels or ordering metadata unless there is clear evidence of an actual physical part (for example a concrete component name with valid part/drawing reference context).
- For "equipment_title", you MUST extract the explicit Table Title, Header, or Caption directly preceding the parts list (e.g. "EXAMPLE_TABLE_TITLE_DO_NOT_COPY"). Do not use random surrounding text. Default to "${cleanDocName}" if there is absolutely no title.
- For "subsystem_location", identify the specific assembly or sub-system the part belongs to. If the table title explicitly mentions the assembly name, use it here.
- For "part_name", extract the descriptive name of the component or part.
- For "part_categorization", use "Critical Spare", "Consumable", or "Standard Part".
- For "quantity", extract the number of units.
- For "part_number_code": The manufacturer's part number or code. This is often an alphanumeric string (e.g. "H910-416", "30123290", "51300-348-F"), not necessarily a long numeric code. Scan the entire row/segment for it, including columns labeled "P/N", "Part No.", "Code", "Number", or similar.
- For "drawing_model_no": The engineering drawing, reference/location designator (e.g. "U1", "TB2"), or model designator number, if present in the row.
- For "oem_standard_body": The OEM name, manufacturer, or governing standard/body (e.g. "ANSI", "ISO", "DIN") referenced for the part, if present.
- For "recommended_stock_qty", extract stock recommendation levels if present.
- For "warranty_period", extract the warranty duration if mentioned (e.g. "12 months", "1 year").
- For "frequency_of_use", extract how frequently this part is used or should be replaced/inspected.
- IMPORTANT: Every field above must be actively searched for within the row's full text before defaulting to "NA". Only use "NA" when the information is truly absent from that row, not simply because it doesn't fit the example format below.

Rules for "troubleshooting" tasks:
- ONLY extract explicit troubleshooting matrices or tables. DO NOT extract Table of Contents headers, general descriptions, or normal paragraphs as problems.
- A valid problem MUST have a corresponding root cause and solution. If the text does not describe a fault and how to fix it, do NOT extract it.
- For "equipment_title", default to "${cleanDocName}" if not specified.
- For "subsystem_component", identify the specific sub-system.
- For "problem", extract the symptom, fault, or issue described.
- For "root_cause_solution", extract the combined root cause and solution / elimination method.

Response MUST be strictly valid JSON (and only JSON, with no other text before or after).
CRITICAL EXCEPTION: Do NOT return empty arrays if you see actual part names accompanied by alphanumeric codes. You MUST extract them.

CRITICAL INSTRUCTION: DO NOT use the values from the example output. If a field is missing or not found in the text, you MUST output "NA".

Example Output Structure:
{
  "maintenance": [
    {
      "equipment_title": "EXAMPLE_EQUIPMENT_DO_NOT_COPY",
      "subsystem_component": "Main Brake Caliper",
      "maintenance_routine": "Daily",
      "checks_instructions": "Inspect for oil leaks."
    }
  ],
  "spare_parts": [
    {
      "equipment_title": "EXAMPLE_EQUIPMENT_DO_NOT_COPY",
      "subsystem_location": "Regulator",
      "item_no": "1",
      "part_name": "EXAMPLE_PART_NAME_DO_NOT_COPY",
      "part_number_code": "EXAMPLE_CODE",
      "drawing_model_no": "EXAMPLE_DRAWING_OR_REF_DO_NOT_COPY",
      "oem_standard_body": "EXAMPLE_OEM_OR_STANDARD_DO_NOT_COPY",
      "part_categorization": "Consumable",
      "quantity": "1",
      "recommended_stock_qty": "EXAMPLE_STOCK_QTY_DO_NOT_COPY",
      "warranty_period": "EXAMPLE_WARRANTY_DO_NOT_COPY",
      "frequency_of_use": "EXAMPLE_FREQUENCY_DO_NOT_COPY"
    }
  ],
  "troubleshooting": [
    {
      "equipment_title": "EXAMPLE_EQUIPMENT_DO_NOT_COPY",
      "subsystem_component": "Regulator Valve",
      "problem": "Valve does not open",
      "root_cause_solution": "Air lock in line. Bleed air from the system."
    }
  ]
}`;

  if (activeEquipmentCategory === "Logbook") {
    systemPrompt = `You are an expert transcriber of handwritten field history cards and maintenance logbooks.
Your task is to analyze the image or text below and extract historical maintenance log entries exactly as they are written.

Group your extractions into the "maintenance" list. Return an empty array [] for "spare_parts".
If a field is missing, not specified, or not available in the text, you MUST populate it with the string "NA".

You MUST strictly use the following 5 keys for every entry:
- "date"
- "maintenance_work_description"
- "parts_renewed"
- "attended_by"
- "remarks"

Response MUST be strictly valid JSON (and only JSON, with no other text before or after).
CRITICAL: Even if the page looks like a cover page, or the table is messy and handwritten, DO NOT return empty arrays! You MUST attempt to extract whatever handwritten notes, signatures, or dates are visible into the "maintenance" list.

CRITICAL INSTRUCTION: DO NOT use the values from the example output. If a field is missing or not found in the text, you MUST output "NA".

Example Output Structure:
{
  "maintenance": [
    {
      "date": "15 Jan 2023",
      "maintenance_work_description": "Repl. Oil Pump",
      "parts_renewed": "Oil Pump Assy",
      "attended_by": "J. P. H.",
      "remarks": "Tested OK"
    }
  ],
  "spare_parts": []
}`;
  }
  systemPrompt += `\n\n${learnedPatterns.length > 0 ? 
  `CRITICAL LEARNING EXAMPLES:\nThe user has manually corrected past extractions. You MUST strongly weigh these learned patterns when deciding how to extract and format data:\n${JSON.stringify(learnedPatterns, null, 2)}` 
  : ""}

Text to parse:
"""
${text}
"""`;

  return systemPrompt;
}

// Parses/normalizes the raw text response returned by any LLM backend into the app's
// structured { maintenance, spare_parts, troubleshooting } shape. Shared by every engine so the
// mapping, quality filters, and grounding guardrail only need to be maintained in one place.
function processRawModelResponse(rawResponseText, docName, pageNum, base64Image, providerLabel) {
  const cleanDocName = docName ? docName.replace(/\.[^/.]+$/, "") : "NA";
  let cleanResponse = (rawResponseText || "").trim();
  try {
    // Robust extraction of JSON object if wrapped in markdown formatting by smaller models
    const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanResponse = jsonMatch[0];
    }
    
    const resultJson = JSON.parse(cleanResponse);
    const output = {
      maintenance: [],
      spare_parts: [],
      troubleshooting: []
    };

    if (resultJson.maintenance && Array.isArray(resultJson.maintenance)) {
      output.maintenance = resultJson.maintenance.map(item => {
        if (activeEquipmentCategory === "Logbook") {
          return {
            id: 0,
            date: sanitizeVal(item.date),
            maintenance_work_description: sanitizeVal(item.maintenance_work_description),
            parts_renewed: sanitizeVal(item.parts_renewed),
            attended_by: sanitizeVal(item.attended_by),
            remarks: sanitizeVal(item.remarks),
            page: pageNum
          };
        } else {
          let title = sanitizeVal(item.equipment_title);
          if (title === "NA") title = cleanDocName;
          return {
            id: 0,
            equipment_title: title,
            subsystem_component: sanitizeVal(item.subsystem_component),
            maintenance_routine: sanitizeVal(item.maintenance_routine),
            checks_instructions: sanitizeVal(item.checks_instructions),
            page: pageNum
          };
        }
      });
    }

    if (resultJson.spare_parts && Array.isArray(resultJson.spare_parts)) {
      output.spare_parts = resultJson.spare_parts.map(item => {
        let title = sanitizeVal(item.equipment_title);
        if (title === "NA") title = cleanDocName;
        return {
          id: 0,
          equipment_title: title,
          subsystem_location: sanitizeVal(item.subsystem_location),
          item_no: sanitizeVal(item.item_no),
          part_name: sanitizeVal(item.part_name),
          part_number_code: sanitizeVal(item.part_number_code),
          drawing_model_no: sanitizeVal(item.drawing_model_no),
          oem_standard_body: sanitizeVal(item.oem_standard_body),
          part_categorization: sanitizeVal(item.part_categorization),
          quantity: sanitizeVal(item.quantity),
          recommended_stock_qty: sanitizeVal(item.recommended_stock_qty),
          warranty_period: sanitizeVal(item.warranty_period),
          frequency_of_use: sanitizeVal(item.frequency_of_use) === "NA" && item.periodic_use ? sanitizeVal(item.periodic_use) : sanitizeVal(item.frequency_of_use),
          page: pageNum
        };
      });
    }

    if (resultJson.troubleshooting && Array.isArray(resultJson.troubleshooting)) {
      output.troubleshooting = resultJson.troubleshooting.map(item => {
        let title = sanitizeVal(item.equipment_title);
        if (title === "NA") title = cleanDocName;
        return {
          id: 0,
          equipment_title: title,
          subsystem_component: sanitizeVal(item.subsystem_component),
          problem: sanitizeVal(item.problem),
          root_cause_solution: sanitizeVal(item.root_cause_solution),
          page: pageNum
        };
      });
    }



    // Filter out incomplete/placeholder rows with no valid data
    output.maintenance = output.maintenance.filter(isCleanMaintenanceRow);
    output.spare_parts = output.spare_parts.filter(isCleanSparePartsRow);
    if (output.troubleshooting) {
       output.troubleshooting = output.troubleshooting.filter(r => 
         r.problem !== "NA" && 
         r.root_cause_solution !== "NA" && 
         r.problem.length > 5 && 
         r.root_cause_solution.length > 5 &&
         !r.problem.toLowerCase().includes("... ...") &&
         !r.problem.toLowerCase().includes(". . . .")
       );
    }

    // Guardrail: non-OCR pages must be text-grounded to reduce index/TOC hallucinations.
    if (!base64Image) {
      const sourcePageText = String(text || "");
      output.maintenance = output.maintenance.filter(r => isTextGroundedInSource(r.checks_instructions, sourcePageText));
      output.spare_parts = output.spare_parts.filter(r => {
        const probe = `${r.part_name} ${r.part_number_code} ${r.drawing_model_no}`;
        return isTextGroundedInSource(probe, sourcePageText);
      });
      output.troubleshooting = output.troubleshooting.filter(r => {
        const probe = `${r.problem} ${r.root_cause_solution}`;
        return isTextGroundedInSource(probe, sourcePageText);
      });
    }

    return normalizeExtraction(output);
  } catch (parseErr) {
    console.error(`JSON Parsing failed for ${providerLabel || "LLM"} response:`, cleanResponse);
    throw new Error("JSON Parse Error: " + parseErr.message + " | Raw Output: " + cleanResponse.substring(0, 100) + "...");
  }
}

// Query local Ollama API to extract structured parts & maintenance instructions
async function runOllamaExtractor(text, docName, pageNum, base64Image = null) {
  const systemPrompt = buildExtractionPrompt(text, docName);

  const fetchBody = {
    model: ollamaModel,
    prompt: systemPrompt,
    stream: false,
    format: "json",
    options: {
      temperature: 0.1
    }
  };
  if (base64Image) {
    fetchBody.images = [base64Image];
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000); // 180 seconds timeout

  let response;
  try {
    response = await fetch(`${ollamaUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(fetchBody),
      signal: controller.signal
    });
  } catch (fetchErr) {
    if (fetchErr.name === 'AbortError') {
      throw new Error("Ollama took too long to respond (timeout). The image might be too complex or the model is overloaded.");
    }
    throw fetchErr;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status}`);
  }

  const data = await response.json();
  return processRawModelResponse(data.response, docName, pageNum, base64Image, "Ollama");
}

// Query the Google Gemini API (cloud) to extract structured parts & maintenance instructions.
// Uses the same prompt/parsing pipeline as Ollama, so extraction quality/fields stay identical
// regardless of which engine is active — only the transport (REST call + auth) differs.
async function runGeminiExtractor(text, docName, pageNum, base64Image = null, mimeType = "image/jpeg") {
  const systemPrompt = buildExtractionPrompt(text, docName);
  const modelName = geminiModel || "gemini-flash-latest";

  const parts = [{ text: systemPrompt }];
  if (base64Image) {
    parts.push({ inline_data: { mime_type: mimeType || "image/jpeg", data: base64Image } });
  }

  const fetchBody = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json"
    }
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 180000); // 180 seconds timeout

  let response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(fetchBody),
      signal: controller.signal
    });
  } catch (fetchErr) {
    if (fetchErr.name === 'AbortError') {
      throw new Error("Gemini API took too long to respond (timeout). The page/image might be too complex.");
    }
    throw fetchErr;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let errDetail = "";
    try {
      const errJson = await response.json();
      errDetail = (errJson.error && errJson.error.message) || "";
    } catch (e) {}
    throw new Error(`Gemini API error: ${response.status}${errDetail ? " - " + errDetail : ""}`);
  }

  const data = await response.json();
  const candidate = data.candidates && data.candidates[0];
  const rawText = (candidate && candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text) || "";
  if (!rawText) {
    const blockReason = data.promptFeedback && data.promptFeedback.blockReason;
    throw new Error(`Gemini returned no content${blockReason ? " (blocked: " + blockReason + ")" : " (check API key/model name)"}.`);
  }

  return processRawModelResponse(rawText, docName, pageNum, base64Image, "Gemini");
}

// Single entry point used by all extraction call sites — dispatches to whichever cloud/local
// LLM engine is currently selected, so callers don't need to branch on engineMode themselves.
// mimeType is only relevant for Gemini (Ollama's API doesn't require one) and defaults to JPEG,
// which matches the canvas-rendered OCR pages; pass the real file type for uploaded images.
async function runLLMExtractor(text, docName, pageNum, base64Image = null, mimeType = "image/jpeg") {
  if (engineMode === "gemini") {
    return runGeminiExtractor(text, docName, pageNum, base64Image, mimeType);
  }
  return runOllamaExtractor(text, docName, pageNum, base64Image);
}

// Simple markdown formatter helper for chat replies
function renderMarkdown(text) {
  if (!text) return "";
  let html = escapeHTML(text);
  
  // Bold: **text**
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  
  // Process lines for bullet points
  const lines = html.split(/\r?\n/);
  const processedLines = lines.map(line => {
    // Bullet points starting with * or -
    if (/^\s*[-*]\s+/.test(line)) {
      const p1 = line.replace(/^\s*[-*]\s+/, '');
      return `<span style="display:inline-block; padding-left:0.75rem; color:var(--accent-cyan); font-weight:500;">• ${p1}</span>`;
    }
    return line;
  });
  
  // Join lines with <br>
  return processedLines.join("<br>");
}

/* -------------------------------------------------------------
 * 1. UI Rendering Engine
 * ------------------------------------------------------------- */
function updateDashboardMetrics() {
  const rules = maintenanceRegistry.length;
  const parts = sparePartsRegistry.length;
  
  // Estimate consumables from spare parts
  const consumables = sparePartsRegistry.filter(r => 
    String(r.part_name || "").toLowerCase().includes("oil") || 
    String(r.part_name || "").toLowerCase().includes("grease") || 
    String(r.part_name || "").toLowerCase().includes("filter") || 
    String(r.part_name || "").toLowerCase().includes("seal") || 
    String(r.part_name || "").toLowerCase().includes("gasket") || 
    String(r.part_categorization || "").toLowerCase().includes("consumable")
  ).length;

  // Filter time-based rules
  const timeBased = maintenanceRegistry.filter(r => 
    String(r.maintenance_routine || "").toLowerCase().includes("hour") || 
    String(r.maintenance_routine || "").toLowerCase().includes("month") || 
    String(r.maintenance_routine || "").toLowerCase().includes("week") || 
    String(r.maintenance_routine || "").toLowerCase().includes("year") || 
    String(r.maintenance_routine || "").toLowerCase().includes("day") || 
    String(r.maintenance_routine || "").toLowerCase().includes("shift")
  ).length;

  countRules.innerText = rules;
  countParts.innerText = parts;
  countConsumables.innerText = consumables;
  countTime.innerText = timeBased;
  countTroubleshooting.innerText = troubleshootingRegistry.length;
}

function renderGrid() {
  let filtered = [];

  if (activeRegistryTab === "maintenance") {
    maintenanceTableBody.innerHTML = "";
    
    filteredMaintenance = maintenanceRegistry.filter(row => {
      // 1. Tab Filter
      if (currentTabFilter !== "all") {
        const routine = String(row.maintenance_routine || "").toLowerCase();
        if (currentTabFilter === "hours" && !routine.includes("hour")) return false;
        if (currentTabFilter === "days" && !routine.includes("day") && !routine.includes("shift") && !routine.includes("week")) return false;
        if (currentTabFilter === "months" && !routine.includes("month")) return false;
        if (currentTabFilter === "years" && !routine.includes("year")) return false;
      }
      
      // 2. Search Text Query
      if (currentSearchQuery) {
        const q = currentSearchQuery.toLowerCase();
        const matchText = `${row.equipment_title} ${row.subsystem_component} ${row.maintenance_routine} ${row.checks_instructions}`.toLowerCase();
        if (!matchText.includes(q)) return false;
      }

      // 3. Cognitive Chat Highlight Filter
      if (highlightRecordIds.length > 0) {
        if (!highlightRecordIds.includes(row.id)) return false;
      }
      
      return true;
    });
    filtered = filteredMaintenance;

    if (filtered.length === 0) {
      tableEmpty.style.display = "flex";
    } else {
      tableEmpty.style.display = "none";
      
      if (activeEquipmentCategory === "Logbook") {
        filtered.forEach(row => {
          const tr = document.createElement("tr");
          tr.setAttribute("data-id", row.id);
          
          tr.innerHTML = `
            <td class="page-cell" style="font-weight: 600;">#${row.id}</td>
            <td class="editable" data-col="date" style="font-weight: 500;">${escapeHTML(row.date || "NA")}</td>
            <td class="editable" data-col="maintenance_work_description" style="white-space: normal; max-width: 300px;">${escapeHTML(row.maintenance_work_description || "NA")}</td>
            <td class="editable" data-col="parts_renewed" style="font-weight: 500; font-family: monospace;">${escapeHTML(row.parts_renewed || "NA")}</td>
            <td class="editable" data-col="attended_by">${escapeHTML(row.attended_by || "NA")}</td>
            <td class="editable" data-col="remarks" style="white-space: normal;">${escapeHTML(row.remarks || "NA")}</td>
            <td class="page-cell editable" data-col="page" style="text-align: center;">Page ${row.page || "NA"}</td>
            <td class="row-actions">
              <button class="row-btn btn-delete" title="Delete record"><i data-lucide="trash-2"></i></button>
            </td>
          `;
          maintenanceTableBody.appendChild(tr);
        });
      } else {
        filtered.forEach(row => {
          const tr = document.createElement("tr");
          tr.setAttribute("data-id", row.id);
          
          let tagClass = "tag-days";
          const routine = String(row.maintenance_routine || "").toLowerCase();
          if (routine.includes("hour")) tagClass = "tag-hours";
          if (routine.includes("month")) tagClass = "tag-months";
          if (routine.includes("year")) tagClass = "tag-years";

          tr.innerHTML = `
            <td class="page-cell" style="font-weight: 600;">#${row.id}</td>
            <td class="editable" data-col="equipment_title">${escapeHTML(row.equipment_title || "NA")}</td>
            <td class="editable" data-col="subsystem_component" style="font-weight: 500;">${escapeHTML(row.subsystem_component || "NA")}</td>
            <td class="editable" data-col="maintenance_routine"><span class="freq-tag ${tagClass}">${escapeHTML(row.maintenance_routine || "NA")}</span></td>
            <td class="editable" data-col="checks_instructions" style="white-space: normal; max-width: 350px;">${escapeHTML(row.checks_instructions || "NA")}</td>
            <td class="page-cell editable" data-col="page" style="text-align: center;">Page ${row.page || "NA"}</td>
            <td class="row-actions">
              <button class="row-btn btn-delete" title="Delete record"><i data-lucide="trash-2"></i></button>
            </td>
          `;
          maintenanceTableBody.appendChild(tr);
        });
      }
    }
  } else if (activeRegistryTab === "spare_parts") {
    // Spare Parts Tab
    sparePartsTableBody.innerHTML = "";
    
    filteredSpareParts = sparePartsRegistry.filter(row => {
      // 1. Search Text Query
      if (currentSearchQuery) {
        const q = currentSearchQuery.toLowerCase();
        const matchText = `${row.equipment_title} ${row.subsystem_location} ${row.item_no} ${row.part_name} ${row.part_number_code} ${row.drawing_model_no} ${row.oem_standard_body} ${row.part_categorization} ${row.quantity} ${row.frequency_of_use}`.toLowerCase();
        if (!matchText.includes(q)) return false;
      }

      // 2. Cognitive Chat Highlight Filter
      if (highlightRecordIds.length > 0) {
        if (!highlightRecordIds.includes(row.id)) return false;
      }
      
      return true;
    });
    filtered = filteredSpareParts;

    if (filtered.length === 0) {
      tableEmpty.style.display = "flex";
    } else {
      tableEmpty.style.display = "none";
      
      filtered.forEach(row => {
        const tr = document.createElement("tr");
        tr.setAttribute("data-id", row.id);

        tr.innerHTML = `
          <td class="page-cell" style="font-weight: 600;">#${row.id}</td>
          <td class="editable" data-col="equipment_title">${escapeHTML(row.equipment_title || "NA")}</td>
          <td class="editable" data-col="subsystem_location">${escapeHTML(row.subsystem_location || "NA")}</td>
          <td class="editable" data-col="item_no" style="font-family: monospace;">${escapeHTML(row.item_no || "NA")}</td>
          <td class="editable" data-col="part_name" style="font-weight: 500;">${escapeHTML(row.part_name || "NA")}</td>
          <td class="editable" data-col="part_number_code" style="font-family: monospace; color: var(--accent-cyan);">${escapeHTML(row.part_number_code || "NA")}</td>
          <td class="editable" data-col="drawing_model_no" style="font-family: monospace;">${escapeHTML(row.drawing_model_no || "NA")}</td>
          <td class="editable" data-col="oem_standard_body">${escapeHTML(row.oem_standard_body || "NA")}</td>
          <td class="editable" data-col="part_categorization" style="color: var(--accent-amber); font-weight: 500;"><span class="freq-tag tag-parts">${escapeHTML(row.part_categorization || "NA")}</span></td>
          <td class="editable" data-col="quantity" style="font-weight: 600; text-align: center; color: var(--text-main);">${escapeHTML(row.quantity || "NA")}</td>
          <td class="editable" data-col="recommended_stock_qty" style="font-weight: 600; text-align: center; color: var(--accent-green);">${escapeHTML(row.recommended_stock_qty || "NA")}</td>
          <td class="editable" data-col="warranty_period">${escapeHTML(row.warranty_period || "NA")}</td>
          <td class="editable" data-col="frequency_of_use" style="text-align: center;">${escapeHTML(row.frequency_of_use || "NA")}</td>
          <td class="page-cell editable" data-col="page" style="text-align: center;">Page ${row.page || "NA"}</td>
          <td class="row-actions">
            <button class="row-btn btn-delete" title="Delete record"><i data-lucide="trash-2"></i></button>
          </td>
        `;
        sparePartsTableBody.appendChild(tr);
      });
    }
  } else if (activeRegistryTab === "troubleshooting") {
    // Troubleshooting Tab
    troubleshootingTableBody.innerHTML = "";
    
    filteredTroubleshooting = troubleshootingRegistry.filter(row => {
      // 1. Search Text Query
      if (currentSearchQuery) {
        const q = currentSearchQuery.toLowerCase();
        const matchText = `${row.equipment_title} ${row.subsystem_component} ${row.problem} ${row.root_cause_solution}`.toLowerCase();
        if (!matchText.includes(q)) return false;
      }

      // 2. Cognitive Chat Highlight Filter
      if (highlightRecordIds.length > 0) {
        if (!highlightRecordIds.includes(row.id)) return false;
      }
      
      return true;
    });
    filtered = filteredTroubleshooting;

    if (filtered.length === 0) {
      tableEmpty.style.display = "flex";
    } else {
      tableEmpty.style.display = "none";
      
      filtered.forEach(row => {
        const tr = document.createElement("tr");
        tr.setAttribute("data-id", row.id);

        tr.innerHTML = `
          <td class="page-cell" style="font-weight: 600;">#${row.id}</td>
          <td class="editable" data-col="equipment_title">${escapeHTML(row.equipment_title || "NA")}</td>
          <td class="editable" data-col="subsystem_component" style="font-weight: 500;">${escapeHTML(row.subsystem_component || "NA")}</td>
          <td class="editable" data-col="problem" style="color: var(--accent-amber); font-weight: 500; white-space: normal;">${escapeHTML(row.problem || "NA")}</td>
          <td class="editable" data-col="root_cause_solution" style="white-space: normal;">${escapeHTML(row.root_cause_solution || "NA")}</td>
          <td class="page-cell editable" data-col="page" style="text-align: center;">Page ${row.page || "NA"}</td>
          <td class="row-actions">
            <button class="row-btn btn-delete" title="Delete record"><i data-lucide="trash-2"></i></button>
          </td>
        `;
        troubleshootingTableBody.appendChild(tr);
      });
    }
  }

  // Handle visibility of filter tab container and individual buttons
  const chatFilterChip = document.getElementById("chat-filter-chip");
  if (highlightRecordIds.length === 0 && chatFilterChip) {
    chatFilterChip.remove();
  }

  if (filterTabs) {
    const intervalButtons = filterTabs.querySelectorAll("[data-filter]");
    const activeChatFilterChip = document.getElementById("chat-filter-chip");

    if (activeRegistryTab === "maintenance") {
      filterTabs.style.display = "flex";
      intervalButtons.forEach(btn => btn.style.display = "block");
    } else {
      intervalButtons.forEach(btn => btn.style.display = "none");
      if (highlightRecordIds.length > 0 || activeChatFilterChip) {
        filterTabs.style.display = "flex";
      } else {
        filterTabs.style.display = "none";
      }
    }
  }
  
  safeCreateIcons();
  attachTableListeners();
  updateDashboardMetrics();
}

function escapeHTML(str) {
  if (!str) return '';
  return str.toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* -------------------------------------------------------------
 * 2. In-Line Grid Editing
 * ------------------------------------------------------------- */

function attachTableListeners() {
  // Cell double click editing
  const editables = document.querySelectorAll(".data-table td.editable");
  editables.forEach(cell => {
    cell.addEventListener("dblclick", function() {
      if (this.classList.contains("editing")) return;
      
      const col = this.getAttribute("data-col");
      const tr = this.closest("tr");
      const id = parseInt(tr.getAttribute("data-id"));
      const originalValue = this.innerText.replace("Page ", "");
      
      this.classList.add("editing");
      const input = document.createElement("input");
      input.type = "text";
      input.value = originalValue;
      this.innerHTML = "";
      this.appendChild(input);
      input.focus();
      
      const saveEdit = () => {
        let newValue = input.value.trim();
        this.classList.remove("editing");
        
        let record;
        if (activeRegistryTab === "maintenance") {
          record = maintenanceRegistry.find(r => r.id === id);
        } else if (activeRegistryTab === "spare_parts") {
          record = sparePartsRegistry.find(r => r.id === id);
        } else if (activeRegistryTab === "troubleshooting") {
          record = troubleshootingRegistry.find(r => r.id === id);
        }
        
        if (record) {
          if (col === "page") {
            newValue = parseInt(newValue) || "NA";
          }
          record[col] = newValue;
          
          // Self-Learning Loop: Save corrected record to learnedPatterns
          const patternToLearn = { ...record };
          delete patternToLearn.id;
          
          learnedPatterns.unshift({ type: activeRegistryTab, record: patternToLearn });
          if (learnedPatterns.length > 10) learnedPatterns.pop();
          
          try {
            localStorage.setItem("omniparse_learned_patterns", JSON.stringify(learnedPatterns));
          } catch(e) {}
        }
        renderGrid();
      };
      
      input.addEventListener("keydown", function(e) {
        if (e.key === "Enter") saveEdit();
        if (e.key === "Escape") {
          input.value = originalValue;
          saveEdit();
        }
      });
      
      input.addEventListener("blur", saveEdit);
    });
  });

  // Delete row button click
  const deleteBtns = document.querySelectorAll(".data-table .btn-delete");
  deleteBtns.forEach(btn => {
    btn.addEventListener("click", function() {
      const tr = this.closest("tr");
      const id = parseInt(tr.getAttribute("data-id"));
      if (activeRegistryTab === "maintenance") {
        maintenanceRegistry = maintenanceRegistry.filter(r => r.id !== id);
      } else if (activeRegistryTab === "spare_parts") {
        sparePartsRegistry = sparePartsRegistry.filter(r => r.id !== id);
      } else if (activeRegistryTab === "troubleshooting") {
        troubleshootingRegistry = troubleshootingRegistry.filter(r => r.id !== id);
      }
      renderGrid();
    });
  });
}

// Add Custom Record
addRowBtn.addEventListener("click", () => {
  let newId;
  if (activeRegistryTab === "maintenance") {
    newId = maintenanceRegistry.length > 0 ? Math.max(...maintenanceRegistry.map(r => r.id)) + 1 : 1;
    const newRow = activeEquipmentCategory === "Logbook" ? {
      id: newId,
      date: "NA",
      maintenance_work_description: "Maintenance Work Description",
      parts_renewed: "NA",
      attended_by: "NA",
      remarks: "NA",
      page: "NA"
    } : {
      id: newId,
      equipment_title: "Equipment Title",
      subsystem_component: "Sub-system / Component",
      maintenance_routine: "Monthly",
      checks_instructions: "Required Maintenance Checks / Instructions",
      page: "NA"
    };
    maintenanceRegistry.unshift(newRow);
  } else if (activeRegistryTab === "spare_parts") {
    newId = sparePartsRegistry.length > 0 ? Math.max(...sparePartsRegistry.map(r => r.id)) + 1 : 1;
    const newRow = {
      id: newId,
      equipment_title: "Equipment Title",
      subsystem_location: "Component Location",
      item_no: "NA",
      part_name: "Part Name / Description",
      part_number_code: "Part Number",
      drawing_model_no: "Drawing Number",
      oem_standard_body: "OEM Standard",
      part_categorization: "Critical Spare",
      quantity: "1",
      recommended_stock_qty: "1",
      warranty_period: "NA",
      frequency_of_use: "NA",
      page: "NA"
    };
    sparePartsRegistry.unshift(newRow);
  } else if (activeRegistryTab === "troubleshooting") {
    newId = troubleshootingRegistry.length > 0 ? Math.max(...troubleshootingRegistry.map(r => r.id)) + 1 : 1;
    const newRow = {
      id: newId,
      equipment_title: "Equipment Title",
      subsystem_component: "Sub-system / Component",
      problem: "Problem Description",
      root_cause_solution: "Root Cause / Solution",
      page: "NA"
    };
    troubleshootingRegistry.unshift(newRow);
  }
  
  renderGrid();
  
  // Automatically open edit on the first column of the newly inserted row
  setTimeout(() => {
    let tableId = "maintenance-table";
    if (activeRegistryTab === "spare_parts") tableId = "spare-parts-table";
    else if (activeRegistryTab === "troubleshooting") tableId = "troubleshooting-table";
    const firstCell = document.querySelector(`#${tableId} tr[data-id="${newId}"] td.editable`);
    if (firstCell) {
      const event = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
      firstCell.dispatchEvent(event);
    }
  }, 50);
});

// Search grid bar
gridSearch.addEventListener("input", (e) => {
  currentSearchQuery = e.target.value;
  highlightRecordIds = []; // clear AI search highlights when manual filtering
  renderGrid();
});

// Filter Tabs (only applicable to Maintenance interval filtering)
filterTabs.addEventListener("click", (e) => {
  const tab = e.target.closest(".tab-btn");
  if (!tab) return;
  
  document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
  tab.classList.add("active");
  currentTabFilter = tab.getAttribute("data-filter");
  highlightRecordIds = []; // clear AI highlights
  renderGrid();
});

/* -------------------------------------------------------------
 * 3. SheetJS High-Fidelity Excel Export
 * ------------------------------------------------------------- */

exportBtn.addEventListener("click", () => {
  if (activeRegistryTab === "maintenance") {
    if (filteredMaintenance.length === 0) {
      alert("No maintenance records to export.");
      return;
    }

    const wb = XLSX.utils.book_new();
    let exportMaint;
    let colsMaint;
    
    if (activeEquipmentCategory === "Logbook") {
      exportMaint = filteredMaintenance.map(r => ({
        "Record ID": `#${r.id}`,
        "Date": r.date || "NA",
        "Maintenance Work Description": r.maintenance_work_description || "NA",
        "Parts Renewed": r.parts_renewed || "NA",
        "Attended By": r.attended_by || "NA",
        "Remarks": r.remarks || "NA",
        "Source Page Reference": r.page === "NA" ? "NA" : `Page ${r.page}`
      }));
      colsMaint = [
        { wch: 10 }, // ID
        { wch: 15 }, // Date
        { wch: 45 }, // Description
        { wch: 25 }, // Parts
        { wch: 20 }, // Attended By
        { wch: 45 }, // Remarks
        { wch: 15 }  // Page Reference
      ];
    } else {
      exportMaint = filteredMaintenance.map(r => ({
        "Record ID": `#${r.id}`,
        "Equipment Title": r.equipment_title || "NA",
        "Sub-system / Component": r.subsystem_component || "NA",
        "Maintenance Routine / Interval": r.maintenance_routine || "NA",
        "Required Maintenance Checks / Instructions": r.checks_instructions || "NA",
        "Source Page Reference": r.page === "NA" ? "NA" : `Page ${r.page}`
      }));
      
      colsMaint = [
        { wch: 10 }, // ID
        { wch: 22 }, // Equipment Title
        { wch: 28 }, // Sub-system / Component
        { wch: 25 }, // Routine / Interval
        { wch: 65 }, // Checks / Instructions
        { wch: 15 }  // Page Reference
      ];
    }
    
    const wsMaint = XLSX.utils.json_to_sheet(exportMaint);
    wsMaint['!cols'] = colsMaint;
    XLSX.utils.book_append_sheet(wb, wsMaint, "Maintenance Tasks");

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `OmniParse_Maintenance_Tasks_${dateStr}.xlsx`;
    XLSX.writeFile(wb, filename);
  } else if (activeRegistryTab === "spare_parts") {
    if (filteredSpareParts.length === 0) {
      alert("No spare parts records to export.");
      return;
    }

    const wb = XLSX.utils.book_new();
    const exportParts = filteredSpareParts.map(r => ({
      "Record ID": `#${r.id}`,
      "Equipment Title": r.equipment_title || "NA",
      "Sub-system / Component Location": r.subsystem_location || "NA",
      "Item No.": r.item_no || "NA",
      "Part Name / Description": r.part_name || "NA",
      "Manufacturer Part Number / Code": r.part_number_code || "NA",
      "Drawing / Model Number": r.drawing_model_no || "NA",
      "OEM / Standard Body": r.oem_standard_body || "NA",
      "Part Categorization": r.part_categorization || "NA",
      "Quantity": r.quantity || "NA",
      "Recommended Stock QTY": r.recommended_stock_qty || "NA",
      "Warranty Period": r.warranty_period || "NA",
      "Frequency of Use": r.frequency_of_use || "NA",
      "Source Page Reference": r.page === "NA" ? "NA" : `Page ${r.page}`
    }));

    const wsParts = XLSX.utils.json_to_sheet(exportParts);
    const colsParts = [
      { wch: 10 }, // ID
      { wch: 22 }, // Equipment Title
      { wch: 28 }, // Location
      { wch: 10 }, // Item No.
      { wch: 28 }, // Name
      { wch: 25 }, // Part Number
      { wch: 22 }, // Drawing
      { wch: 20 }, // OEM
      { wch: 20 }, // Categorization
      { wch: 12 }, // Quantity
      { wch: 15 }, // Recommended Stock
      { wch: 15 }, // Warranty Period
      { wch: 22 }, // Frequency of Use
      { wch: 15 }  // Page Reference
    ];
    wsParts['!cols'] = colsParts;
    XLSX.utils.book_append_sheet(wb, wsParts, "Spare Parts & Components");

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `OmniParse_Spare_Parts_${dateStr}.xlsx`;
    XLSX.writeFile(wb, filename);
  } else if (activeRegistryTab === "troubleshooting") {
    if (filteredTroubleshooting.length === 0) {
      alert("No troubleshooting records to export.");
      return;
    }

    const wb = XLSX.utils.book_new();
    const exportTrouble = filteredTroubleshooting.map(r => ({
      "Record ID": `#${r.id}`,
      "Equipment Title": r.equipment_title || "NA",
      "Sub-system / Component": r.subsystem_component || "NA",
      "Problem / Symptom": r.problem || "NA",
      "Root Cause / Solution": r.root_cause_solution || "NA",
      "Source Page Reference": r.page === "NA" ? "NA" : `Page ${r.page}`
    }));

    const wsTrouble = XLSX.utils.json_to_sheet(exportTrouble);
    const colsTrouble = [
      { wch: 10 }, // ID
      { wch: 22 }, // Equipment Title
      { wch: 28 }, // Sub-system
      { wch: 35 }, // Problem
      { wch: 65 }, // Root Cause
      { wch: 15 }  // Page Reference
    ];
    wsTrouble['!cols'] = colsTrouble;
    XLSX.utils.book_append_sheet(wb, wsTrouble, "Troubleshooting");

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `OmniParse_Troubleshooting_${dateStr}.xlsx`;
    XLSX.writeFile(wb, filename);
  }
});

/* -------------------------------------------------------------
 * 4. Document File Reader Scraper (PDF.js)
 * ------------------------------------------------------------- */

// Drop zone hover drag indicators
['dragenter', 'dragover'].forEach(eventName => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  }, false);
});

['dragleave', 'drop'].forEach(eventName => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
  }, false);
});

// Drop handler
dropZone.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  const files = dt.files;
  if (files && files.length > 0) {
    handleFileUpload(files[0]);
  }
});

browseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});

// Clicking anywhere on the drop zone (not just the "browse files" link) opens the file picker
dropZone.addEventListener('click', (e) => {
  if (isExtracting || e.target.closest('#progress-overlay')) return;
  fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleFileUpload(e.target.files[0]);
  }
});



const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024; // 50MB, matches UI copy

async function handleFileUpload(file) {
  if (isExtracting) {
    alert("An extraction is already in progress. Please wait for it to finish or cancel it first.");
    return;
  }

  const extension = file.name.split('.').pop().toLowerCase();
  
  if (extension !== 'pdf' && extension !== 'txt' && extension !== 'jpg' && extension !== 'jpeg' && extension !== 'png') {
    alert("Unsupported file format! Please upload a PDF, TXT, or Image (JPG/PNG).");
    return;
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    alert(`File is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maximum supported size is 50MB.`);
    return;
  }

  // Starting a new document replaces the previous registries rather than merging into them
  if (maintenanceRegistry.length > 0 || sparePartsRegistry.length > 0 || troubleshootingRegistry.length > 0) {
    const proceed = confirm(`Loading "${file.name}" will clear the current registry data (${maintenanceRegistry.length} maintenance, ${sparePartsRegistry.length} spare parts, ${troubleshootingRegistry.length} troubleshooting records). Continue?`);
    if (!proceed) return;
  }
  maintenanceRegistry = [];
  sparePartsRegistry = [];
  troubleshootingRegistry = [];
  highlightRecordIds = [];
  renderGrid();

  // Claim the extraction lock immediately so a second file dropped during the
  // async FileReader setup below can't sneak in before the sub-parsers set it themselves
  isExtracting = true;

  // Active parser overlay animations
  progressOverlay.classList.add("active");
  progressFill.style.width = "0%";
  progressTitle.innerText = `Processing "${file.name}"`;
  progressStatus.innerText = "Initializing file reader...";

  try {
    if (extension === 'pdf') {
      await extractPDFText(file);
    } else if (extension === 'txt') {
      await extractTXTText(file);
    } else {
      await extractImageText(file);
    }
  } catch (error) {
    console.error(error);
    alert(`Error parsing document: ${error.message}`);
    progressOverlay.classList.remove("active");
    isExtracting = false;
  }
}



// Read plain text manual
function extractTXTText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async function(e) {
      const text = e.target.result;
      
      // Setup loaded pages as simple single block
      loadedPages = [{ pageNum: 1, text: text }];
      isExtracting = true;
      abortExtraction = false;
      
      try {
        let maintCount = 0;
        let sparesCount = 0;
        let troubleCount = 0;
        let llmChunksProcessed = 0;
        let totalChunksCount = 0;
        
        if (engineMode === "ollama" || engineMode === "gemini") {
          const engineLabel = engineMode === "gemini" ? `Gemini (${geminiModel})` : `Ollama (${ollamaModel})`;
          const maxChunkSize = 8000;
          if (text.length > maxChunkSize) {
            let chunks = [];
            let i = 0;
            while (i < text.length) {
              let end = i + maxChunkSize;
              if (end < text.length) {
                // Find nearest newline within the last 500 chars of the chunk
                const searchWindow = text.substring(Math.max(i, end - 500), end);
                const lastNewline = searchWindow.lastIndexOf('\n');
                if (lastNewline !== -1) {
                  end = end - 500 + lastNewline + 1; // Split right after newline
                }
              }
              chunks.push(text.substring(i, end));
              i = end;
            }
            totalChunksCount = chunks.length;
            appendChatSystemMessage(`Text manual is large. Splitting into **${chunks.length} chunks** for ${engineLabel} processing...`);
            
            for (let idx = 0; idx < chunks.length; idx++) {
              if (abortExtraction) {
                appendChatSystemMessage("Extraction aborted by user.");
                break;
              }
              if (!shouldProcessPageWithLLM(chunks[idx])) {
                console.log(`Skipping chunk ${idx + 1} of ${chunks.length}: no relevant keywords.`);
                continue;
              }
              llmChunksProcessed++;
              progressStatus.innerText = `Processing chunk ${idx + 1} of ${chunks.length} with ${engineLabel}...`;
              progressFill.style.width = `${Math.round(((idx + 1) / chunks.length) * 100)}%`;
              
              const result = await runLLMExtractor(chunks[idx], file.name, 1);
              if (result.maintenance && result.maintenance.length > 0) {
                maintCount += result.maintenance.length;
                const startingId = maintenanceRegistry.length > 0 ? Math.max(...maintenanceRegistry.map(r => r.id)) + 1 : 1;
                result.maintenance.forEach((r, rIdx) => r.id = startingId + rIdx);
                maintenanceRegistry = [...maintenanceRegistry, ...result.maintenance];
              }
              if (result.spare_parts && result.spare_parts.length > 0) {
                sparesCount += result.spare_parts.length;
                const startingId = sparePartsRegistry.length > 0 ? Math.max(...sparePartsRegistry.map(r => r.id)) + 1 : 1;
                result.spare_parts.forEach((r, rIdx) => r.id = startingId + rIdx);
                sparePartsRegistry = [...sparePartsRegistry, ...result.spare_parts];
              }
              if (result.troubleshooting && result.troubleshooting.length > 0) {
                troubleCount += result.troubleshooting.length;
                const startingId = troubleshootingRegistry.length > 0 ? Math.max(...troubleshootingRegistry.map(r => r.id)) + 1 : 1;
                result.troubleshooting.forEach((r, rIdx) => r.id = startingId + rIdx);
                troubleshootingRegistry = [...troubleshootingRegistry, ...result.troubleshooting];
              }
              renderGrid();
            }
          } else {
            if (!shouldProcessPageWithLLM(text)) {
              appendChatSystemMessage(`Skipped processing manual text with ${engineLabel}: no relevant keywords found.`);
            } else {
              llmChunksProcessed = 1;
              totalChunksCount = 1;
              progressStatus.innerText = `Extracting using ${engineLabel}...`;
              progressFill.style.width = "50%";
              const result = await runLLMExtractor(text, file.name, 1);
              if (result.maintenance && result.maintenance.length > 0) {
                maintCount += result.maintenance.length;
                const startingId = maintenanceRegistry.length > 0 ? Math.max(...maintenanceRegistry.map(r => r.id)) + 1 : 1;
                result.maintenance.forEach((r, rIdx) => r.id = startingId + rIdx);
                maintenanceRegistry = [...maintenanceRegistry, ...result.maintenance];
              }
              if (result.spare_parts && result.spare_parts.length > 0) {
                sparesCount += result.spare_parts.length;
                const startingId = sparePartsRegistry.length > 0 ? Math.max(...sparePartsRegistry.map(r => r.id)) + 1 : 1;
                result.spare_parts.forEach((r, rIdx) => r.id = startingId + rIdx);
                sparePartsRegistry = [...sparePartsRegistry, ...result.spare_parts];
              }
              if (result.troubleshooting && result.troubleshooting.length > 0) {
                troubleCount += result.troubleshooting.length;
                const startingId = troubleshootingRegistry.length > 0 ? Math.max(...troubleshootingRegistry.map(r => r.id)) + 1 : 1;
                result.troubleshooting.forEach((r, rIdx) => r.id = startingId + rIdx);
                troubleshootingRegistry = [...troubleshootingRegistry, ...result.troubleshooting];
              }
            }
          }
        } else {
          // Heuristics Mode
          const result = runRuleExtractorHeuristics(text, file.name);
          if (result.maintenance && result.maintenance.length > 0) {
            maintCount += result.maintenance.length;
            const startingId = maintenanceRegistry.length > 0 ? Math.max(...maintenanceRegistry.map(r => r.id)) + 1 : 1;
            result.maintenance.forEach((r, rIdx) => r.id = startingId + rIdx);
            maintenanceRegistry = [...maintenanceRegistry, ...result.maintenance];
          }
          if (result.spare_parts && result.spare_parts.length > 0) {
            sparesCount += result.spare_parts.length;
            const startingId = sparePartsRegistry.length > 0 ? Math.max(...sparePartsRegistry.map(r => r.id)) + 1 : 1;
            result.spare_parts.forEach((r, rIdx) => r.id = startingId + rIdx);
            sparePartsRegistry = [...sparePartsRegistry, ...result.spare_parts];
          }
          if (result.troubleshooting && result.troubleshooting.length > 0) {
            troubleCount += result.troubleshooting.length;
            const startingId = troubleshootingRegistry.length > 0 ? Math.max(...troubleshootingRegistry.map(r => r.id)) + 1 : 1;
            result.troubleshooting.forEach((r, rIdx) => r.id = startingId + rIdx);
            troubleshootingRegistry = [...troubleshootingRegistry, ...result.troubleshooting];
          }
        }
        
        progressFill.style.width = "100%";
        progressStatus.innerText = `Complete!`;
        
        setTimeout(() => {
          progressOverlay.classList.remove("active");
          activeDocName.innerHTML = `<i data-lucide="file-text"></i><span>${escapeHTML(file.name)}</span>`;
          activeDocName.style.borderColor = "var(--accent-cyan-glow)";
          activeDocName.style.color = "var(--accent-cyan)";
          activeDocName.style.background = "hsla(190, 90%, 50%, 0.05)";
          safeCreateIcons();
          
          const labelModeText = engineMode === "ollama" ? `local LLM (${ollamaModel}) processing ${llmChunksProcessed} / ${totalChunksCount} chunks` : engineMode === "gemini" ? `Gemini API (${geminiModel}) processing ${llmChunksProcessed} / ${totalChunksCount} chunks` : "heuristics";
          appendChatSystemMessage(`Successfully parsed text manual **"${file.name}"** using **${labelModeText}**! Extracted **${maintCount}** tasks, **${sparesCount}** spare parts, and **${troubleCount}** troubleshooting issues into the registries.`);
          renderGrid();
          isExtracting = false;
          resolve();
        }, 1000);
        
      } catch (err) {
        console.error("LLM text parsing failed:", err);
        alert(`${engineMode === "gemini" ? "Gemini API" : "Ollama"} parsing failed: ${err.message}. Falling back to client Heuristics.`);
        const fallbackResult = runRuleExtractorHeuristics(text, file.name);
        if (fallbackResult.maintenance && fallbackResult.maintenance.length > 0) {
          const startingId = maintenanceRegistry.length > 0 ? Math.max(...maintenanceRegistry.map(r => r.id)) + 1 : 1;
          fallbackResult.maintenance.forEach((r, rIdx) => r.id = startingId + rIdx);
          maintenanceRegistry = [...maintenanceRegistry, ...fallbackResult.maintenance];
        }
        if (fallbackResult.spare_parts && fallbackResult.spare_parts.length > 0) {
          const startingId = sparePartsRegistry.length > 0 ? Math.max(...sparePartsRegistry.map(r => r.id)) + 1 : 1;
          fallbackResult.spare_parts.forEach((r, rIdx) => r.id = startingId + rIdx);
          sparePartsRegistry = [...sparePartsRegistry, ...fallbackResult.spare_parts];
        }
        progressOverlay.classList.remove("active");
        renderGrid();
        isExtracting = false;
        resolve();
      }
    };
    reader.onerror = () => {
      isExtracting = false;
      reject(new Error("File reading failed."));
    };
    reader.readAsText(file);
  });
}

// Resolve the optional "From Page" / "To Page" inputs into a valid, clamped
// [start, end] range for the given document. Blank/invalid inputs fall back
// to parsing the entire document (start=1, end=totalPages).
function resolvePageRange(totalPages) {
  let start = parseInt(pageRangeStartInput && pageRangeStartInput.value, 10);
  let end = parseInt(pageRangeEndInput && pageRangeEndInput.value, 10);
  const hasStart = !isNaN(start) && start > 0;
  const hasEnd = !isNaN(end) && end > 0;

  if (!hasStart && !hasEnd) {
    return { start: 1, end: totalPages, isPartial: false };
  }

  if (!hasStart) start = 1;
  if (!hasEnd) end = totalPages;

  // Clamp into valid document bounds, and swap if entered backwards
  start = Math.max(1, Math.min(start, totalPages));
  end = Math.max(1, Math.min(end, totalPages));
  if (end < start) {
    const tmp = start;
    start = end;
    end = tmp;
  }

  return { start, end, isPartial: (start !== 1 || end !== totalPages) };
}

// Scrape text content page-by-page using client PDF.js
function extractPDFText(file) {
  return new Promise((resolve, reject) => {
    const fileReader = new FileReader();
    fileReader.onload = async function() {
      const typedarray = new Uint8Array(this.result);
      isExtracting = true;
      abortExtraction = false;
      
      try {
        const pdf = await pdfjsLib.getDocument(typedarray).promise;
        const totalPages = pdf.numPages;
        const { start: rangeStart, end: rangeEnd, isPartial: isPartialRange } = resolvePageRange(totalPages);
        loadedPages = [];
        let compiledText = "";
        let maintCount = 0;
        let sparesCount = 0;
        let troubleCount = 0;
        let llmPagesProcessed = 0;
        let prevPageWasIndex = false;

        if (isPartialRange) {
          appendChatSystemMessage(`Parsing only pages **${rangeStart}\u2013${rangeEnd}** of **${totalPages}** total pages, as requested.`);
        }

        for (let pageNum = rangeStart; pageNum <= rangeEnd; pageNum++) {
          if (abortExtraction) {
            appendChatSystemMessage("Extraction stopped by user request.");
            break;
          }
          
          progressTitle.innerText = isPartialRange
            ? `Parsing Page ${pageNum} of ${totalPages} (Range ${rangeStart}-${rangeEnd})`
            : `Parsing Page ${pageNum} of ${totalPages}`;
          const progressPercent = Math.round(((pageNum - rangeStart + 1) / (rangeEnd - rangeStart + 1)) * 100);
          progressFill.style.width = `${progressPercent}%`;
          
          if (engineMode === "ollama" || engineMode === "gemini") {
            progressStatus.innerText = `Scraping page ${pageNum} text content...`;
          } else {
            progressStatus.innerText = "Extracting layout string layers...";
          }
          
          const page = await pdf.getPage(pageNum);
          let pageText = "";
          let base64Image = null;

          if ((engineMode === "ollama" || engineMode === "gemini") && parseStrategy === "ocr") {
            const viewport = page.getViewport({ scale: 1.0 });
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            await page.render({ canvasContext: ctx, viewport: viewport }).promise;
            base64Image = canvas.toDataURL('image/jpeg').split(',')[1];
            pageText = "OCR VISION EXTRACTION - Use provided image to extract text.";
          } else {
            const textContent = await page.getTextContent();
            pageText = buildTextFromPdfTextContent(textContent);
          }
          
          loadedPages.push({ pageNum: pageNum, text: pageText });
          compiledText += ` ${pageText}`;

          const isIndexPage = isLikelyIndexOrTOCPage(pageText, pageNum);
          const isLikelyContinuation = prevPageWasIndex && pageNum <= 8 && (pageText.match(/(?:\.{2,}\s*)?\d{1,3}\b/g) || []).length >= 5;
          if (isIndexPage || isLikelyContinuation) {
            prevPageWasIndex = true;
            console.log(`Skipping Page ${pageNum}: detected as TOC/Index page.`);
            continue;
          }
          prevPageWasIndex = false;

          if (engineMode === "ollama" || engineMode === "gemini") {
            const engineLabel = engineMode === "gemini" ? "Gemini" : "Ollama";
            if (engineMode === "ollama" && parseStrategy === "ocr" && pageNum === 1) {
              const lowerModel = ollamaModel.toLowerCase();
              if (!lowerModel.includes("vision") && !lowerModel.includes("llava") && !lowerModel.includes("minicpm") && !lowerModel.includes("qwen")) {
                appendChatSystemMessage(`⚠️ **Model Warning**: You are using OCR Vision mode with **${ollamaModel}**, which appears to be a text-only model! Vision extraction will fail and return 0 results. Please select a vision model (e.g., \`llama3.2-vision\` or \`llava\`).`);
              }
            }

            if (parseStrategy !== "ocr" && !shouldProcessPageWithLLM(pageText)) {
              console.log(`Skipping Page ${pageNum} in ${engineLabel} mode: no high-value maintenance/parts keywords found.`);
              continue;
            }
            llmPagesProcessed++;
            progressStatus.innerText = `${engineLabel}: Extracting from Page ${pageNum}...`;
            try {
              const result = await runLLMExtractor(pageText, file.name, pageNum, base64Image);
              if (result.maintenance && result.maintenance.length > 0) {
                maintCount += result.maintenance.length;
                const startingId = maintenanceRegistry.length > 0 ? Math.max(...maintenanceRegistry.map(r => r.id)) + 1 : 1;
                result.maintenance.forEach((r, rIdx) => r.id = startingId + rIdx);
                maintenanceRegistry = [...maintenanceRegistry, ...result.maintenance];
              }
              if (result.spare_parts && result.spare_parts.length > 0) {
                sparesCount += result.spare_parts.length;
                const startingId = sparePartsRegistry.length > 0 ? Math.max(...sparePartsRegistry.map(r => r.id)) + 1 : 1;
                result.spare_parts.forEach((r, rIdx) => r.id = startingId + rIdx);
                sparePartsRegistry = [...sparePartsRegistry, ...result.spare_parts];
              }
              if (result.troubleshooting && result.troubleshooting.length > 0) {
                troubleCount += result.troubleshooting.length;
                const startingId = troubleshootingRegistry.length > 0 ? Math.max(...troubleshootingRegistry.map(r => r.id)) + 1 : 1;
                result.troubleshooting.forEach((r, rIdx) => r.id = startingId + rIdx);
                troubleshootingRegistry = [...troubleshootingRegistry, ...result.troubleshooting];
              }
              renderGrid();
            } catch (err) {
              console.warn(`${engineLabel} failed on Page ${pageNum}:`, err);
              if (base64Image) {
                // Heuristics cannot process images, so there is no safe fallback for OCR pages.
                appendChatSystemMessage(`⚠️ **Page ${pageNum} Warning**: Failed to parse with ${engineLabel}. Skipping page...`);
              } else {
                appendChatSystemMessage(`⚠️ **Page ${pageNum} Warning**: Failed to parse with ${engineLabel} (${err.message}). Falling back to heuristics for this page...`);
                const fallbackResult = runRuleExtractorHeuristics(pageText, file.name, pageNum);
                if (fallbackResult.maintenance && fallbackResult.maintenance.length > 0) {
                  maintCount += fallbackResult.maintenance.length;
                  const startingId = maintenanceRegistry.length > 0 ? Math.max(...maintenanceRegistry.map(r => r.id)) + 1 : 1;
                  fallbackResult.maintenance.forEach((r, rIdx) => r.id = startingId + rIdx);
                  maintenanceRegistry = [...maintenanceRegistry, ...fallbackResult.maintenance];
                }
                if (fallbackResult.spare_parts && fallbackResult.spare_parts.length > 0) {
                  sparesCount += fallbackResult.spare_parts.length;
                  const startingId = sparePartsRegistry.length > 0 ? Math.max(...sparePartsRegistry.map(r => r.id)) + 1 : 1;
                  fallbackResult.spare_parts.forEach((r, rIdx) => r.id = startingId + rIdx);
                  sparePartsRegistry = [...sparePartsRegistry, ...fallbackResult.spare_parts];
                }
                if (fallbackResult.troubleshooting && fallbackResult.troubleshooting.length > 0) {
                  troubleCount += fallbackResult.troubleshooting.length;
                  const startingId = troubleshootingRegistry.length > 0 ? Math.max(...troubleshootingRegistry.map(r => r.id)) + 1 : 1;
                  fallbackResult.troubleshooting.forEach((r, rIdx) => r.id = startingId + rIdx);
                  troubleshootingRegistry = [...troubleshootingRegistry, ...fallbackResult.troubleshooting];
                }
                renderGrid();
              }
            }
          } else {
            // Heuristics Page level extractor
            const result = runRuleExtractorHeuristics(pageText, file.name, pageNum);
            if (result.maintenance && result.maintenance.length > 0) {
              maintCount += result.maintenance.length;
              const startingId = maintenanceRegistry.length > 0 ? Math.max(...maintenanceRegistry.map(r => r.id)) + 1 : 1;
              result.maintenance.forEach((r, rIdx) => r.id = startingId + rIdx);
              maintenanceRegistry = [...maintenanceRegistry, ...result.maintenance];
            }
            if (result.spare_parts && result.spare_parts.length > 0) {
              sparesCount += result.spare_parts.length;
              const startingId = sparePartsRegistry.length > 0 ? Math.max(...sparePartsRegistry.map(r => r.id)) + 1 : 1;
              result.spare_parts.forEach((r, rIdx) => r.id = startingId + rIdx);
              sparePartsRegistry = [...sparePartsRegistry, ...result.spare_parts];
            }
            if (result.troubleshooting && result.troubleshooting.length > 0) {
              troubleCount += result.troubleshooting.length;
              const startingId = troubleshootingRegistry.length > 0 ? Math.max(...troubleshootingRegistry.map(r => r.id)) + 1 : 1;
              result.troubleshooting.forEach((r, rIdx) => r.id = startingId + rIdx);
              troubleshootingRegistry = [...troubleshootingRegistry, ...result.troubleshooting];
            }
            renderGrid();
          }
        }

        progressFill.style.width = "100%";
        progressStatus.innerText = `Extraction finished!`;
        
        setTimeout(() => {
          progressOverlay.classList.remove("active");
          activeDocName.innerHTML = `<i data-lucide="file-text"></i><span>${escapeHTML(file.name)}</span>`;
          activeDocName.style.borderColor = "var(--accent-cyan-glow)";
          activeDocName.style.color = "var(--accent-cyan)";
          activeDocName.style.background = "hsla(190, 90%, 50%, 0.05)";
          safeCreateIcons();
          
          const pagesInRange = rangeEnd - rangeStart + 1;
          const labelModeText = engineMode === "ollama" ? `local LLM (${ollamaModel}) processing ${llmPagesProcessed} / ${pagesInRange} pages` : engineMode === "gemini" ? `Gemini API (${geminiModel}) processing ${llmPagesProcessed} / ${pagesInRange} pages` : "heuristics";
          const rangeLabel = isPartialRange ? `pages ${rangeStart}-${rangeEnd} of ${totalPages}` : `${totalPages} pages`;
          appendChatSystemMessage(`Completed client-side PDF processing for **"${file.name}"** (${rangeLabel}) using **${labelModeText}**. Extracted **${maintCount}** tasks, **${sparesCount}** spare parts, and **${troubleCount}** troubleshooting issues into the registries.`);
          
          // Warn if it seems to be a scanned document
          if (maintCount === 0 && sparesCount === 0 && troubleCount === 0 && compiledText.trim().length < 200) {
            appendChatSystemMessage(`⚠️ **Document Scan Warning**: No searchable text layers were detected in **"${file.name}"**. The PDF may be composed of scanned page images. Please ensure the manual has selectable text or try converting it to a plain text (.txt) file.`);
          }
          
          renderGrid();
          isExtracting = false;
          resolve();
        }, 1200);

      } catch (err) {
        isExtracting = false;
        reject(err);
      }
    };
    
    fileReader.readAsArrayBuffer(file);
  });
}

async function extractImageText(file) {
  // isExtracting lock is already claimed by handleFileUpload() before this runs
  return new Promise((resolve, reject) => {
    const fileReader = new FileReader();
    
    fileReader.onload = async function() {
      try {
        const base64Data = fileReader.result.split(',')[1];
        
        const engineLabel = engineMode === "gemini" ? `Gemini (${geminiModel})` : `Ollama (${ollamaModel})`;
        progressFill.style.width = "50%";
        progressStatus.innerText = `Analyzing image with ${engineLabel}...`;
        
        let maintCount = 0;
        let sparesCount = 0;
        let troubleCount = 0;
        let notesCount = 0;

        if (engineMode === "ollama" || engineMode === "gemini") {
          try {
            const result = await runLLMExtractor("OCR VISION EXTRACTION", file.name, 1, base64Data, file.type || "image/jpeg");
            if (result.maintenance && result.maintenance.length > 0) {
              maintCount += result.maintenance.length;
              const startingId = maintenanceRegistry.length > 0 ? Math.max(...maintenanceRegistry.map(r => r.id)) + 1 : 1;
              result.maintenance.forEach((r, rIdx) => r.id = startingId + rIdx);
              maintenanceRegistry = [...maintenanceRegistry, ...result.maintenance];
            }
            if (result.spare_parts && result.spare_parts.length > 0) {
              sparesCount += result.spare_parts.length;
              const startingId = sparePartsRegistry.length > 0 ? Math.max(...sparePartsRegistry.map(r => r.id)) + 1 : 1;
              result.spare_parts.forEach((r, rIdx) => r.id = startingId + rIdx);
              sparePartsRegistry = [...sparePartsRegistry, ...result.spare_parts];
            }
            if (result.troubleshooting && result.troubleshooting.length > 0) {
              troubleCount += result.troubleshooting.length;
              const startingId = troubleshootingRegistry.length > 0 ? Math.max(...troubleshootingRegistry.map(r => r.id)) + 1 : 1;
              result.troubleshooting.forEach((r, rIdx) => r.id = startingId + rIdx);
              troubleshootingRegistry = [...troubleshootingRegistry, ...result.troubleshooting];
            }
            renderGrid();
          } catch (err) {
            console.warn(`${engineLabel} failed on image:`, err);
            appendChatSystemMessage(`⚠️ **Image Warning**: Failed to parse with ${engineLabel}. ${engineMode === "ollama" ? "Ensure you are using a vision model." : "Check your API key and model name."}`);
          }
        } else {
          appendChatSystemMessage(`⚠️ **Image Processing**: Heuristics engine cannot process images. Please select 'Ollama' or 'Gemini API' mode instead.`);
        }
        
        progressFill.style.width = "100%";
        progressStatus.innerText = `Extraction finished!`;
        
        setTimeout(() => {
          progressOverlay.classList.remove("active");
          activeDocName.innerHTML = `<i data-lucide="file-text"></i><span>${escapeHTML(file.name)}</span>`;
          activeDocName.style.borderColor = "var(--accent-cyan-glow)";
          activeDocName.style.color = "var(--accent-cyan)";
          activeDocName.style.background = "hsla(190, 90%, 50%, 0.05)";
          safeCreateIcons();
          
          appendChatSystemMessage(`Completed client-side image processing for **"${file.name}"** using **${engineLabel}**. Extracted **${maintCount}** tasks, **${sparesCount}** spare parts, and **${troubleCount}** troubleshooting issues into the registries.`);
          
          renderGrid();
          isExtracting = false;
          resolve();
        }, 1200);

      } catch (err) {
        isExtracting = false;
        reject(err);
      }
    };
    
    fileReader.readAsDataURL(file);
  });
}

// Cognitive Contextual Text Extraction Heuristics
function runRuleExtractorHeuristics(text, docName, pageNum = 1) {
  if (isLikelyIndexOrTOCPage(text, pageNum)) {
    return {
      maintenance: [],
      spare_parts: [],
      troubleshooting: []
    };
  }

  if (isRecommendedSparePartsPage(text)) {
    const spareParts = parseSparePartsStructurally(text, docName, pageNum);
    return {
      maintenance: [],
      spare_parts: spareParts,
      troubleshooting: []
    };
  }

  const partKeywords = ["bearing", "filter", "friction plate", "pad", "disc", "valve", "coupling", "seal", "clamp", "stopper", "nut", "bolt", "accumulator", "gasket", "spring", "hose", "pipe", "pump", "block", "roller", "screw", "pin", "wire", "rope", "plug", "motor", "gear", "reducer", "coupler", "fitting", "caliper", "drum", "shaft", "skid", "plates", "groove", "gearbox", "sump", "oil", "grease", "lubricant", "engine", "compressor", "air cleaner", "battery", "radiator", "tank", "cable", "winch", "tophead", "coolant", "fuel", "hydraulic"];

  // 1. Logbook Heuristics Mode
  if (activeEquipmentCategory === "Logbook") {
    const output = {
      maintenance: [],
      spare_parts: [],
      troubleshooting: []
    };
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const dateRegex = /\b(?:\d{1,2}[-/.\s](?:[A-Za-z]{3,10}|\d{1,2})[-/.\s]\d{2,4}|\d{4}[-/.\s]\d{1,2}[-/.\s]\d{1,2})\b/i;

    lines.forEach(line => {
      if (line.length < 10) return;
      if (/date|work description|parts renewed|attended|remarks/i.test(line) && line.split(/\s+/).length < 6) return;
      
      const dateMatch = line.match(dateRegex);
      const dateStr = dateMatch ? dateMatch[0] : "NA";
      
      let workDesc = line;
      if (dateMatch) {
        workDesc = line.replace(dateRegex, "").trim();
      }
      workDesc = workDesc.replace(/^[\s|:\-]+/, "").trim();
      
      const partsFound = [];
      partKeywords.forEach(pk => {
        if (new RegExp(`\\b${pk}s?\\b`, 'i').test(line)) {
          partsFound.push(pk.charAt(0).toUpperCase() + pk.slice(1));
        }
      });
      const partsRenewed = partsFound.length > 0 ? partsFound.join(", ") : "NA";
      
      let attendedBy = "NA";
      const byMatch = line.match(/\bby\s+([A-Za-z\s\.\-]{2,15})\b/i);
      if (byMatch) {
        attendedBy = byMatch[1].trim();
      } else {
        const endInitialsMatch = line.match(/\b([A-Z\.\-]{2,5})\b\s*$/);
        if (endInitialsMatch) {
          attendedBy = endInitialsMatch[1].trim();
        }
      }
      
      output.maintenance.push({
        id: 0,
        date: dateStr,
        maintenance_work_description: workDesc,
        parts_renewed: partsRenewed,
        attended_by: attendedBy,
        remarks: "NA",
        page: pageNum
      });
    });
    
    output.maintenance = output.maintenance.filter(isCleanMaintenanceRow);
    return normalizeExtraction(output);
  }

  // 2. Standard Equipment Heuristics Mode
  const output = {
    maintenance: [],
    spare_parts: [],
    troubleshooting: []
  };

  const lowerText = text.toLowerCase();
  
  // Structured Troubleshooting Table extraction
  if (lowerText.includes("symptom") && lowerText.includes("cause") && (lowerText.includes("elimination") || lowerText.includes("remedy") || lowerText.includes("solution"))) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    let inTable = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lowerLine = line.toLowerCase();
      if (lowerLine.includes("symptom") && (lowerLine.includes("cause") || lowerLine.includes("reason"))) {
        inTable = true;
        continue;
      }
      if (inTable && line.length > 15) {
        let parts = line.split(/\t|\||\s{3,}/).map(p => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          let problem = parts[0];
          let solution = parts.slice(1).join(" - ");
          let comp = isolateComponent(line);
          if (comp === "NA") {
            comp = isolateComponent(problem) || "System Component";
          }
          output.troubleshooting.push({
            id: 0,
            equipment_title: docName ? docName.replace(/\.[^/.]+$/, "") : "NA",
            subsystem_component: comp,
            problem: problem,
            root_cause_solution: solution,
            page: pageNum
          });
        }
      }
    }
  }
  
  // Sentences splitter
  const sentences = text.split(/(?<=[.?!])\s+/);
  
  // List of keywords indicating maintenance checks
  const keywords = ["replace", "lubricate", "grease", "inspect", "check", "clean", "torque", "coaxiality", "tighten", "weld", "drain", "replenish", "flush", "tighten"];

  // Keywords/verbs used for the prose-based troubleshooting fallback below
  const problemKeywords = ["fault", "failure", "fails", "failed", "malfunction", "leak", "leaking", "leaks", "noise", "noisy", "overheat", "overheating", "vibration", "vibrates", "error", "trip", "trips", "tripped", "stall", "stalls", "jam", "jammed", "does not", "doesn't", "won't", "will not", "unable to", "abnormal", "excessive", "low pressure", "high pressure", "high temperature", "burnt", "burn out", "seized", "worn out", "broken", "cracked", "loose", "not working", "won't start", "will not start"];
  const causeIndicators = ["caused by", "due to", "because of", "results from", "is due to"];
  const fixActionVerbs = ["check", "replace", "clean", "tighten", "reset", "adjust", "inspect", "repair", "lubricate", "bleed", "drain", "recalibrate", "realign", "re-torque", "flush", "refill", "top up", "clear", "remove", "install", "re-seat"];
  const causeSplitRegex = new RegExp("\\b(" + causeIndicators.join("|") + ")\\b", "i");
  const fixVerbRegex = new RegExp("\\b(" + fixActionVerbs.join("|") + ")\\b", "i");
  const consumedAsFixIdx = new Set(); // sentences already used as the "fix" half of a prior problem sentence
  
  let lastSeenComponent = "System Component"; // Contextual tracking

  for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
    const sentence = sentences[sIdx];
    let cleanSentence = sentence.trim().replace(/^(\d+[\.\)\-\s]*)+/i, "").trim();
    if (cleanSentence.startsWith("S") && cleanSentence.length < 5) continue;
    
    const lowerS = cleanSentence.toLowerCase();

    // Discard generic table headings, section headers, or figure captions
    const isHeaderOrIndicator = /^\b(table|figure|fig|section|drawing|dwg|no)\b|^\d+(\.\d+)*\b/i.test(cleanSentence);
    const isGenericHeader = /check items|maintenance regulations|troubleshooting methods|common troubles|trouble phenomena|check before|inspection before|periodic maintenance/i.test(lowerS);
    const isTOCLine = /\.{3,}/.test(cleanSentence) || /\.\s*\.\s*\.\s*\./.test(cleanSentence);
    const isLikelyIndexEntry = /(page\s*)?\d{1,3}$/.test(lowerS) && cleanSentence.length < 170 && !/[;:]/.test(cleanSentence);
    if (isHeaderOrIndicator || isGenericHeader || isTOCLine || isLikelyIndexEntry) continue;

    let componentMatch = isolateComponent(cleanSentence);
    if (componentMatch !== "NA") {
        lastSeenComponent = componentMatch;
    }

    const hasKeyword = keywords.some(kw => lowerS.includes(kw));
    const hasPart = partKeywords.some(pk => lowerS.includes(pk));
    
    // 1. Maintenance Check Extraction
    if (hasKeyword && cleanSentence.length > 20 && cleanSentence.length < 250) {
      let component = componentMatch !== "NA" ? componentMatch : lastSeenComponent;
      
      // Resolve Routine
      let routine = "Monthly";
      if (lowerS.includes("hour")) {
        const hoursMatch = lowerS.match(/(\d{2,5})\s*hours/);
        routine = hoursMatch ? `Every ${hoursMatch[1]} Hours` : "Periodic Hours";
      } else if (lowerS.includes("month")) {
        const monthsMatch = lowerS.match(/(\d+)\s*months?/);
        routine = monthsMatch ? `Every ${monthsMatch[1]} Months` : "Monthly";
      } else if (lowerS.includes("week")) {
        routine = "Weekly";
      } else if (lowerS.includes("daily") || lowerS.includes("shift")) {
        routine = "Daily / Shift";
      } else if (lowerS.includes("yearly") || lowerS.includes("annual")) {
        routine = "Yearly";
      }
      
      output.maintenance.push({
        id: 0,
        equipment_title: docName ? docName.replace(/\.[^/.]+$/, "") : "NA",
        subsystem_component: component,
        maintenance_routine: routine,
        checks_instructions: cleanSentence,
        page: pageNum
      });
    }

    // 2. Spare Parts Extraction
    if (hasPart && (lowerS.includes("spare") || lowerS.includes("part no") || lowerS.includes("model") || lowerS.includes("type") || lowerS.includes("replace") || lowerS.includes("drawing"))) {
      let partName = isolateComponent(cleanSentence);

      // A sentence can carry more than one reference code (e.g. a part number AND a
      // separate drawing/model number). Collect all of them instead of just the first.
      const allCodeMatches = cleanSentence.match(/\b[A-Z0-9]{4,15}-[A-Z0-9\-]{2,15}\b/g) || [];
      let refCode = "NA";
      let drawingModelNo = "NA";
      if (allCodeMatches.length > 0) {
        refCode = allCodeMatches[0];
        if (allCodeMatches.length > 1) drawingModelNo = allCodeMatches[1];
      } else {
        const fagMatch = lowerS.match(/\b\d{5,10}\b/);
        if (fagMatch) refCode = fagMatch[0];
      }
      // An explicit "drawing/dwg/model" label always wins over the positional guess above.
      const dwgLabelMatch = cleanSentence.match(/\b(?:dwg|drawing|model)[\.:\s#]*\s*([A-Za-z0-9][A-Za-z0-9\-\/]{1,20})/i);
      if (dwgLabelMatch) drawingModelNo = dwgLabelMatch[1];

      // Item / position number, e.g. "Item 12", "Pos. 4", "Ref No. 7"
      let itemNo = "NA";
      const itemMatch = cleanSentence.match(/\b(?:item|pos|position|ref)\.?\s*(?:no\.?)?\s*[:#]?\s*(\d{1,3})\b/i);
      if (itemMatch) itemNo = itemMatch[1];

      // Quantity actually stated in the text, e.g. "qty 2", "2 pcs", "2 units each"
      let quantity = "NA";
      const qtyMatch = lowerS.match(/\b(?:qty|quantity)[\.:\s]*(\d{1,4})\b/) ||
        lowerS.match(/\b(\d{1,4})\s*(?:pcs|pieces|units|nos|off|each)\b/);
      if (qtyMatch) quantity = qtyMatch[1];

      // Recommended stock level, only when explicitly mentioned (never fabricated)
      let recommendedStockQty = "NA";
      const stockMatch = lowerS.match(/\b(?:recommended stock|stock level|keep|maintain)\D{0,20}?(\d{1,4})\s*(?:pcs|pieces|units|in stock|on hand|off)?\b/);
      if (stockMatch) recommendedStockQty = stockMatch[1];

      // OEM / governing standard body, e.g. ISO 9001, DIN 934, API, ASME
      let oemStandardBody = "NA";
      const standardMatch = cleanSentence.match(/\b(ISO|DIN|ANSI|API|ASME|JIS|BS|SAE|NEMA|IEC)[\-\s]?\d{0,6}\b/);
      if (standardMatch) oemStandardBody = standardMatch[0];

      // Warranty duration, e.g. "12 months warranty", "warranty period of 1 year"
      let warrantyPeriod = "NA";
      const warrantyMatch = lowerS.match(/(\d{1,3}\s*(?:years?|months?))\s*warranty/) ||
        lowerS.match(/warranty\D{0,15}?(\d{1,3}\s*(?:years?|months?))/);
      if (warrantyMatch) warrantyPeriod = warrantyMatch[1];

      // Replacement/usage frequency, e.g. "replace every 6 months", "every 500 hours"
      let frequencyOfUse = "NA";
      const freqMatch = lowerS.match(/every\s+(\d{1,5}\s*(?:hours?|months?|weeks?|years?|days?))/);
      if (freqMatch) frequencyOfUse = `Replace every ${freqMatch[1]}`;

      // Reuse the same contextual component tracking used for maintenance rows above,
      // instead of a generic placeholder that carries no real information.
      const subsystemLocation = componentMatch !== "NA" ? componentMatch : (lastSeenComponent !== "System Component" ? lastSeenComponent : "NA");

      output.spare_parts.push({
        id: 0,
        equipment_title: docName ? docName.replace(/\.[^/.]+$/, "") : "NA",
        subsystem_location: subsystemLocation,
        item_no: itemNo,
        part_name: partName,
        part_number_code: refCode,
        drawing_model_no: drawingModelNo,
        oem_standard_body: oemStandardBody,
        part_categorization: lowerS.includes("oil") || lowerS.includes("filter") || lowerS.includes("grease") ? "Consumable" : "Critical Spare",
        quantity: quantity !== "NA" ? quantity : "1",
        recommended_stock_qty: recommendedStockQty,
        warranty_period: warrantyPeriod,
        frequency_of_use: frequencyOfUse,
        page: pageNum
      });
    }

    // 3. Prose-based Troubleshooting Fallback
    // Catches problem/cause/fix narratives that aren't in a literal "Symptom | Cause | Elimination" table,
    // which the structured table extractor above cannot see.
    if (!consumedAsFixIdx.has(sIdx)) {
      // Guard against negated phrasing ("no fault found", "without leaks", "free of vibration"),
      // which mentions a problem keyword while explicitly stating the problem is absent.
      const hasProblem = problemKeywords.some(pk => {
        const idx = lowerS.indexOf(pk);
        if (idx === -1) return false;
        const preceding = lowerS.substring(Math.max(0, idx - 25), idx);
        const isNegated = /\b(no|not|without|free of|absence of|never)\s+(?:any\s+)?(?:signs?\s+of\s+)?$/.test(preceding);
        return !isNegated;
      });
      if (hasProblem) {
        let problemPart = "";
        let solutionPart = "";

        const causeMatch = cleanSentence.match(causeSplitRegex);
        const fixMatch = cleanSentence.match(fixVerbRegex);

        if (causeMatch && causeMatch.index > 5) {
          problemPart = cleanSentence.substring(0, causeMatch.index).trim();
          solutionPart = cleanSentence.substring(causeMatch.index).trim();
        } else if (fixMatch && fixMatch.index > 5) {
          problemPart = cleanSentence.substring(0, fixMatch.index).trim();
          solutionPart = cleanSentence.substring(fixMatch.index).trim();
        } else if (sIdx + 1 < sentences.length) {
          // No split found within this sentence — check if the NEXT sentence reads like the fix,
          // e.g. "Pump fails to build pressure." followed by "Check the relief valve setting."
          const nextClean = sentences[sIdx + 1].trim().replace(/^(\d+[\.\)\-\s]*)+/i, "").trim();
          const nextLower = nextClean.toLowerCase();
          const nextHasProblem = problemKeywords.some(pk => nextLower.includes(pk));
          const nextHasFix = fixActionVerbs.some(fv => nextLower.includes(fv)) || causeIndicators.some(ci => nextLower.includes(ci));
          if (!nextHasProblem && nextHasFix && nextClean.length > 5 && nextClean.length < 250) {
            problemPart = cleanSentence;
            solutionPart = nextClean;
            consumedAsFixIdx.add(sIdx + 1);
          }
        }

        if (problemPart.length > 5 && solutionPart.length > 5 && problemPart.length < 250 && solutionPart.length < 250) {
          let comp = componentMatch !== "NA" ? componentMatch : lastSeenComponent;
          output.troubleshooting.push({
            id: 0,
            equipment_title: docName ? docName.replace(/\.[^/.]+$/, "") : "NA",
            subsystem_component: comp,
            problem: problemPart,
            root_cause_solution: solutionPart,
            page: pageNum
          });
        }
      }
    }
  }

  // Filter out incomplete/placeholder rows with no valid data
  output.maintenance = output.maintenance.filter(isCleanMaintenanceRow);
  output.spare_parts = output.spare_parts.filter(isCleanSparePartsRow);
  if (output.troubleshooting) {
    output.troubleshooting = output.troubleshooting.filter(r => 
      r.problem !== "NA" && 
      r.root_cause_solution !== "NA" && 
      r.problem.length > 5 && 
      r.root_cause_solution.length > 5
    );
  }
  return normalizeExtraction(output);
}

function isolateComponent(sentence) {
  const lowerS = sentence.toLowerCase();
  
  // High-fidelity physical parts dictionary
  const partClasses = (equipmentManifest && equipmentManifest.categories[activeEquipmentCategory]) 
    ? equipmentManifest.categories[activeEquipmentCategory].partClasses 
    : [];

  // Try to find matching physical part term from the sentence
  for (const group of partClasses) {
    for (const term of group.terms) {
      if (lowerS.includes(term)) {
        // Return capitalized matching term
        return term.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      }
    }
  }

  // The user wants to discard rows with NA in Sub-system / Component column.
  // Instead of falling back to random word extraction or generic "System Component",
  // we return "NA" when no specific known component is identified.
  return "NA";
}

/* -------------------------------------------------------------
 * 5. Cognitive AI Copilot Chatbot Engine
 * ------------------------------------------------------------- */

function appendChatSystemMessage(text) {
  const msg = document.createElement("div");
  msg.className = "chat-message assistant";
  msg.innerHTML = `
    <div class="msg-avatar"><i data-lucide="bot"></i></div>
    <div class="msg-content" style="border-color: var(--accent-green-glow); background: hsla(145, 80%, 48%, 0.03);">
      <p>${escapeHTML(text).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>
    </div>
  `;
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  safeCreateIcons();
}

function appendUserMessage(text) {
  const msg = document.createElement("div");
  msg.className = "chat-message user";
  msg.innerHTML = `
    <div class="msg-avatar"><i data-lucide="user"></i></div>
    <div class="msg-content">
      <p>${escapeHTML(text)}</p>
    </div>
  `;
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  safeCreateIcons();
}

// Client-Side Cognitive Matching and Context Extraction (asynchronous for Ollama RAG support)
// Sends a plain-text (non-JSON) prompt to whichever LLM engine is active and returns the raw
// reply text. Used by the RAG chatbot, which needs a conversational answer rather than the
// structured JSON extraction produced by runOllamaExtractor/runGeminiExtractor.
async function callLLMRagAnswer(ragPrompt) {
  if (engineMode === "gemini") {
    const modelName = geminiModel || "gemini-flash-latest";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: ragPrompt }] }],
        generationConfig: { temperature: 0.2 }
      })
    });
    if (!response.ok) {
      let errDetail = "";
      try {
        const errJson = await response.json();
        errDetail = (errJson.error && errJson.error.message) || "";
      } catch (e) {}
      throw new Error(`Gemini API returned HTTP ${response.status}${errDetail ? " - " + errDetail : ""}`);
    }
    const data = await response.json();
    const candidate = data.candidates && data.candidates[0];
    const text = (candidate && candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text) || "";
    if (!text) {
      throw new Error("Gemini returned no content (check API key/model name).");
    }
    return text.trim();
  }

  const response = await fetch(`${ollamaUrl}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: ollamaModel,
      prompt: ragPrompt,
      stream: false,
      options: {
        temperature: 0.2
      }
    })
  });
  if (!response.ok) {
    throw new Error(`Ollama Server returned HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.response.trim();
}

async function processCognitiveChatSearch(query) {
  appendUserMessage(query);
  
  // Show typing loader
  const loader = document.createElement("div");
  loader.className = "chat-message assistant";
  loader.id = "chat-loader";
  loader.innerHTML = `
    <div class="msg-avatar"><i data-lucide="bot"></i></div>
    <div class="msg-content">
      <p>${engineMode === "ollama" ? "Synthesizing answer with local LLM..." : engineMode === "gemini" ? "Synthesizing answer with Gemini API..." : "Consulting cog-search indexes..."}</p>
    </div>
  `;
  chatMessages.appendChild(loader);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  safeCreateIcons();

  // Query Tokenization
  const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (tokens.length === 0) {
    const loaderElem = document.getElementById("chat-loader");
    if (loaderElem) loaderElem.remove();
    appendAssistantReply("Could you please specify a longer query so I can parse the document indexes accurately?");
    return;
  }

  // Context Search on loadedPages
  let pageMatches = [];
  loadedPages.forEach(page => {
    let score = 0;
    tokens.forEach(token => {
      if (page.text.toLowerCase().includes(token)) {
        score += 1;
      }
    });
    if (score > 0) {
      pageMatches.push({ pageNum: page.pageNum, text: page.text, score: score });
    }
  });
  pageMatches.sort((a, b) => b.score - a.score);

  // Database Grid matching logic (find record matches to auto filter in active tab)
  let gridMatches = [];
  let currentRegistry = maintenanceRegistry;
  if (activeRegistryTab === "spare_parts") currentRegistry = sparePartsRegistry;
  if (activeRegistryTab === "troubleshooting") currentRegistry = troubleshootingRegistry;
  
  currentRegistry.forEach(row => {
    let score = 0;
    tokens.forEach(token => {
      let text = "";
      if (activeRegistryTab === "maintenance") {
        text = `${row.equipment_title} ${row.subsystem_component} ${row.maintenance_routine} ${row.checks_instructions}`;
      } else if (activeRegistryTab === "spare_parts") {
        text = `${row.equipment_title} ${row.subsystem_location} ${row.part_name} ${row.part_number_code} ${row.drawing_model_no} ${row.part_categorization}`;
      } else if (activeRegistryTab === "troubleshooting") {
        text = `${row.equipment_title} ${row.subsystem_component} ${row.problem} ${row.root_cause_solution}`;
      }
      text = text.toLowerCase();
      if (text.includes(token)) {
        score += 1;
      }
    });
    if (score > 0) {
      gridMatches.push({ rowId: row.id, score: score });
    }
  });
  gridMatches.sort((a, b) => b.score - a.score);
  const matchingRecordIds = gridMatches.map(m => m.rowId);

  // If a cloud/local LLM engine mode is active
  if (engineMode === "ollama" || engineMode === "gemini") {
    try {
      let contextText = "";
      let topPageNum = null;
      
      if (pageMatches.length > 0) {
        // Use the top 2 matching pages for rich context retrieval
        const topPages = pageMatches.slice(0, 2);
        topPageNum = topPages[0].pageNum;
        contextText = topPages.map(p => `[Page ${p.pageNum} text]:\n${p.text}`).join("\n\n");
      } else {
        contextText = "No relevant text matching this query was found in the document.";
      }

      const ragPrompt = `You are a helpful AI technical assistant for engineers. Answer the user's question about the technical manual.
Answer using the provided document context below as your primary source of truth. If the answer cannot be found in the context, clearly explain that it is not explicitly mentioned in the manual, and optionally provide a brief general answer if relevant.
Keep the answer concise, technical, and directly useful. Do not hallucinate model codes or values.

Document Context:
"""
${contextText}
"""

User Question: ${query}`;

      const aiReply = await callLLMRagAnswer(ragPrompt);

      const loaderElem = document.getElementById("chat-loader");
      if (loaderElem) loaderElem.remove();

      let responseHTML = `<div style="line-height: 1.5; white-space: normal;">${renderMarkdown(aiReply)}</div>`;
      
      const ragEngineLabel = engineMode === "gemini" ? `Gemini RAG (Model: <strong>${geminiModel}</strong>)` : `Ollama RAG (Model: <strong>${ollamaModel}</strong>)`;
      responseHTML += `<div class="msg-meta">
        <span>${ragEngineLabel}</span>
        ${topPageNum ? `<span class="page-ref">Page ${topPageNum}</span>` : '<span class="page-ref">General Context</span>'}
      </div>`;

      if (gridMatches.length > 0) {
        responseHTML += `<button class="msg-action-btn" onclick="applyChatFilter([${matchingRecordIds.join(',')}])">
          <i data-lucide="filter" style="width:14px;height:14px;"></i>
          <span>Filter Grid to ${gridMatches.length} Matches</span>
        </button>`;
      }

      const msg = document.createElement("div");
      msg.className = "chat-message assistant";
      msg.innerHTML = `
        <div class="msg-avatar"><i data-lucide="bot"></i></div>
        <div class="msg-content" style="border-color: var(--accent-cyan-glow);">
          ${responseHTML}
        </div>
      `;
      chatMessages.appendChild(msg);
      chatMessages.scrollTop = chatMessages.scrollHeight;
      safeCreateIcons();
      return;

    } catch (err) {
      const engineLabel = engineMode === "gemini" ? "Gemini" : "Ollama";
      console.error(`${engineLabel} RAG failed, falling back to heuristics:`, err);
      appendChatSystemMessage(`⚠️ **${engineLabel} connection failed**: ${err.message}. Falling back to keyword search index.`);
    }
  }

  // HEURISTICS TEXT-MATCHING FALLBACK
  setTimeout(() => {
    // Remove loader
    const loaderElem = document.getElementById("chat-loader");
    if (loaderElem) loaderElem.remove();

    if (pageMatches.length === 0 && gridMatches.length === 0) {
      appendAssistantReply(`I searched the document context but couldn't find matches relating to **"${query}"**. Try asking about **lubrication**, **caliper clearance**, **gearbox**, or **spare parts**.`);
      return;
    }

    // Synthesize response context
    let topPage = pageMatches[0];
    
    // Locate specific sentence containing matching terms inside the page for premium visual excerpt
    let excerpt = "";
    if (topPage) {
      const sentences = topPage.text.split(/(?<=[.?!])\s+/);
      const bestSentence = sentences.find(s => tokens.some(t => s.toLowerCase().includes(t)));
      excerpt = bestSentence ? bestSentence.trim() : topPage.text.slice(0, 150) + "...";
    }

    let responseHTML = "";
    if (gridMatches.length > 0) {
      responseHTML += `I identified **${gridMatches.length}** maintenance rules or spare parts matching your query in the active database. `;
      if (topPage) {
        responseHTML += `On **Page ${topPage.pageNum}**, the document states:`;
        responseHTML += `<div class="msg-excerpt">"${escapeHTML(excerpt)}"</div>`;
      }
      responseHTML += `<div class="msg-meta">
        <span>Context Match: <strong>${Math.min(tokens.length, topPage ? topPage.score : 1)} / ${tokens.length} keywords</strong></span>
        ${topPage ? `<span class="page-ref">Page ${topPage.pageNum}</span>` : ''}
      </div>`;
      responseHTML += `<button class="msg-action-btn" onclick="applyChatFilter([${matchingRecordIds.join(',')}])">
        <i data-lucide="filter" style="width:14px;height:14px;"></i>
        <span>Filter Grid to this Result</span>
      </button>`;
    } else {
      // Text context match only
      responseHTML += `I found a textual match in the document context on **Page ${topPage.pageNum}**:`;
      responseHTML += `<div class="msg-excerpt">"${escapeHTML(excerpt)}"</div>`;
      responseHTML += `<div class="msg-meta">
        <span>Keyword overlap: <strong>${topPage.score} matches</strong></span>
        <span class="page-ref">Page ${topPage.pageNum}</span>
      </div>`;
    }

    const msg = document.createElement("div");
    msg.className = "chat-message assistant";
    msg.innerHTML = `
      <div class="msg-avatar"><i data-lucide="bot"></i></div>
      <div class="msg-content">
        <p>${responseHTML}</p>
      </div>
    `;
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    safeCreateIcons();

  }, 600);
}

function appendAssistantReply(text) {
  const msg = document.createElement("div");
  msg.className = "chat-message assistant";
  msg.innerHTML = `
    <div class="msg-avatar"><i data-lucide="bot"></i></div>
    <div class="msg-content">
      <p>${escapeHTML(text).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>
    </div>
  `;
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  safeCreateIcons();
}

// Triggered by the chatbot filter action buttons
window.applyChatFilter = function(rowIds) {
  highlightRecordIds = rowIds;
  
  // Visual state indicator on filter tab
  document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
  
  const chip = document.createElement("button");
  chip.className = "tab-btn active";
  chip.id = "chat-filter-chip";
  chip.innerHTML = `<i data-lucide="sparkles" style="width:12px;height:12px;display:inline-block;margin-right:4px;"></i>AI Filtered Result`;
  
  // Remove existing AI filter chip if present
  const oldChip = document.getElementById("chat-filter-chip");
  if (oldChip) oldChip.remove();
  
  filterTabs.appendChild(chip);
  safeCreateIcons();
  
  chip.addEventListener("click", () => {
    highlightRecordIds = [];
    chip.remove();
    document.querySelector(".tab-btn[data-filter='all']").click();
  });

  renderGrid();
};

// Chat Form Listener
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = chatInput.value.trim();
  if (q) {
    processCognitiveChatSearch(q);
    chatInput.value = "";
  }
});

// Chat suggestions
document.addEventListener("click", (e) => {
  const suggestion = e.target.closest(".suggestion-chip");
  if (suggestion) {
    processCognitiveChatSearch(suggestion.innerText);
  }
});

/* -------------------------------------------------------------
 * 6. Application Bootstrapper
 * ------------------------------------------------------------- */

function initApp() {
  initPreloadedContext();
  renderGrid();
  
  // Initialize settings panel visibility and state on page load
  if (engineModeSelect) {
    engineMode = engineModeSelect.value || "ollama";
    if (engineMode === "ollama") {
      ollamaSettingsGroup.style.display = "block";
      if (geminiSettingsGroup) geminiSettingsGroup.style.display = "none";
      syncOllama();
    } else if (engineMode === "gemini") {
      ollamaSettingsGroup.style.display = "none";
      if (geminiSettingsGroup) geminiSettingsGroup.style.display = "block";
      syncGemini();
    } else {
      ollamaSettingsGroup.style.display = "none";
      if (geminiSettingsGroup) geminiSettingsGroup.style.display = "none";
      updateOllamaStatus("offline", "Local Heuristics");
    }
  }
}

initApp();
