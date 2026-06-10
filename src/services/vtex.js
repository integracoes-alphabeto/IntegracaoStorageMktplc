const path = require("path");
const { appConfig } = require("../config");

const IMAGE_TYPE_EXTENSIONS = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
  "image/svg+xml": ".svg",
  "image/tiff": ".tiff",
};

const RETRYABLE_FETCH_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNABORTED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "ESOCKETTIMEDOUT",
]);

const RETRYABLE_FETCH_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

function ensureVtexConfigured() {
  if (!appConfig.vtex.enabled) {
    throw new Error(
      "Preencha VTEX_API_APP_KEY e VTEX_API_APP_TOKEN no .env para importar fotos por SKU da VTEX."
    );
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableFetchError(error) {
  const code = String(error?.code || error?.cause?.code || "").toUpperCase();

  if (RETRYABLE_FETCH_ERROR_CODES.has(code)) {
    return true;
  }

  const message = String(error?.message || "").toLowerCase();

  return [
    "econnreset",
    "epipe",
    "etimedout",
    "enotfound",
    "socket hang up",
    "socket connection timeout",
    "network timeout",
    "network error",
    "read timed out",
    "write epipe",
  ].some((fragment) => message.includes(fragment));
}

function getFetchRetryDelayMs(attempt) {
  const baseDelayMs = 750;
  const maxDelayMs = 8000;
  const exponentialDelay = baseDelayMs * 2 ** Math.max(attempt - 1, 0);
  const jitter = Math.floor(Math.random() * 250);

  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

async function fetchWithRetry(url, options, retryOptions = {}) {
  const maxAttempts = Math.max(1, (Number(appConfig.vtex.requestRetryLimit) || 0) + 1);
  let attempt = 1;

  while (attempt <= maxAttempts) {
    try {
      const response = await fetch(url, options);

      if (!RETRYABLE_FETCH_STATUS_CODES.has(response.status) || attempt >= maxAttempts) {
        return response;
      }
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableFetchError(error)) {
        throw error;
      }

      retryOptions.onRetry?.(error, attempt + 1, maxAttempts);
    }

    await wait(getFetchRetryDelayMs(attempt));
    attempt += 1;
  }

  return fetch(url, options);
}

function parseSkusText(skusText) {
  const skus = String(skusText || "")
    .split(/[\r\n,;\t ]+/)
    .map((value) => value.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);

  return [...new Set(skus)];
}

function normalizePublicImageUrl(rawLocation) {
  const location = String(rawLocation || "").trim();

  if (!location || location.startsWith("s3://")) {
    return "";
  }

  // URL já completa
  if (/^https?:\/\//i.test(location)) {
    return encodeURI(
      location.replace(
        /^https?:\/\/vteximg\.com\.br/i,
        "https://alphabeto.vteximg.com.br"
      )
    );
  }

  // URL começando com //
  if (location.startsWith("//")) {
    return encodeURI(
      `https:${location}`.replace(
        /^https:\/\/vteximg\.com\.br/i,
        "https://alphabeto.vteximg.com.br"
      )
    );
  }

  // Remove barras extras do começo
  const normalized = location.replace(/^\/+/, "");

  // Corrige domínio da VTEX
  const withStoreDomain = normalized.replace(
    /^vteximg\.com\.br/i,
    "alphabeto.vteximg.com.br"
  );

  return encodeURI(`https://${withStoreDomain}`);
}

function inferMimeTypeFromExtension(extension) {
  const normalizedExtension = String(extension || "").toLowerCase();

  switch (normalizedExtension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".avif":
      return "image/avif";
    case ".svg":
      return "image/svg+xml";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    default:
      return "";
  }
}

function normalizeHeaderMimeType(rawContentType) {
  return String(rawContentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function getExtensionFromUrl(url) {
  try {
    return path.extname(new URL(url).pathname).toLowerCase();
  } catch (_error) {
    return "";
  }
}

function getImageExtension(file, mimeType) {
  const candidates = [
    path.extname(file.fileName || ""),
    getExtensionFromUrl(file.url),
    IMAGE_TYPE_EXTENSIONS[mimeType],
  ];

  for (const candidate of candidates) {
    const extension = String(candidate || "").toLowerCase();

    if (inferMimeTypeFromExtension(extension)) {
      return extension === ".jpeg" ? ".jpg" : extension;
    }
  }

  return IMAGE_TYPE_EXTENSIONS[mimeType] || ".jpg";
}

function ensureExtension(fileName, extension) {
  const baseName = String(fileName || "").trim() || "imagem-vtex";

  if (path.extname(baseName)) {
    return baseName;
  }

  return `${baseName}${extension || ".jpg"}`;
}

function normalizeFileToken(value, fallback) {
  return (
    String(value || "")
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || fallback
  );
}

function buildVtexUploadName(file, extension) {
  const sku = normalizeFileToken(file.sku, "sku");
  const position = Number.isFinite(Number(file.position)) ? Number(file.position) : 1;

  return `${sku}_${position}${extension || ".jpg"}`;
}

function getFileSortPosition(file, fallback) {
  const parsedPosition = Number(file.Position);

  if (Number.isFinite(parsedPosition)) {
    return parsedPosition;
  }

  return fallback;
}

function normalizeVtexFile(file, sku, fallbackIndex) {
  const sortPosition = getFileSortPosition(file, fallbackIndex);

  const publicUrl = normalizePublicImageUrl(
    file.FileLocation || file.Url
  );

  if (!publicUrl) {
    return null;
  }

  const displayPosition = Number.isFinite(Number(file.Position))
    ? Number(file.Position) + 1
    : fallbackIndex + 1;

  const fileName = String(
    file.Name ||
      file.Text ||
      `sku-${sku}-imagem-${displayPosition}`
  ).trim();

  return {
    sku,
    id: file.Id || "",
    archiveId: file.ArchiveId || "",
    fileName,
    sourceName: fileName,
    objectPath: `${sku}-${file.ArchiveId || file.Id || displayPosition}`,
    url: publicUrl,
    position: displayPosition,
    sortPosition,
    isMain: Boolean(file.IsMain),
    sourceSystem: "vtex",
  };
}

function buildSkuFilesUrl(sku) {
  return `${appConfig.vtex.apiBaseUrl}/api/catalog/pvt/stockkeepingunit/${encodeURIComponent(
    sku
  )}/file`;
}

async function fetchSkuFiles(sku) {
  const response = await fetchWithRetry(
    buildSkuFilesUrl(sku),
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-VTEX-API-AppKey": appConfig.vtex.appKey,
        "X-VTEX-API-AppToken": appConfig.vtex.appToken,
      },
    },
    {}
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");

    const detail = body
      ? ` ${body.slice(0, 300)}`
      : "";

    const error = new Error(
      `VTEX retornou HTTP ${response.status} para o SKU ${sku}.${detail}`
    );

    error.statusCode =
      response.status === 401 || response.status === 403
        ? response.status
        : 502;

    throw error;
  }

  const payload = await response.json();

  if (!Array.isArray(payload)) {
    throw new Error(
      `A VTEX respondeu em formato inesperado para o SKU ${sku}.`
    );
  }

  return payload
    .map((file, index) =>
      normalizeVtexFile(file, sku, index)
    )
    .filter(Boolean)
    .sort(
      (left, right) =>
        left.sortPosition - right.sortPosition ||
        Number(right.isMain) - Number(left.isMain)
    );
}

function scaleProgress(
  completed,
  total,
  rangeStart,
  rangeEnd
) {
  if (!total) {
    return rangeEnd;
  }

  return Math.round(
    rangeStart +
      ((rangeEnd - rangeStart) * completed) / total
  );
}

async function fetchVtexSkuImages({
  skusText,
  onProgress,
  progressStart = 8,
  progressEnd = 95,
}) {
  ensureVtexConfigured();

  const reportProgress =
    typeof onProgress === "function"
      ? onProgress
      : () => {};

  const skus = parseSkusText(skusText);

  if (!skus.length) {
    throw new Error(
      "Informe pelo menos um SKU para importar as fotos da VTEX."
    );
  }

  if (appConfig.vtex.maxSkus && skus.length > appConfig.vtex.maxSkus) {
    throw new Error(
      `A lista tem ${skus.length} SKUs. O limite atual é ${appConfig.vtex.maxSkus}; ajuste VTEX_MAX_EXPORT_SKUS no .env se precisar.`
    );
  }

  reportProgress({
    percent: progressStart,
    stage: "querying",
    detail: `Consultando fotos de ${skus.length} SKU(s) na VTEX.`,
    totalItems: skus.length,
    completedItems: 0,
  });

  const results = new Array(skus.length);

  const warnings = [];

  let completedItems = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < skus.length) {
      const currentIndex = cursor;

      const sku = skus[currentIndex];

      cursor += 1;

      try {
        results[currentIndex] =
          await fetchSkuFiles(sku);

        if (!results[currentIndex].length) {
          warnings.push(
            `Nenhuma foto encontrada para o SKU ${sku}.`
          );
        }
      } catch (error) {
        if (
          error.statusCode === 401 ||
          error.statusCode === 403
        ) {
          throw error;
        }

        warnings.push(
          `Falha ao buscar fotos do SKU ${sku}: ${error.message}`
        );

        results[currentIndex] = [];
      } finally {
        completedItems += 1;

        reportProgress({
          percent: scaleProgress(
            completedItems,
            skus.length,
            progressStart,
            progressEnd
          ),
          stage: "querying",
          detail: `Consultados ${completedItems} de ${skus.length} SKU(s).`,
          totalItems: skus.length,
          completedItems,
        });
      }
    }
  }

  const workers = Array.from(
    {
      length: Math.min(
        appConfig.vtex.requestConcurrency,
        skus.length
      ),
    },
    () => worker()
  );

  await Promise.all(workers);

  const files = results.flat();

  reportProgress({
    percent: progressEnd,
    stage: "querying",
    detail: `${files.length} foto(s) localizada(s) para ${skus.length} SKU(s).`,
    totalItems: skus.length,
    completedItems: skus.length,
  });

  return {
    source: "vtex",
    requestedCount: skus.length,
    foundCount: files.length,
    files,
    warnings: [...new Set(warnings)],
  };
}

