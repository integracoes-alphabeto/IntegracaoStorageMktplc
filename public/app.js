const state = {
  config: null,
  files: [],
  folders: [],
  selectedFiles: [],
  runtimeWarnings: [],
  compressionInitialized: false,
  loadedPrefix: "",
  filesSource: "bucket",
  sourceMode: "upload",
  lastIngressMode: "",
  pollers: {
    upload: null,
    vtex: null,
  },
  busy: {
    controls: false,
    upload: false,
    vtex: false,
  },
};

const elements = {
  bucketName: document.querySelector("#bucket-name"),
  defaultPrefix: document.querySelector("#default-prefix"),
  urlMode: document.querySelector("#url-mode"),
  configStatus: document.querySelector("#config-status"),
  configMessages: document.querySelector("#config-messages"),
  resultMessage: document.querySelector("#result-message"),
  prefixInput: document.querySelector("#prefix-input"),
  newFolderInput: document.querySelector("#new-folder-input"),
  refreshButton: document.querySelector("#refresh-button"),
  createFolderButton: document.querySelector("#create-folder-button"),
  reloadFoldersButton: document.querySelector("#reload-folders-button"),
  folderList: document.querySelector("#folder-list"),
  foldersCount: document.querySelector("#folders-count"),
  summaryBadge: document.querySelector("#summary-badge"),
  tableStats: document.querySelector("#table-stats"),
  exportButton: document.querySelector("#export-button"),
  serverExportLink: document.querySelector("#server-export-link"),
  compressionEnabledInput: document.querySelector("#compression-enabled-input"),
  compressionQualityInput: document.querySelector("#compression-quality-input"),
  compressionMaxWidthInput: document.querySelector("#compression-max-width-input"),
  sourceTabUpload: document.querySelector("#source-tab-upload"),
  sourceTabVtex: document.querySelector("#source-tab-vtex"),
  sourcePanelUpload: document.querySelector("#source-panel-upload"),
  sourcePanelVtex: document.querySelector("#source-panel-vtex"),
  sourceTabs: [...document.querySelectorAll("[data-source-mode]")],
  journeyNextButton: document.querySelector("#journey-next-button"),
  nextStepLabel: document.querySelector("#next-step-label"),
  flowHeadline: document.querySelector("#flow-headline"),
  flowSubcopy: document.querySelector("#flow-subcopy"),
  activeFolderBadge: document.querySelector("#active-folder-badge"),
  compressionSummaryBadge: document.querySelector("#compression-summary-badge"),
  sourceSummaryBadge: document.querySelector("#source-summary-badge"),
  filesSummaryBadge: document.querySelector("#files-summary-badge"),
  journeySteps: [...document.querySelectorAll(".journey-step")],
  stepCards: {
    folder: document.querySelector("#step-folder"),
    compression: document.querySelector("#step-compression"),
    source: document.querySelector("#step-source"),
    review: document.querySelector("#step-review"),
  },
  vtexSkusInput: document.querySelector("#vtex-skus-input"),
  vtexSearchButton: document.querySelector("#vtex-search-button"),
  fileInput: document.querySelector("#file-input"),
  uploadButton: document.querySelector("#upload-button"),
  selectedFiles: document.querySelector("#selected-files"),
  pendingList: document.querySelector("#pending-list"),
  dropzone: document.querySelector("#dropzone"),
  filesTableBody: document.querySelector("#files-table-body"),
  controlsProgressCard: document.querySelector("#controls-progress-card"),
  controlsProgressLabel: document.querySelector("#controls-progress-label"),
  controlsProgressValue: document.querySelector("#controls-progress-value"),
  controlsProgressFill: document.querySelector("#controls-progress-fill"),
  controlsProgressDetail: document.querySelector("#controls-progress-detail"),
  uploadProgressCard: document.querySelector("#upload-progress-card"),
  uploadProgressLabel: document.querySelector("#upload-progress-label"),
  uploadProgressValue: document.querySelector("#upload-progress-value"),
  uploadProgressFill: document.querySelector("#upload-progress-fill"),
  uploadProgressDetail: document.querySelector("#upload-progress-detail"),
  vtexProgressCard: document.querySelector("#vtex-progress-card"),
  vtexProgressLabel: document.querySelector("#vtex-progress-label"),
  vtexProgressValue: document.querySelector("#vtex-progress-value"),
  vtexProgressFill: document.querySelector("#vtex-progress-fill"),
  vtexProgressDetail: document.querySelector("#vtex-progress-detail"),
};

function createProgressCard(card, label, value, fill, detail) {
  return {
    hide() {
      card.hidden = true;
      card.classList.remove("error", "complete");
      fill.style.width = "0%";
      value.textContent = "0%";
      label.textContent = "Processando...";
      detail.textContent = "Aguardando.";
    },
    update({ percent = 0, labelText = "Processando...", detailText = "Aguardando.", tone = "running" }) {
      const safePercent = Math.max(0, Math.min(100, Math.round(percent)));

      card.hidden = false;
      card.classList.toggle("error", tone === "error");
      card.classList.toggle("complete", tone === "complete");
      fill.style.width = `${safePercent}%`;
      value.textContent = `${safePercent}%`;
      label.textContent = labelText;
      detail.textContent = detailText;
    },
  };
}

const progress = {
  controls: createProgressCard(
    elements.controlsProgressCard,
    elements.controlsProgressLabel,
    elements.controlsProgressValue,
    elements.controlsProgressFill,
    elements.controlsProgressDetail
  ),
  upload: createProgressCard(
    elements.uploadProgressCard,
    elements.uploadProgressLabel,
    elements.uploadProgressValue,
    elements.uploadProgressFill,
    elements.uploadProgressDetail
  ),
  vtex: createProgressCard(
    elements.vtexProgressCard,
    elements.vtexProgressLabel,
    elements.vtexProgressValue,
    elements.vtexProgressFill,
    elements.vtexProgressDetail
  ),
};

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 KB";
  }

  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;

  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatCount(value, singular, plural) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scaleProgress(value, rangeStart, rangeEnd) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));

  return rangeStart + ((rangeEnd - rangeStart) * safeValue) / 100;
}

