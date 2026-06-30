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
let handwrittenNotesRegistry = [];
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
const handwrittenNotesContainer = document.getElementById("handwritten-notes-container");
const registryModeTabs = document.getElementById("registry-mode-tabs");
const tableEmpty = document.getElementById("table-empty");
const countRules = document.getElementById("count-rules");
const countParts = document.getElementById("count-parts");
const countConsumables = document.getElementById("count-consumables");
const countTime = document.getElementById("count-time");
const countTroubleshooting = document.getElementById("count-troubleshooting");
const countNotes = document.getElementById("count-notes");
const filterTabs = document.getElementById("filter-tabs");
const gridSearch = document.getElementById("grid-search");
const addRowBtn = document.getElementById("add-row-btn");
const exportBtn = document.getElementById("export-btn");
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("file-input");
const browseBtn = document.getElementById("browse-btn");
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
      handwrittenNotesContainer.style.display = "none";
      filterTabs.style.display = "flex";
    } else if (activeRegistryTab === "spare_parts") {
      maintenanceTable.style.display = "none";
      sparePartsTable.style.display = "table";
      troubleshootingTable.style.display = "none";
      handwrittenNotesContainer.style.display = "none";
      filterTabs.style.display = "none";
    } else if (activeRegistryTab === "troubleshooting") {
      maintenanceTable.style.display = "none";
      sparePartsTable.style.display = "none";
      troubleshootingTable.style.display = "table";
      handwrittenNotesContainer.style.display = "none";
      filterTabs.style.display = "none";
    } else if (activeRegistryTab === "handwritten_notes") {
      maintenanceTable.style.display = "none";
      sparePartsTable.style.display = "none";
      troubleshootingTable.style.display = "none";
      handwrittenNotesContainer.style.display = "block";
      filterTabs.style.display = "none";
    }
    
    highlightRecordIds = []; // clear RAG filters on switch
    renderGrid();
  });
}

// AI Engine configuration state
let engineMode = "heuristics"; // "heuristics" or "ollama"
let parseStrategy = "native"; // "native" or "ocr"
let ollamaUrl = "http://localhost:11434";
let ollamaModel = "";
let isExtracting = false;
let abortExtraction = false;

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
      if (parseStrategyGroup) parseStrategyGroup.style.display = "block";
      updateOllamaStatus("offline", "Ollama Mode Selected");
      syncOllama(); // Try to sync immediately
    } else {
      ollamaSettingsGroup.style.display = "none";
      if (parseStrategyGroup) parseStrategyGroup.style.display = "none";
      updateOllamaStatus("offline", "Local Heuristics");
    }
  });
}

if (ollamaUrlInput) {
  ollamaUrlInput.addEventListener("change", (e) => {
    ollamaUrl = e.target.value.trim();
  });
}

if (ollamaModelSelect) {
  ollamaModelSelect.addEventListener("change", (e) => {
    ollamaModel = e.target.value;
  });
}