async function downloadVtexImage(file) {
  const response = await fetchWithRetry(
    file.url,
    {
      method: "GET",
      headers: {
        Accept: "image/*",
      },
    },
    {}
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const headerMimeType = normalizeHeaderMimeType(response.headers.get("content-type"));
  const urlExtension = getExtensionFromUrl(file.url);
  const effectiveMimeType =
    headerMimeType.startsWith("image/")
      ? headerMimeType
      : inferMimeTypeFromExtension(urlExtension);

  if (!effectiveMimeType.startsWith("image/")) {
    throw new Error("a URL nao retornou uma imagem valida");
  }

  const maxBytes = appConfig.maxFileSizeMb * 1024 * 1024;
  const contentLength = Number(response.headers.get("content-length"));

  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`imagem maior que ${appConfig.maxFileSizeMb} MB`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.length > maxBytes) {
    throw new Error(`imagem maior que ${appConfig.maxFileSizeMb} MB`);
  }

  const extension = getImageExtension(file, effectiveMimeType);
  const originalname = buildVtexUploadName(file, extension);
  const sourceOriginalName = ensureExtension(file.fileName, extension);

  return {
    buffer,
    originalname,
    sourceOriginalName,
    mimetype: effectiveMimeType,
    size: buffer.length,
    customMetadata: {
      sourceSystem: "vtex",
      sku: String(file.sku || ""),
      position: String(file.position || ""),
      vtexArchiveId: String(file.archiveId || ""),
      vtexFileId: String(file.id || ""),
      vtexOriginalUrl: String(file.url || ""),
      vtexOriginalName: sourceOriginalName,
    },
  };
}