function normalizeSegment(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeSingleFolder(value, { allowEmpty = true } = {}) {
  const rawValue = String(value || "").trim();

  if (!rawValue) {
    if (allowEmpty) {
      return "";
    }

    throw new Error("Informe o nome da pasta.");
  }

  if (/[\\/]/.test(rawValue)) {
    throw new Error("Use apenas uma pasta simples. Subpastas nao sao permitidas.");
  }

  const normalizedValue = normalizeSegment(rawValue);

  if (!normalizedValue) {
    throw new Error("Use um nome de pasta valido, com letras ou numeros.");
  }

  return normalizedValue;
}

function parseFileNameConvention(fileName) {
  const baseName = String(fileName || "").trim().replace(/\.[^.]+$/, "");
  const match = /^([^_]+)_(.+)$/.exec(baseName);

  if (!match) {
    return {
      sku: "",
      position: "",
      detected: false,
    };
  }

  const rawPosition = match[2].trim();
  const parsedPosition = Number(rawPosition);

  return {
    sku: match[1].trim(),
    position: Number.isFinite(parsedPosition) ? parsedPosition : "",
    detected: true,
  };
}

function humanizeTaskStage(stage, fallback) {
  const labels = {
    querying: "Consultando dados",
    downloading: "Baixando imagens",
    preparing: "Preparando imagens",
    compressing: "Comprimindo imagens",
    uploading: "Enviando ao storage",
    uploaded: "Finalizando upload",
    completed: "Concluido",
    failed: "Falha",
  };

  return labels[stage] || fallback || "Processando";
}

function createTaskId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function setResultMessage(message, tone = "info") {
  elements.resultMessage.textContent = message;
  elements.resultMessage.className = `info-box ${tone === "error" ? "error" : "subtle"}`;
}

function addRuntimeWarnings(warnings = []) {
  const nextWarnings = warnings.map((warning) => String(warning || "").trim()).filter(Boolean);

  if (!nextWarnings.length) {
    return;
  }

  state.runtimeWarnings = [...new Set([...state.runtimeWarnings, ...nextWarnings])];
  renderConfigMessages();
}

function renderConfigMessages() {
  const config = state.config;

  if (!config) {
    elements.configMessages.textContent = "Carregando configuracao...";
    return;
  }

  const notes = [];

  if (config.missing?.length) {
    notes.push(`Faltando: ${config.missing.join(", ")}`);
  }

  if (config.credentialError) {
    notes.push(config.credentialError);
  }

  if (config.warnings?.length) {
    notes.push(...config.warnings);
  }

  if (state.runtimeWarnings.length) {
    notes.push(...state.runtimeWarnings);
  }

  elements.configMessages.innerHTML = notes.length
    ? notes.map((note) => `<div>${escapeHtml(note)}</div>`).join("")
    : "Configuracao carregada sem alertas.";
}

function getResolvedPrefix({ quiet = false } = {}) {
  try {
    const normalized = normalizeSingleFolder(elements.prefixInput.value, { allowEmpty: true });

    return normalized || state.config?.defaultPrefix || "";
  } catch (error) {
    if (quiet) {
      return state.config?.defaultPrefix || "";
    }

    throw error;
  }
}

function getNewFolderName() {
  return normalizeSingleFolder(elements.newFolderInput.value, { allowEmpty: false });
}

function setCurrentPrefix(prefix) {
  const normalized = normalizeSingleFolder(prefix, { allowEmpty: true }) || state.config?.defaultPrefix || "";

  elements.prefixInput.value = normalized;
  updateSummary();
  renderFolders();
  renderWorkflowState();
}

function updateCompressionFieldsState() {
  const enabled = elements.compressionEnabledInput.checked;
  const canEdit = !state.busy.upload && !state.busy.vtex;

  elements.compressionEnabledInput.disabled = false;
  elements.compressionQualityInput.disabled = !canEdit || !enabled;
  elements.compressionMaxWidthInput.disabled = !canEdit || !enabled;
}

function applyCompressionDefaults() {
  if (state.compressionInitialized || !state.config?.imageCompression) {
    return;
  }

  const defaults = state.config.imageCompression;

  elements.compressionEnabledInput.checked = Boolean(defaults.enabled);
  elements.compressionQualityInput.value = String(defaults.quality ?? 82);
  elements.compressionMaxWidthInput.value = String(defaults.maxWidth ?? 1600);
  state.compressionInitialized = true;
}

function getCompressionState({ quiet = true } = {}) {
  const defaults = state.config?.imageCompression || {
    enabled: true,
    quality: 82,
    maxWidth: 1600,
  };
  const enabled = elements.compressionEnabledInput.checked;
  const rawQuality = elements.compressionQualityInput.value.trim();
  const rawMaxWidth = elements.compressionMaxWidthInput.value.trim();
  const quality = rawQuality === "" ? defaults.quality : Number(rawQuality);
  const maxWidth = rawMaxWidth === "" ? defaults.maxWidth : Number(rawMaxWidth);

  if (!Number.isFinite(quality) || quality < 1 || quality > 100) {
    const error = new Error("A qualidade da compressao deve ficar entre 1 e 100.");

    if (!quiet) {
      throw error;
    }

    return {
      valid: false,
      message: error.message,
      enabled,
    };
  }

  if (!Number.isFinite(maxWidth) || maxWidth < 0 || maxWidth > 10000) {
    const error = new Error("A largura maxima deve ficar entre 0 e 10000 pixels.");

    if (!quiet) {
      throw error;
    }

    return {
      valid: false,
      message: error.message,
      enabled,
    };
  }

  return {
    valid: true,
    enabled,
    compressionEnabled: enabled,
    compressionQuality: Math.round(quality),
    compressionMaxWidth: Math.round(maxWidth),
  };
}

function describeCompressionState(compressionState) {
  if (!compressionState.valid) {
    return "Ajuste pendente";
  }

  if (!compressionState.enabled) {
    return "Desligada";
  }

  return `Ativa • Q${compressionState.compressionQuality} • ${compressionState.compressionMaxWidth}px`;
}

function updateConfigPanel() {
  const config = state.config;

  if (!config) {
    return;
  }

  elements.bucketName.textContent = config.bucketName || "Nao configurado";
  elements.defaultPrefix.textContent = config.defaultPrefix || "-";
  elements.urlMode.textContent = config.urlMode === "signed" ? "signed" : "public";

  if (!elements.prefixInput.value.trim()) {
    elements.prefixInput.value = config.defaultPrefix || "";
  }

  if (config.ready) {
    elements.configStatus.textContent = "Configuracao pronta";
    elements.configStatus.className = "status-pill ready";
  } else {
    elements.configStatus.textContent = "Configuracao pendente";
    elements.configStatus.className = "status-pill error";
  }

  applyCompressionDefaults();
  renderConfigMessages();
}

function updateSummary() {
  const total = state.files.length;
  const totalSize = state.files.reduce((sum, file) => sum + (file.size || 0), 0);
  const exportPrefix = getResolvedPrefix({ quiet: true });
  const hasFiles = total > 0;
  const isVtexSource = state.filesSource === "vtex";
  const canUseBucketExport = hasFiles && !isVtexSource && state.loadedPrefix === exportPrefix;
  const countLabel = isVtexSource
    ? formatCount(total, "imagem importada", "imagens importadas")
    : formatCount(total, "imagem", "imagens");

  elements.summaryBadge.textContent = isVtexSource
    ? countLabel
    : `${formatCount(total, "arquivo carregado", "arquivos carregados")} • ${formatSize(totalSize)}`;
  elements.tableStats.textContent = isVtexSource ? countLabel : `${countLabel} • ${formatSize(totalSize)}`;
  elements.filesSummaryBadge.textContent = countLabel;
  elements.exportButton.disabled = !hasFiles;
  elements.serverExportLink.classList.toggle("disabled", !canUseBucketExport);
  elements.serverExportLink.setAttribute("aria-disabled", canUseBucketExport ? "false" : "true");
  elements.serverExportLink.href = `/api/export.csv?prefix=${encodeURIComponent(exportPrefix)}`;
}

function renderPendingFiles() {
  if (!state.selectedFiles.length) {
    elements.selectedFiles.textContent = "Nenhum arquivo selecionado.";
    elements.pendingList.innerHTML = "";
    return;
  }

  const totalSize = state.selectedFiles.reduce((sum, file) => sum + file.size, 0);
  const validCount = state.selectedFiles.filter((file) => parseFileNameConvention(file.name).detected).length;
  const invalidCount = state.selectedFiles.length - validCount;
  const validityText = invalidCount
    ? `${validCount} no padrao • ${invalidCount} fora do padrao`
    : `${validCount} no padrao SKU_ORDEM`;

  elements.selectedFiles.innerHTML = `
    <strong>${state.selectedFiles.length}</strong> imagem(ns) prontas • ${formatSize(totalSize)} • ${validityText}
  `;

  elements.pendingList.innerHTML = state.selectedFiles
    .map((file) => {
      const parsedName = parseFileNameConvention(file.name);
      const descriptor = parsedName.detected
        ? `SKU ${escapeHtml(parsedName.sku)} • ordem ${escapeHtml(parsedName.position)}`
        : "Nome fora do padrao SKU_ORDEM";

      return `
        <li>
          <strong>${escapeHtml(file.name)}</strong>
          <small>${descriptor}</small>
          <small>${formatSize(file.size)}</small>
        </li>
      `;
    })
    .join("");
}

function renderDetectedValue(value, emptyLabel) {
  const hasValue = value !== "" && value !== null && value !== undefined;

  return `
    <div class="detected-value${hasValue ? "" : " empty"}">
      ${escapeHtml(hasValue ? value : emptyLabel)}
    </div>
  `;
}

function renderFolders() {
  const currentPrefix = getResolvedPrefix({ quiet: true });

  elements.foldersCount.textContent = `${formatCount(state.folders.length, "pasta", "pastas")} no bucket`;

  if (!state.config?.ready) {
    elements.folderList.innerHTML = `
      <div class="folder-empty">
        Preencha o .env com bucket e credenciais para carregar e criar pastas.
      </div>
    `;
    return;
  }

  if (!state.folders.length) {
    elements.folderList.innerHTML = `
      <div class="folder-empty">
        Nenhuma pasta encontrada ainda. Crie uma pasta simples na raiz do bucket.
      </div>
    `;
    return;
  }

  elements.folderList.innerHTML = state.folders
    .map((folder) => {
      const chips = [
        `<span class="folder-chip">${formatCount(folder.imageCount, "imagem", "imagens")}</span>`,
      ];

      if (folder.isEmpty) {
        chips.push('<span class="folder-chip">vazia</span>');
      }

      if (folder.hasMarker) {
        chips.push('<span class="folder-chip">criada</span>');
      }

      return `
        <button
          class="button folder-card${folder.path === currentPrefix ? " active" : ""}"
          type="button"
          data-folder-path="${escapeHtml(folder.path)}"
        >
          <span class="folder-card-title">${escapeHtml(folder.name || folder.path)}</span>
          <span class="folder-card-path">${escapeHtml(folder.path)}</span>
          <span class="folder-card-meta">${chips.join("")}</span>
        </button>
      `;
    })
    .join("");
}

function renderTable() {
  if (!state.files.length) {
    elements.filesTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-state">
          Assim que voce enviar imagens ou importar fotos da VTEX, os links aparecem aqui.
        </td>
      </tr>
    `;
    return;
  }

  elements.filesTableBody.innerHTML = state.files
    .map((file) => {
      const isVtexSource = file.sourceSystem === "vtex" || state.filesSource === "vtex";
      const secondaryMeta = isVtexSource
        ? `VTEX ${file.archiveId ? `arquivo ${file.archiveId}` : "catalogo"}`
        : file.objectPath;
      const detailMeta = isVtexSource ? `link ${file.position || 1}` : formatSize(file.size);

      return `
        <tr>
          <td>
            <div class="preview-thumb">
              <img src="${escapeHtml(file.url)}" alt="${escapeHtml(file.fileName)}" loading="lazy" />
            </div>
          </td>
          <td>
            <div class="file-meta">
              <strong>${escapeHtml(file.sourceName || file.fileName)}</strong>
              <span>${escapeHtml(secondaryMeta)}</span>
              <span>${escapeHtml(detailMeta)}</span>
            </div>
          </td>
          <td>${renderDetectedValue(file.sku, "Nao detectado")}</td>
          <td>${renderDetectedValue(file.position, "Nao detectada")}</td>
          <td>
            <div class="url-cell">
              <a class="url-link" href="${escapeHtml(file.url)}" target="_blank" rel="noreferrer">
                ${escapeHtml(file.url)}
              </a>
              <div class="url-actions">
                <button class="mini-button" type="button" data-copy-url="${escapeHtml(file.objectPath)}">
                  Copiar URL
                </button>
              </div>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderSourceMode() {
  const isUpload = state.sourceMode === "upload";

  elements.sourceTabUpload.classList.toggle("is-active", isUpload);
  elements.sourceTabVtex.classList.toggle("is-active", !isUpload);
  elements.sourcePanelUpload.hidden = !isUpload;
  elements.sourcePanelVtex.hidden = isUpload;
  elements.sourceSummaryBadge.textContent = isUpload ? "Upload manual" : "VTEX por SKU";
}

function getWorkflowState() {
  const prefix = getResolvedPrefix({ quiet: true });
  const hasConfig = Boolean(state.config?.ready);
  const folderChosen = Boolean(hasConfig && prefix);
  const folderReady = folderChosen && state.loadedPrefix === prefix;
  const compression = getCompressionState({ quiet: true });
  const hasFiles = state.files.length > 0;
  
  let currentStep = "folder";
  if (folderReady) currentStep = "compression";
  if (folderReady && compression.valid) currentStep = "source";
  if (hasFiles) currentStep = "review";

  let flowHeadline = "Fluxo livre. Navegue pelas etapas abaixo.";
  let flowSubcopy = "Voce pode configurar, enviar ou exportar em qualquer ordem.";
  let nextStepLabel = "Avançar";

  if (!hasConfig) {
    flowHeadline = "Complete a configuracao do bucket para iniciar.";
    flowSubcopy = "Assim que a conexao estiver pronta, você poderá começar.";
    nextStepLabel = "Ver configuracao";
  }

  return {
    hasConfig,
    prefix,
    folderChosen,
    folderReady,
    compression,
    hasFiles,
    currentStep,
    flowHeadline,
    flowSubcopy,
    nextStepLabel,
  };
}

function setCardState(stepKey, stateName) {
  const card = elements.stepCards[stepKey];

  if (!card) {
    return;
  }

  card.dataset.state = stateName;
}

function renderJourneyStep(stepKey, stateName, label) {
  const button = elements.journeySteps.find((item) => item.dataset.stepKey === stepKey);

  if (!button) {
    return;
  }

  button.classList.toggle("is-current", stateName === "current");
  button.classList.toggle("is-done", stateName === "done");
  button.dataset.state = stateName;

  const labelElement = button.querySelector(`[data-step-state-label="${stepKey}"]`);

  if (labelElement) {
    labelElement.textContent = label;
  }
}

function renderWorkflowState() {
  const flow = getWorkflowState();
  const prefixText = flow.prefix
    ? flow.folderReady
      ? flow.prefix
      : `${flow.prefix} • sincronizar`
    : "Nenhuma";

  elements.flowHeadline.textContent = flow.flowHeadline;
  elements.flowSubcopy.textContent = flow.flowSubcopy;
  elements.nextStepLabel.textContent = flow.nextStepLabel;
  elements.activeFolderBadge.textContent = prefixText;
  elements.compressionSummaryBadge.textContent = describeCompressionState(flow.compression);
  elements.filesSummaryBadge.textContent =
    state.filesSource === "vtex"
      ? formatCount(state.files.length, "link", "links")
      : formatCount(state.files.length, "imagem", "imagens");

  renderSourceMode();
  updateCompressionFieldsState();

  renderJourneyStep("folder", flow.folderReady ? "done" : "current", flow.folderReady ? "Pronto" : "Aberto");
  renderJourneyStep("compression", flow.compression.valid ? "done" : "current", flow.compression.valid ? "Pronto" : "Aberto");
  renderJourneyStep("source", flow.hasFiles ? "done" : "current", flow.hasFiles ? "Pronto" : "Aberto");
  renderJourneyStep("review", flow.hasFiles ? "done" : "current", flow.hasFiles ? "Pronto" : "Aberto");

  setCardState("folder", flow.folderReady ? "done" : "current");
  setCardState("compression", flow.compression.valid ? "done" : "current");
  setCardState("source", flow.hasFiles ? "done" : "current");
  setCardState("review", flow.hasFiles ? "done" : "current");

  elements.refreshButton.disabled = state.busy.controls || !flow.hasConfig;
  elements.createFolderButton.disabled = state.busy.controls || !flow.hasConfig;
  elements.reloadFoldersButton.disabled = state.busy.controls || !flow.hasConfig;

  elements.fileInput.disabled = state.busy.upload;
  elements.dropzone.classList.toggle("is-disabled", state.busy.upload);
  elements.uploadButton.disabled = state.busy.upload || !state.selectedFiles.length;
  elements.vtexSearchButton.disabled = state.busy.vtex || !state.config?.vtexEnabled;

  elements.sourceTabs.forEach((tab) => {
    tab.disabled = false;
  });

  const hasAnyFile = state.files.length > 0;
  const canUseBucketExport = hasAnyFile && state.filesSource !== "vtex";
  elements.exportButton.disabled = !hasAnyFile;
  elements.serverExportLink.classList.toggle("disabled", !canUseBucketExport);
  elements.serverExportLink.setAttribute("aria-disabled", canUseBucketExport ? "false" : "true");
}

function scrollToStep(stepKey) {
  const card = elements.stepCards[stepKey];

  if (!card) {
    return;
  }

  card.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function focusNextStep() {
  scrollToStep(getWorkflowState().currentStep);
}

async function fetchJson(url, options = {}) {
  let response;

  try {
    response = await fetch(url, options);
  } catch (_error) {
    throw new Error("Nao foi possivel conectar ao servidor. Confirme que ele esta rodando com npm run dev.");
  }

  let data;

  try {
    data = await response.json();
  } catch (_error) {
    throw new Error("O servidor respondeu em um formato inesperado.");
  }

  if (!response.ok) {
    throw new Error(data.message || "Falha na comunicacao com o servidor.");
  }

  return data;
}

async function fetchTaskSnapshot(taskId) {
  let response;

  try {
    response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`);
  } catch (_error) {
    throw new Error("Nao foi possivel acompanhar o progresso da tarefa.");
  }

  if (response.status === 404) {
    return null;
  }

  let data;

  try {
    data = await response.json();
  } catch (_error) {
    throw new Error("O servidor respondeu um progresso em formato invalido.");
  }

  if (!response.ok) {
    throw new Error(data.message || "Falha ao consultar o progresso da tarefa.");
  }

  return data;
}

function stopTaskPolling(key) {
  const currentPoller = state.pollers[key];

  if (!currentPoller) {
    return;
  }

  currentPoller.active = false;
  clearTimeout(currentPoller.timerId);
  state.pollers[key] = null;
}

function startTaskPolling(key, taskId, onUpdate) {
  stopTaskPolling(key);

  const poller = {
    active: true,
    timerId: null,
    missingCount: 0,
  };

  state.pollers[key] = poller;

  async function tick() {
    if (!poller.active) {
      return;
    }

    try {
      const task = await fetchTaskSnapshot(taskId);

      if (!poller.active) {
        return;
      }

      if (!task) {
        poller.missingCount += 1;

        if (poller.missingCount > 80) {
          throw new Error("Nao foi possivel localizar a tarefa de progresso.");
        }

        poller.timerId = window.setTimeout(tick, 350);
        return;
      }

      poller.missingCount = 0;
      onUpdate(task);

      if (task.status === "completed" || task.status === "failed") {
        stopTaskPolling(key);
        return;
      }

      poller.timerId = window.setTimeout(tick, 650);
    } catch (error) {
      stopTaskPolling(key);
      console.error(error);
    }
  }

  tick();
}

function parseXhrJson(xhr) {
  if (xhr.response && typeof xhr.response === "object") {
    return xhr.response;
  }

  if (!xhr.responseText) {
    return null;
  }

  try {
    return JSON.parse(xhr.responseText);
  } catch (_error) {
    return null;
  }
}

function sendMultipartWithProgress(url, formData, onUploadProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("POST", url);
    xhr.responseType = "json";

    xhr.upload.addEventListener("progress", (event) => {
      if (typeof onUploadProgress === "function") {
        onUploadProgress(event);
      }
    });

    xhr.addEventListener("load", () => {
      const payload = parseXhrJson(xhr);

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload || {});
        return;
      }

      reject(new Error(payload?.message || "Falha ao enviar as imagens para o servidor."));
    });

    xhr.addEventListener("error", () => {
      reject(
        new Error("Nao foi possivel conectar ao servidor. Confirme que ele esta rodando com npm run dev.")
      );
    });

    xhr.send(formData);
  });
}

function setControlsBusy(isBusy) {
  state.busy.controls = isBusy;
  renderWorkflowState();
}

function setUploadBusy(isBusy) {
  state.busy.upload = isBusy;
  renderWorkflowState();
}

function setVtexBusy(isBusy) {
  state.busy.vtex = isBusy;
  renderWorkflowState();
}

async function runControlsProgress(action, task) {
  setControlsBusy(true);
  progress.controls.update({
    percent: 12,
    labelText: action,
    detailText: "Iniciando sincronizacao com o bucket.",
  });

  try {
    const result = await task((percent, detailText, tone = "running") => {
      progress.controls.update({
        percent,
        labelText: action,
        detailText,
        tone,
      });
    });

    progress.controls.update({
      percent: 100,
      labelText: action,
      detailText: "Concluido.",
      tone: "complete",
    });

    return result;
  } catch (error) {
    progress.controls.update({
      percent: 100,
      labelText: action,
      detailText: error.message,
      tone: "error",
    });
    throw error;
  } finally {
    setControlsBusy(false);
  }
}

async function loadConfig() {
  return runControlsProgress("Carregando configuracao", async (report) => {
    report(35, "Buscando dados do bucket e das credenciais.");
    state.config = await fetchJson("/api/config");
    report(80, "Aplicando configuracao na interface.");
    updateConfigPanel();
    renderPendingFiles();
    updateSummary();
    renderFolders();
    renderWorkflowState();
  });
}

async function loadFolders({ silentResult = false } = {}) {
  if (!state.config?.ready) {
    state.folders = [];
    renderFolders();
    renderWorkflowState();
    return;
  }

  await runControlsProgress("Lendo pastas do bucket", async (report) => {
    report(30, "Consultando a raiz do bucket.");
    const data = await fetchJson("/api/folders");
    report(75, "Atualizando a lista de pastas na tela.");
    state.folders = data.folders;
    renderFolders();
    renderWorkflowState();

    if (!silentResult) {
      setResultMessage(`${data.count} pasta(s) encontradas no bucket.`);
    }
  });
}

async function loadFiles({ silentResult = false, autoAdvance = false } = {}) {
  if (!state.config?.ready) {
    state.files = [];
    state.filesSource = "bucket";
    state.loadedPrefix = "";
    renderTable();
    updateSummary();
    renderWorkflowState();
    setResultMessage("Preencha o .env com bucket e credenciais para carregar os arquivos.", "error");
    return;
  }

  const prefix = getResolvedPrefix();

  await runControlsProgress("Carregando arquivos", async (report) => {
    report(28, `Lendo os arquivos da pasta ${prefix}.`);
    const data = await fetchJson(`/api/files?prefix=${encodeURIComponent(prefix)}`);
    report(74, "Montando a tabela de links.");
    state.files = data.files;
    state.filesSource = "bucket";
    state.loadedPrefix = prefix;
    renderTable();
    updateSummary();
    renderFolders();
    renderWorkflowState();

    if (!silentResult) {
      if (!data.count) {
        setResultMessage(`Pasta ${data.prefix} pronta.`);
      } else {
        const detectedCount = data.files.filter((file) => file.sku && file.position !== "").length;

        setResultMessage(
          `${data.count} imagem(ns) encontradas em ${data.prefix} • ${detectedCount} com SKU/ordem detectados.`
        );
      }
    }
  });

  if (autoAdvance) {
    focusNextStep();
  }
}

async function refreshWorkspaceData({ autoAdvance = false } = {}) {
  await loadFolders({ silentResult: true });
  await loadFiles({ silentResult: true, autoAdvance });
}

async function createFolderFromInput() {
  if (!state.config?.ready) {
    setResultMessage("A configuracao do Google Cloud ainda nao esta pronta.", "error");
    return;
  }

  const folderName = getNewFolderName();
  elements.newFolderInput.value = folderName;
  setResultMessage("Criando pasta no bucket...");

  try {
    const result = await runControlsProgress("Criando pasta", async (report) => {
      report(32, `Criando a pasta ${folderName} na raiz do bucket.`);
      const createdFolder = await fetchJson("/api/folders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          folderName,
        }),
      });
      report(76, "Atualizando a pasta ativa e a lista.");
      return createdFolder;
    });

    elements.newFolderInput.value = "";
    setCurrentPrefix(result.folder.path);
    await refreshWorkspaceData();
    setResultMessage(`${result.message}`);
    focusNextStep();
  } catch (error) {
    setResultMessage(error.message, "error");
  }
}

async function fetchVtexImages() {
  if (!state.config?.ready) {
    setResultMessage("A configuracao do Google Cloud ainda nao esta pronta.", "error");
    return;
  }

  if (!state.config?.vtexEnabled) {
    setResultMessage(
      "Preencha VTEX_API_APP_KEY e VTEX_API_APP_TOKEN no .env antes de importar fotos por SKU.",
      "error"
    );
    return;
  }

  const skusText = elements.vtexSkusInput.value.trim();

  if (!skusText) {
    setResultMessage("Informe pelo menos um SKU para importar fotos da VTEX.", "error");
    return;
  }

  try {
    const prefix = getResolvedPrefix();
    const compression = getCompressionState({ quiet: false });
    const taskId = createTaskId();

    state.lastIngressMode = "vtex";
    state.sourceMode = "vtex";
    renderWorkflowState();

    setVtexBusy(true);
    progress.vtex.update({
      percent: 0,
      labelText: "Iniciando importacao",
      detailText: "Preparando consulta, download e envio das fotos.",
    });
    setResultMessage("Importando fotos da VTEX para o bucket...");

    startTaskPolling("vtex", taskId, (task) => {
      progress.vtex.update({
        percent: task.percent,
        labelText: humanizeTaskStage(task.stage, "Importando VTEX"),
        detailText: task.detail || "Processando fotos da VTEX.",
        tone:
          task.status === "failed" ? "error" : task.status === "completed" ? "complete" : "running",
      });
    });

    const result = await fetchJson("/api/vtex/images", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        taskId,
        skusText,
        prefix,
        compressionEnabled: String(compression.compressionEnabled),
        compressionQuality: String(compression.compressionQuality),
        compressionMaxWidth: String(compression.compressionMaxWidth),
      }),
    });

    stopTaskPolling("vtex");
    progress.vtex.update({
      percent: 100,
      labelText: "Importacao concluida",
      detailText: `${result.files.length} imagem(ns) importadas para ${result.prefix}.`,
      tone: "complete",
    });

    state.files = result.files || [];
    state.filesSource = "bucket";
    state.loadedPrefix = result.prefix || prefix;
    renderTable();
    updateSummary();
    renderWorkflowState();
    addRuntimeWarnings(result.warnings);
    await refreshWorkspaceData();
    setResultMessage(
      `${result.files.length} imagem(ns) importadas da VTEX para ${result.prefix}.`
    );
    scrollToStep("review");
  } catch (error) {
    stopTaskPolling("vtex");
    progress.vtex.update({
      percent: 100,
      labelText: "Falha na importacao",
      detailText: error.message,
      tone: "error",
    });
    setResultMessage(error.message, "error");
  } finally {
    setVtexBusy(false);
  }
}

function setSelectedFiles(fileList) {
  state.selectedFiles = Array.from(fileList || []);
  renderPendingFiles();
  renderWorkflowState();
}

async function uploadSelectedFiles() {
  if (!state.config?.ready) {
    setResultMessage("A configuracao do Google Cloud ainda nao esta pronta.", "error");
    return;
  }

  if (!state.selectedFiles.length) {
    setResultMessage("Selecione pelo menos uma imagem para enviar.", "error");
    return;
  }

  try {
    const prefix = getResolvedPrefix();
    const compression = getCompressionState({ quiet: false });
    const taskId = createTaskId();
    const formData = new FormData();
    const progressState = {
      browserPercent: 0,
      task: null,
    };

    state.lastIngressMode = "upload";
    state.sourceMode = "upload";

    state.selectedFiles.forEach((file) => {
      formData.append("images", file);
    });
    formData.append("prefix", prefix);
    formData.append("taskId", taskId);
    formData.append("compressionEnabled", String(compression.compressionEnabled));
    formData.append("compressionQuality", String(compression.compressionQuality));
    formData.append("compressionMaxWidth", String(compression.compressionMaxWidth));

    function renderUploadProgress() {
      const browserProgress = scaleProgress(progressState.browserPercent, 0, 28);

      if (!progressState.task) {
        progress.upload.update({
          percent: browserProgress,
          labelText: "Recebendo arquivos no servidor",
          detailText: `Transferindo ${state.selectedFiles.length} imagem(ns) do navegador.`,
        });
        return;
      }

      progress.upload.update({
        percent: Math.max(browserProgress, scaleProgress(progressState.task.percent, 28, 100)),
        labelText: humanizeTaskStage(progressState.task.stage, "Processando upload"),
        detailText: progressState.task.detail || "Enviando imagens ao storage.",
        tone:
          progressState.task.status === "failed"
            ? "error"
            : progressState.task.status === "completed"
              ? "complete"
              : "running",
      });
    }

    setUploadBusy(true);
    renderWorkflowState();
    progress.upload.update({
      percent: 0,
      labelText: "Iniciando upload",
      detailText: `Preparando ${state.selectedFiles.length} imagem(ns) para envio.`,
    });
    setResultMessage("Enviando imagens para o bucket...");

    startTaskPolling("upload", taskId, (task) => {
      progressState.task = task;
      renderUploadProgress();
    });

    const result = await sendMultipartWithProgress("/api/upload", formData, (event) => {
      if (!event.lengthComputable) {
        return;
      }

      progressState.browserPercent = (event.loaded / event.total) * 100;
      renderUploadProgress();
    });

    stopTaskPolling("upload");
    progress.upload.update({
      percent: 100,
      labelText: "Upload concluido",
      detailText: `${result.files.length} imagem(ns) enviadas para ${result.prefix}.`,
      tone: "complete",
    });

    state.selectedFiles = [];
    elements.fileInput.value = "";
    renderPendingFiles();
    addRuntimeWarnings(result.warnings);
    await refreshWorkspaceData();
    setResultMessage(`${result.files.length} imagem(ns) enviadas para ${result.prefix}.`);
    scrollToStep("review");
  } catch (error) {
    stopTaskPolling("upload");
    progress.upload.update({
      percent: 100,
      labelText: "Falha no upload",
      detailText: error.message,
      tone: "error",
    });
    renderPendingFiles();
    setResultMessage(error.message, "error");
  } finally {
    setUploadBusy(false);
  }
}

function buildCsv() {
  const grouped = new Map();

  state.files.forEach((file, index) => {
    const url = String(file.url || "").trim();

    if (!url) {
      return;
    }

    const sku = String(file.sku || "").trim();
    const groupKey = sku || `__missing_sku_${index}`;

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        sku,
        firstIndex: index,
        links: [],
      });
    }

    grouped.get(groupKey).links.push({
      url,
      position: Number.isFinite(Number(file.sortPosition))
        ? Number(file.sortPosition)
        : Number.isFinite(Number(file.position))
          ? Number(file.position)
          : index,
      index,
    });
  });

  const rows = [...grouped.values()]
    .sort((left, right) => {
      if (left.sku && right.sku) {
        return left.sku.localeCompare(right.sku, "pt-BR", { numeric: true });
      }

      return left.firstIndex - right.firstIndex;
    })
    .map((group) => ({
      sku: group.sku,
      links: group.links
        .sort((left, right) => left.position - right.position || left.index - right.index)
        .map((item) => item.url),
    }));

  const maxLinks = Math.max(1, ...rows.map((row) => row.links.length));
  const header = ["sku", ...Array.from({ length: maxLinks }, (_item, index) => `link ${index + 1}`)];
  const lines = [header.map(escapeCsvValue).join(",")];

  rows.forEach((row) => {
    const values = [row.sku];

    for (let index = 0; index < maxLinks; index += 1) {
      values.push(row.links[index] || "");
    }

    lines.push(values.map(escapeCsvValue).join(","));
  });

  return `\uFEFF${lines.join("\n")}`;
}

function escapeCsvValue(value) {
  const stringValue = String(value ?? "");

  return /[",\n]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
}

function exportCsv() {
  if (!state.files.length) {
    setResultMessage("Nao ha arquivos para exportar.", "error");
    return;
  }

  try {
    if (state.filesSource !== "vtex") {
      const prefix = getResolvedPrefix() || "links";
      const link = document.createElement("a");

      progress.controls.update({
        percent: 100,
        labelText: "CSV pronto",
        detailText: "Gerando CSV completo direto do bucket.",
        tone: "complete",
      });

      link.href = `/api/export.csv?prefix=${encodeURIComponent(prefix)}`;
      link.download = `links-${prefix}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setResultMessage("CSV completo do bucket solicitado.");
      return;
    }

    progress.controls.update({
      percent: 28,
      labelText: "Gerando CSV",
      detailText: "Montando a planilha local para exportacao.",
    });

    const prefix = state.filesSource === "vtex" ? "vtex-skus" : getResolvedPrefix() || "links";
    const blob = new Blob([buildCsv()], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `links-${prefix}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    progress.controls.update({
      percent: 100,
      labelText: "CSV pronto",
      detailText: "Arquivo exportado com sucesso.",
      tone: "complete",
    });
    setResultMessage("CSV exportado com sucesso.");
  } catch (error) {
    progress.controls.update({
      percent: 100,
      labelText: "Falha ao exportar CSV",
      detailText: error.message,
      tone: "error",
    });
    setResultMessage(error.message, "error");
  }
}

async function handleTableClick(event) {
  const button = event.target.closest("[data-copy-url]");

  if (!button) {
    return;
  }

  const objectPath = button.getAttribute("data-copy-url");
  const file = state.files.find((item) => item.objectPath === objectPath);

  if (!file) {
    return;
  }

  try {
    await navigator.clipboard.writeText(file.url);
    setResultMessage(`URL copiada: ${file.sourceName || file.fileName}`);
  } catch (_error) {
    setResultMessage("Nao foi possivel copiar a URL automaticamente.", "error");
  }
}

async function handleFolderClick(event) {
  const card = event.target.closest("[data-folder-path]");

  if (!card) {
    return;
  }

  const folderPath = card.getAttribute("data-folder-path") || "";

  setCurrentPrefix(folderPath);
  await loadFiles({ autoAdvance: true });
}

function setSourceMode(mode, { focus = false } = {}) {
  state.sourceMode = mode === "vtex" ? "vtex" : "upload";
  renderSourceMode();
  renderWorkflowState();

  if (focus) {
    scrollToStep("source");
  }
}

function bindEvents() {
  function wrapAsync(handler) {
    return (event) => {
      Promise.resolve(handler(event)).catch((error) => {
        setResultMessage(error.message, "error");
      });
    };
  }

  elements.journeyNextButton.addEventListener("click", () => {
    focusNextStep();
  });

  elements.journeySteps.forEach((button) => {
    button.addEventListener("click", () => {
      const stepKey = button.dataset.stepKey;
      scrollToStep(stepKey);
    });
  });

  elements.refreshButton.addEventListener("click", wrapAsync(() => loadFiles({ autoAdvance: true })));
  elements.createFolderButton.addEventListener("click", wrapAsync(createFolderFromInput));
  elements.reloadFoldersButton.addEventListener("click", wrapAsync(() => loadFolders()));
  elements.exportButton.addEventListener("click", exportCsv);
  elements.serverExportLink.addEventListener("click", (event) => {
    if (elements.serverExportLink.classList.contains("disabled")) {
      event.preventDefault();
    }
  });

  elements.sourceTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      setSourceMode(tab.dataset.sourceMode);
    });
  });

  elements.prefixInput.addEventListener("input", () => {
    updateSummary();
    renderFolders();
    renderWorkflowState();
  });

  elements.prefixInput.addEventListener("blur", () => {
    if (!elements.prefixInput.value.trim()) {
      elements.prefixInput.value = state.config?.defaultPrefix || "";
      updateSummary();
      renderFolders();
      renderWorkflowState();
      return;
    }

    try {
      elements.prefixInput.value = normalizeSingleFolder(elements.prefixInput.value, { allowEmpty: false });
      updateSummary();
      renderFolders();
      renderWorkflowState();
    } catch (_error) {
      return;
    }
  });

  elements.prefixInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      Promise.resolve(loadFiles({ autoAdvance: true })).catch((error) => {
        setResultMessage(error.message, "error");
      });
    }
  });

  elements.newFolderInput.addEventListener("blur", () => {
    if (!elements.newFolderInput.value.trim()) {
      return;
    }

    try {
      elements.newFolderInput.value = normalizeSingleFolder(elements.newFolderInput.value, {
        allowEmpty: false,
      });
    } catch (_error) {
      return;
    }
  });

  elements.newFolderInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      Promise.resolve(createFolderFromInput()).catch((error) => {
        setResultMessage(error.message, "error");
      });
    }
  });

  [elements.compressionEnabledInput, elements.compressionQualityInput, elements.compressionMaxWidthInput].forEach(
    (input) => {
      input.addEventListener("input", () => {
        renderWorkflowState();
      });
      input.addEventListener("change", () => {
        renderWorkflowState();
      });
    }
  );

  elements.vtexSearchButton.addEventListener("click", wrapAsync(fetchVtexImages));
  elements.vtexSkusInput.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      Promise.resolve(fetchVtexImages()).catch((error) => {
        setResultMessage(error.message, "error");
      });
    }
  });

  elements.fileInput.addEventListener("change", (event) => {
    setSelectedFiles(event.target.files);
  });

  elements.uploadButton.addEventListener("click", wrapAsync(uploadSelectedFiles));
  elements.folderList.addEventListener("click", wrapAsync(handleFolderClick));
  elements.filesTableBody.addEventListener("click", wrapAsync(handleTableClick));

  ["dragenter", "dragover"].forEach((eventName) => {
    elements.dropzone.addEventListener(eventName, (event) => {
      if (state.busy.upload) {
        return;
      }

      event.preventDefault();
      elements.dropzone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    elements.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropzone.classList.remove("dragover");
    });
  });

  elements.dropzone.addEventListener("drop", (event) => {
    if (state.busy.upload) {
      return;
    }

    const imageFiles = Array.from(event.dataTransfer.files || []).filter((file) =>
      file.type.startsWith("image/")
    );

    setSelectedFiles(imageFiles);
  });
}

async function bootstrap() {
  progress.controls.hide();
  progress.upload.hide();
  progress.vtex.hide();
  renderSourceMode();
  renderConfigMessages();
  renderPendingFiles();
  renderFolders();
  renderTable();
  updateSummary();
  renderWorkflowState();
  bindEvents();

  try {
    await loadConfig();
    await loadFolders({ silentResult: true });
    await loadFiles({ silentResult: true });
    setResultMessage("Fluxo pronto. Se quiser, ja posso te levar direto para a proxima etapa.");
  } catch (error) {
    setResultMessage(error.message, "error");
  }
}

bootstrap();