if (btnTestOllama) {
  btnTestOllama.addEventListener("click", () => {
    syncOllama();
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
  } else {
    label.innerText = status === "online" ? `Ollama Active` : "Ollama Offline";
  }
  
  if (ollamaInfoText) {
    ollamaInfoText.className = "ollama-info " + infoClass;
    if (status === "online") {
      ollamaInfoText.innerText = `Connected successfully! Active model: ${ollamaModel}`;
    } else if (status === "syncing") {
      ollamaInfoText.innerText = "Syncing local models with Ollama...";
    } else if (status === "error") {
      ollamaInfoText.innerText = text;
    } else {
      ollamaInfoText.innerText = "Ollama not verified. Click 'Sync' to connect.";
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
      data.models.forEach((model, idx) => {
        const option = document.createElement("option");
        option.value = model.name;
        option.innerText = model.name;
        ollamaModelSelect.appendChild(option);
        
        // Auto-select llama3 variants if found to avoid system lag on heavier models
        if (model.name.toLowerCase().includes("llama3")) {
          selectedIndex = idx;
        }
      });
      ollamaModelSelect.selectedIndex = selectedIndex;
      ollamaModel = data.models[selectedIndex].name;
      updateOllamaStatus("online", "Connected", "success");
    } else {
      throw new Error("No models installed. Pull a model first, e.g. 'ollama run llama3'");
    }
  } catch (err) {
    if (syncIcon) syncIcon.classList.remove("spin-loading");
    console.error("Ollama connection failed", err);
    updateOllamaStatus(
      "error", 
      `Connection failed: ${err.message}. Ensure Ollama is running and CORS is enabled.`, 
      "error"
    );
    ollamaModelSelect.innerHTML = `<option value="llama3">llama3 (Fallback)</option>`;
    ollamaModel = "llama3";
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
  return true;
}

// Check if a spare part row has valid (non-empty/non-NA) content in name, code, or drawing model
function isCleanSparePartsRow(row) {
  const name = sanitizeVal(row.part_name);
  const code = sanitizeVal(row.part_number_code);
  const dwg = sanitizeVal(row.drawing_model_no);
  if (name === "NA" && code === "NA" && dwg === "NA") return false;
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
    
    results.push({
      id: 0,
      equipment_title: docName ? docName.replace(/\.[^/.]+$/, "") : "NA",
      subsystem_location: "NA",
      item_no: String(rowId),
      part_name: partName,
      part_number_code: code,
      drawing_model_no: (drawingModelNo !== "NA" && mfrCode !== "NA") ? (drawingModelNo + " / " + mfrCode) : (drawingModelNo !== "NA" ? drawingModelNo : (mfrCode !== "NA" ? mfrCode : "NA")),
      oem_standard_body: "NA",
      part_categorization: categorization,
      quantity: qty !== "NA" ? qty : "1",
      recommended_stock_qty: "NA",
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


function shouldProcessPageWithLLM(pageText) {
  if (!pageText) return false;
  
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
async function runOllamaExtractor(text, docName, pageNum, base64Image = null) {
  if (isRecommendedSparePartsPage(text) && !base64Image) {
    const spareParts = parseSparePartsStructurally(text, docName, pageNum);
    return normalizeExtraction({
      maintenance: [],
      spare_parts: spareParts
    });
  }

  

  const cleanDocName = docName ? docName.replace(/\.[^/.]+$/, "") : "NA";
  
  let systemPrompt = `You are an expert technical parser of industrial engineering manuals.
Your task is to analyze the text page content below and extract:
1. Maintenance routines, checks, and instructions.
2. Spare parts and components referenced in drawings or lists.
3. Troubleshooting tables, problems, and root-cause/solutions.
4. Handwritten notes or raw text if the document contains generic lists, logs, or unstructured notes.

Group your extractions into four distinct JSON lists: "maintenance", "spare_parts", "troubleshooting", and "handwritten_notes".
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
- For "equipment_title", you MUST extract the explicit Table Title, Header, or Caption directly preceding the parts list (e.g. "EXAMPLE_TABLE_TITLE_DO_NOT_COPY"). Do not use random surrounding text. Default to "${cleanDocName}" if there is absolutely no title.
- For "subsystem_location", identify the specific assembly or sub-system the part belongs to. If the table title explicitly mentions the assembly name, use it here.
- For "part_name", extract the descriptive name of the component or part.
- For "part_categorization", use "Critical Spare", "Consumable", or "Standard Part".
- For "quantity", extract the number of units.
- For "part_number_code": The manufacturer's part number or code.
- For "drawing_model_no": The engineering drawing or model designator number.
- For "recommended_stock_qty", extract stock recommendation levels if present.
- For "frequency_of_use", extract how frequently this part is used.

Rules for "troubleshooting" tasks:
- ONLY extract explicit troubleshooting matrices or tables. DO NOT extract Table of Contents headers, general descriptions, or normal paragraphs as problems.
- A valid problem MUST have a corresponding root cause and solution. If the text does not describe a fault and how to fix it, do NOT extract it.
- For "equipment_title", default to "${cleanDocName}" if not specified.
- For "subsystem_component", identify the specific sub-system.
- For "problem", extract the symptom, fault, or issue described.
- For "root_cause_solution", extract the combined root cause and solution / elimination method.

Rules for "handwritten_notes":
- If you see handwritten notes, general lists, or unstructured text, extract it verbatim as a single string into a field called "text".

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
      "part_categorization": "Consumable",
      "quantity": "1"
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

  let cleanResponse = "";
  try {
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
    cleanResponse = data.response.trim();
    
    // Robust extraction of JSON object if wrapped in markdown formatting by smaller models
    const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanResponse = jsonMatch[0];
    }
    
    const resultJson = JSON.parse(cleanResponse);
    const output = {
      maintenance: [],
      spare_parts: [],
      troubleshooting: [],
      handwritten_notes: []
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

    if (resultJson.handwritten_notes && Array.isArray(resultJson.handwritten_notes)) {
      output.handwritten_notes = resultJson.handwritten_notes.map(item => ({
        id: 0,
        text: sanitizeVal(item.text),
        page: pageNum
      }));
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

    return normalizeExtraction(output);
  } catch (parseErr) {
    console.error("JSON Parsing failed for Ollama response:", cleanResponse);
    throw new Error("JSON Parse Error: " + parseErr.message + " | Raw Output: " + cleanResponse.substring(0, 100) + "...");
  }
  return { maintenance: [], spare_parts: [] };
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
 * ------------------------------------------------------------- */function updateDashboardMetrics() {
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
  countNotes.innerText = handwrittenNotesRegistry.length;
}

function renderGrid() {
  let filtered = [];

  if (activeRegistryTab === "maintenance") {
    maintenanceTableBody.innerHTML = "";
    
    filtered = maintenanceRegistry.filter(row => {
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
    
    filtered = sparePartsRegistry.filter(row => {
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
    
    filtered = troubleshootingRegistry.filter(row => {
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
  } else if (activeRegistryTab === "handwritten_notes") {
    // Handwritten Notes Tab
    handwrittenNotesContainer.innerHTML = "";
    
    filtered = handwrittenNotesRegistry.filter(row => {
      // 1. Search Text Query
      if (currentSearchQuery) {
        const q = currentSearchQuery.toLowerCase();
        if (!row.text.toLowerCase().includes(q)) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      tableEmpty.style.display = "flex";
    } else {
      tableEmpty.style.display = "none";
      let html = "";
      filtered.forEach((row, idx) => {
        html += `<div style="margin-bottom: 2rem;">
          <h4 style="color: var(--accent-orange); margin-bottom: 0.5rem;">Note ${idx + 1} <span style="font-size: 0.8rem; color: var(--text-dark);">[Page ${row.page}]</span></h4>
          <div>${escapeHTML(row.text)}</div>
        </div>
        <hr style="border-color: rgba(255,255,255,0.1); margin-bottom: 2rem;" />`;
      });
      handwrittenNotesContainer.innerHTML = html;
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
          this.classList.remove("editing");
          renderGrid();
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
    const newRow = {
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
    if (maintenanceRegistry.length === 0) {
      alert("No maintenance records to export.");
      return;
    }

    const wb = XLSX.utils.book_new();
    let exportMaint;
    let colsMaint;
    
    if (activeEquipmentCategory === "Logbook") {
      exportMaint = maintenanceRegistry.map(r => ({
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
      exportMaint = maintenanceRegistry.map(r => ({
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
    if (sparePartsRegistry.length === 0) {
      alert("No spare parts records to export.");
      return;
    }

    const wb = XLSX.utils.book_new();
    const exportParts = sparePartsRegistry.map(r => ({
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
    if (troubleshootingRegistry.length === 0) {
      alert("No troubleshooting records to export.");
      return;
    }

    const wb = XLSX.utils.book_new();
    const exportTrouble = troubleshootingRegistry.map(r => ({
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

browseBtn.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleFileUpload(e.target.files[0]);
  }
});

async function handleFileUpload(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  
  if (extension !== 'pdf' && extension !== 'txt' && extension !== 'jpg' && extension !== 'jpeg' && extension !== 'png') {
    alert("Unsupported file format! Please upload a PDF, TXT, or Image (JPG/PNG).");
    return;
  }

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
        
        if (engineMode === "ollama") {
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
            appendChatSystemMessage(`Text manual is large. Splitting into **${chunks.length} chunks** for Ollama processing...`);
            
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
              progressStatus.innerText = `Processing chunk ${idx + 1} of ${chunks.length} with Ollama (${ollamaModel})...`;
              progressFill.style.width = `${Math.round(((idx + 1) / chunks.length) * 100)}%`;
              
              const result = await runOllamaExtractor(chunks[idx], file.name, 1);
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
                handwrittenNotesRegistry = [...handwrittenNotesRegistry, ...(result.handwritten_notes || [])];
              }
              renderGrid();
            }
          } else {
            if (!shouldProcessPageWithLLM(text)) {
              appendChatSystemMessage(`Skipped processing manual text with Ollama: no relevant keywords found.`);
            } else {
              llmChunksProcessed = 1;
              totalChunksCount = 1;
              progressStatus.innerText = `Extracting using local Ollama (${ollamaModel})...`;
              progressFill.style.width = "50%";
              const result = await runOllamaExtractor(text, file.name, 1);
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
                handwrittenNotesRegistry = [...handwrittenNotesRegistry, ...(result.handwritten_notes || [])];
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
            handwrittenNotesRegistry = [...handwrittenNotesRegistry, ...(result.handwritten_notes || [])];
          }
        }
        
        progressFill.style.width = "100%";
        progressStatus.innerText = `Complete!`;
        
        setTimeout(() => {
          progressOverlay.classList.remove("active");
          activeDocName.querySelector("span").innerText = file.name;
          activeDocName.style.borderColor = "var(--accent-cyan-glow)";
          activeDocName.style.color = "var(--accent-cyan)";
          activeDocName.style.background = "hsla(190, 90%, 50%, 0.05)";
          
          const labelModeText = engineMode === "ollama" ? `local LLM (${ollamaModel}) processing ${llmChunksProcessed} / ${totalChunksCount} chunks` : "heuristics";
          appendChatSystemMessage(`Successfully parsed text manual **"${file.name}"** using **${labelModeText}**! Extracted **${maintCount}** tasks, **${sparesCount}** spare parts, and **${troubleCount}** troubleshooting issues into the registries.`);
          renderGrid();
          isExtracting = false;
          resolve();
        }, 1000);
        
      } catch (err) {
        console.error("Local Ollama text parsing failed:", err);
        alert(`Ollama parsing failed: ${err.message}. Falling back to client Heuristics.`);
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
        loadedPages = [];
        let compiledText = "";
        let maintCount = 0;
        let sparesCount = 0;
        let troubleCount = 0;
        let llmPagesProcessed = 0;

        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          if (abortExtraction) {
            appendChatSystemMessage("Extraction stopped by user request.");
            break;
          }
          
          progressTitle.innerText = `Parsing Page ${pageNum} of ${totalPages}`;
          const progressPercent = Math.round((pageNum / totalPages) * 100);
          progressFill.style.width = `${progressPercent}%`;
          
          if (engineMode === "ollama") {
            progressStatus.innerText = `Scraping page ${pageNum} text content...`;
          } else {
            progressStatus.innerText = "Extracting layout string layers...";
          }
          
          const page = await pdf.getPage(pageNum);
          let pageText = "";
          let base64Image = null;

          if (engineMode === "ollama" && parseStrategy === "ocr") {
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
            pageText = textContent.items.map(item => item.str).join(" ");
          }
          
          loadedPages.push({ pageNum: pageNum, text: pageText });
          compiledText += ` ${pageText}`;

          if (engineMode === "ollama") {
            if (parseStrategy === "ocr" && pageNum === 1) {
              const lowerModel = ollamaModel.toLowerCase();
              if (!lowerModel.includes("vision") && !lowerModel.includes("llava") && !lowerModel.includes("minicpm") && !lowerModel.includes("qwen")) {
                appendChatSystemMessage(`⚠️ **Model Warning**: You are using OCR Vision mode with **${ollamaModel}**, which appears to be a text-only model! Vision extraction will fail and return 0 results. Please select a vision model (e.g., \`llama3.2-vision\` or \`llava\`).`);
              }
            }

            if (parseStrategy !== "ocr" && !shouldProcessPageWithLLM(pageText)) {
              console.log(`Skipping Page ${pageNum} in Ollama mode: no high-value maintenance/parts keywords found.`);
              continue;
            }
            llmPagesProcessed++;
            progressStatus.innerText = `Ollama: Extracting from Page ${pageNum}...`;
            try {
              const result = await runOllamaExtractor(pageText, file.name, pageNum, base64Image);
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
                handwrittenNotesRegistry = [...handwrittenNotesRegistry, ...(result.handwritten_notes || [])];
              }
              renderGrid();
            } catch (err) {
              console.warn(`Ollama failed on Page ${pageNum}, skipping page:`, err);
              appendChatSystemMessage(`⚠️ **Page ${pageNum} Warning**: Failed to parse with Ollama. Skipping page...`);
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
              handwrittenNotesRegistry = [...handwrittenNotesRegistry, ...(result.handwritten_notes || [])];
            }
            renderGrid();
          }
        }

        progressFill.style.width = "100%";
        progressStatus.innerText = `Extraction finished!`;
        
        setTimeout(() => {
          progressOverlay.classList.remove("active");
          activeDocName.querySelector("span").innerText = file.name;
          activeDocName.style.borderColor = "var(--accent-cyan-glow)";
          activeDocName.style.color = "var(--accent-cyan)";
          activeDocName.style.background = "hsla(190, 90%, 50%, 0.05)";
          
          const labelModeText = engineMode === "ollama" ? `local LLM (${ollamaModel}) processing ${llmPagesProcessed} / ${totalPages} pages` : "heuristics";
          appendChatSystemMessage(`Completed client-side PDF processing for **"${file.name}"** (${totalPages} pages) using **${labelModeText}**. Extracted **${maintCount}** tasks, **${sparesCount}** spare parts, and **${troubleCount}** troubleshooting issues into the registries.`);
          
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
  if (isExtracting) {
    alert("An extraction is already in progress.");
    return;
  }
  isExtracting = true;
  
  return new Promise((resolve, reject) => {
    const fileReader = new FileReader();
    
    fileReader.onload = async function() {
      try {
        const base64Data = fileReader.result.split(',')[1];
        
        progressFill.style.width = "50%";
        progressStatus.innerText = `Analyzing image with ${ollamaModel}...`;
        
        let maintCount = 0;
        let sparesCount = 0;
        let troubleCount = 0;
        let notesCount = 0;

        if (engineMode === "ollama") {
          try {
            const rawText = await runOllamaRawTranscription(base64Data);
            
            if (rawText && rawText.length > 0) {
              notesCount = 1;
              handwrittenNotesRegistry.push({
                id: handwrittenNotesRegistry.length > 0 ? Math.max(...handwrittenNotesRegistry.map(r => r.id)) + 1 : 1,
                text: rawText,
                page: 1
              });
            }
            renderGrid();
          } catch (err) {
            console.warn(`Ollama failed on image:`, err);
            appendChatSystemMessage(`⚠️ **Image Warning**: Failed to parse with Ollama. Ensure you are using a vision model.`);
          }
        } else {
          appendChatSystemMessage(`⚠️ **Image Processing**: Heuristics engine cannot process images. Please select 'local LLM' and use a Vision model.`);
        }
        
        progressFill.style.width = "100%";
        progressStatus.innerText = `Extraction finished!`;
        
        setTimeout(() => {
          progressOverlay.classList.remove("active");
          activeDocName.querySelector("span").innerText = file.name;
          activeDocName.style.borderColor = "var(--accent-cyan-glow)";
          activeDocName.style.color = "var(--accent-cyan)";
          activeDocName.style.background = "hsla(190, 90%, 50%, 0.05)";
          
          appendChatSystemMessage(`Completed client-side image processing for **"${file.name}"** using **local LLM (${ollamaModel})**. Extracted **${maintCount}** tasks, **${sparesCount}** spare parts, **${troubleCount}** troubleshooting issues, and **${notesCount}** handwritten notes into the registries.`);
          
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
  if (isRecommendedSparePartsPage(text)) {
    const spareParts = parseSparePartsStructurally(text, docName, pageNum);
    return {
      maintenance: [],
      spare_parts: spareParts
    };
  }

  const output = {
    maintenance: [],
    spare_parts: []
  };

  // Structured Maintenance Table extraction
  const lowerText = text.toLowerCase();
  if (lowerText.includes("symptom") && lowerText.includes("cause") && lowerText.includes("elimination")) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    let inTable = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].replace(/\s+/g, " ");
        if (line.toLowerCase().includes("symptom") && line.toLowerCase().includes("cause")) {
            inTable = true;
            continue;
        }
        if (inTable && line.length > 10) {
            let comp = isolateComponent(line);
            if (comp !== "NA" && line.toLowerCase().includes("replace")) {
                output.maintenance.push({
                    id: 0,
                    equipment_title: docName ? docName.replace(/\.[^/.]+$/, "") : "NA",
                    subsystem_component: comp,
                    maintenance_routine: "Periodic",
                    checks_instructions: line,
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
  const partKeywords = ["bearing", "filter", "friction plate", "pad", "disc", "valve", "coupling", "seal", "clamp", "stopper", "nut", "bolt", "accumulator", "gasket", "spring", "hose", "pipe", "pump", "block", "roller", "screw", "pin", "wire", "rope", "plug", "motor", "gear", "reducer", "coupler", "fitting", "caliper", "drum", "shaft", "skid", "plates", "groove", "gearbox", "sump", "oil", "grease", "lubricant", "engine", "compressor", "air cleaner", "battery", "radiator", "tank", "cable", "winch", "tophead", "coolant", "fuel", "hydraulic"];
  
  let lastSeenComponent = "System Component"; // Contextual tracking

  sentences.forEach((sentence) => {
    let cleanSentence = sentence.trim().replace(/^(\d+[\.\)\-\s]*)+/i, "").trim();
    if (cleanSentence.startsWith("S") && cleanSentence.length < 5) return;
    
    const lowerS = cleanSentence.toLowerCase();

    // Discard generic table headings, section headers, or figure captions
    const isHeaderOrIndicator = /^\b(table|figure|fig|section|drawing|dwg|no)\b|^\d+(\.\d+)*\b/i.test(cleanSentence);
    const isGenericHeader = /check items|maintenance regulations|troubleshooting methods|common troubles|trouble phenomena|check before|inspection before|periodic maintenance/i.test(lowerS);
    const isTOCLine = /\.{3,}/.test(cleanSentence) || /\.\s*\.\s*\.\s*\./.test(cleanSentence);
    if (isHeaderOrIndicator || isGenericHeader || isTOCLine) return;

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
      
      let refCode = "NA";
      const codeMatch = cleanSentence.match(/[A-Z0-9]{4,15}-[A-Z0-9\-]{2,15}/);
      if (codeMatch) {
        refCode = codeMatch[0];
      } else {
        const fagMatch = lowerS.match(/\b\d{5,10}\b/);
        if (fagMatch) refCode = fagMatch[0];
      }
      
      output.spare_parts.push({
        id: 0,
        equipment_title: docName ? docName.replace(/\.[^/.]+$/, "") : "NA",
        subsystem_location: "System Component Location",
        item_no: "NA",
        part_name: partName,
        part_number_code: refCode,
        drawing_model_no: "NA",
        oem_standard_body: "NA",
        part_categorization: lowerS.includes("oil") || lowerS.includes("filter") || lowerS.includes("grease") ? "Consumable" : "Critical Spare",
        quantity: "1",
        recommended_stock_qty: "1",
        warranty_period: "NA",
        frequency_of_use: "NA",
        page: pageNum
      });
    }
  });

  // Filter out incomplete/placeholder rows with no valid data
  output.maintenance = output.maintenance.filter(isCleanMaintenanceRow);
  output.spare_parts = output.spare_parts.filter(isCleanSparePartsRow);
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
      <p>${text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>
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
async function processCognitiveChatSearch(query) {
  appendUserMessage(query);
  
  // Show typing loader
  const loader = document.createElement("div");
  loader.className = "chat-message assistant";
  loader.id = "chat-loader";
  loader.innerHTML = `
    <div class="msg-avatar"><i data-lucide="bot"></i></div>
    <div class="msg-content">
      <p>${engineMode === "ollama" ? "Synthesizing answer with local LLM..." : "Consulting cog-search indexes..."}</p>
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

  // If Ollama engine mode is active
  if (engineMode === "ollama") {
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
      const aiReply = data.response.trim();

      const loaderElem = document.getElementById("chat-loader");
      if (loaderElem) loaderElem.remove();

      let responseHTML = `<div style="line-height: 1.5; white-space: normal;">${renderMarkdown(aiReply)}</div>`;
      
      responseHTML += `<div class="msg-meta">
        <span>Ollama RAG (Model: <strong>${ollamaModel}</strong>)</span>
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
      console.error("Local Ollama RAG failed, falling back to heuristics:", err);
      appendChatSystemMessage(`⚠️ **Ollama connection failed**: ${err.message}. Falling back to keyword search index.`);
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
      <p>${text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>
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
    engineMode = engineModeSelect.value || "heuristics";
    if (engineMode === "ollama") {
      ollamaSettingsGroup.style.display = "block";
      syncOllama();
    } else {
      ollamaSettingsGroup.style.display = "none";
      updateOllamaStatus("offline", "Local Heuristics");
    }
  }
}

initApp();