async function downloadVtexImageEntries({
  files,
  onProgress,
  progressStart = 0,
  progressEnd = 100,
}) {
  const sourceFiles = Array.isArray(files) ? files : [];
  const reportProgress =
    typeof onProgress === "function"
      ? onProgress
      : () => {};
  const entries = new Array(sourceFiles.length);
  const warnings = [];

  if (!sourceFiles.length) {
    reportProgress({
      percent: progressEnd,
      stage: "downloading",
      detail: "Nenhuma imagem da VTEX para baixar.",
      totalItems: 0,
      completedItems: 0,
    });

    return {
      entries: [],
      warnings,
    };
  }

  reportProgress({
    percent: progressStart,
    stage: "downloading",
    detail: `Baixando ${sourceFiles.length} imagem(ns) da VTEX.`,
    totalItems: sourceFiles.length,
    completedItems: 0,
  });

  let completedItems = 0;
  let downloadedItems = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < sourceFiles.length) {
      const currentIndex = cursor;
      const file = sourceFiles[currentIndex];

      cursor += 1;

      try {
        entries[currentIndex] = await downloadVtexImage(file);
        downloadedItems += 1;
      } catch (error) {
        warnings.push(
          `Falha ao baixar a imagem ${file.position || currentIndex + 1} do SKU ${file.sku}: ${error.message}`
        );
      } finally {
        completedItems += 1;

        reportProgress({
          percent: scaleProgress(
            completedItems,
            sourceFiles.length,
            progressStart,
            progressEnd
          ),
          stage: "downloading",
          detail: `Baixadas ${downloadedItems} de ${sourceFiles.length} imagem(ns) da VTEX.`,
          totalItems: sourceFiles.length,
          completedItems,
        });
      }
    }
  }

  const workers = Array.from(
    {
      length: Math.min(
        appConfig.vtex.requestConcurrency,
        sourceFiles.length
      ),
    },
    () => worker()
  );

  await Promise.all(workers);

  return {
    entries: entries.filter(Boolean),
    warnings: [...new Set(warnings)],
  };
}

module.exports = {
  downloadVtexImageEntries,
  fetchVtexSkuImages,
  parseSkusText,
};
