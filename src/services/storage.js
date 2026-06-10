const crypto = require("crypto");
const path = require("path");
const { Storage } = require("@google-cloud/storage");
const { appConfig, normalizeSingleFolder } = require("../config");
const { parseImageNameConvention } = require("../utils/marketplace");
const { compressImageEntry, normalizeCompressionOptions } = require("./image-processing");

let storageClient;

function getStorageOptions() {
  const options = {};

  if (appConfig.projectId) {
    options.projectId = appConfig.projectId;
  }

  if (appConfig.credentialsFile) {
    options.keyFilename = appConfig.credentialsFile;
  }

  if (appConfig.inlineCredentials) {
    options.credentials = appConfig.inlineCredentials;
  }

  return options;
}

function getStorageClient() {
  if (!storageClient) {
    if (appConfig.credentialError) {
      throw new Error(appConfig.credentialError);
    }

    storageClient = new Storage(getStorageOptions());
  }

  return storageClient;
}

function ensureBucketConfigured() {
  if (!appConfig.bucketName) {
    throw new Error("Configure GCS_BUCKET_NAME antes de listar ou enviar arquivos.");
  }
}

function getBucket() {
  ensureBucketConfigured();

  return getStorageClient().bucket(appConfig.bucketName);
}

function sanitizeBaseName(fileName) {
  return String(fileName)
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function inferExtension(mimeType) {
  const map = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
    "image/svg+xml": ".svg",
    "image/tiff": ".tiff",
  };

  return map[mimeType] || "";
}

function buildObjectName(folder, originalName, mimeType) {
  const parsed = path.parse(originalName);
  const baseName = sanitizeBaseName(parsed.name) || "imagem";
  const extension = (parsed.ext || inferExtension(mimeType) || "").toLowerCase();
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = crypto.randomUUID().split("-")[0];
  const fileName = `${baseName}-${stamp}-${suffix}${extension}`;
  const normalizedFolder = normalizeSingleFolder(folder);

  return normalizedFolder ? `${normalizedFolder}/${fileName}` : fileName;
}

function encodeObjectPath(objectPath) {
  return objectPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function generateFileUrl(objectPath) {
  const bucket = getBucket();

  if (appConfig.urlMode === "signed") {
    const [signedUrl] = await bucket.file(objectPath).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + appConfig.signedUrlDays * 24 * 60 * 60 * 1000,
    });

    return signedUrl;
  }

  if (appConfig.publicBaseUrl) {
    return `${appConfig.publicBaseUrl}/${encodeObjectPath(objectPath)}`;
  }

  return `https://storage.googleapis.com/${encodeURIComponent(appConfig.bucketName)}/${encodeObjectPath(objectPath)}`;
}

function buildFileRecord(objectPath, metadata = {}) {
  const fileName = path.basename(objectPath);
  const folder = objectPath.includes("/") ? objectPath.split("/")[0] : "";
  const customMetadata = metadata.metadata || {};
  const sourceName = customMetadata.originalName || fileName;
  const parsedName = parseImageNameConvention(sourceName);
  const metadataSku = String(customMetadata.sku || customMetadata.vtexSku || "").trim();
  const metadataPosition = Number(customMetadata.position || customMetadata.vtexPosition);
  const hasMetadataPosition = Number.isFinite(metadataPosition);

  return {
    id: objectPath,
    fileName,
    sourceName,
    objectPath,
    folder,
    size: Number(metadata.size || 0),
    contentType: metadata.contentType || "",
    createdAt: metadata.timeCreated || "",
    updatedAt: metadata.updated || metadata.timeCreated || "",
    sku: metadataSku || parsedName.sku,
    position: hasMetadataPosition ? metadataPosition : parsedName.position,
    detectedFromName: parsedName.detected,
    sourceSystem: customMetadata.sourceSystem || "",
    archiveId: customMetadata.vtexArchiveId || "",
    vtexFileId: customMetadata.vtexFileId || "",
    originalUrl: customMetadata.vtexOriginalUrl || "",
  };
}

function isImageObject(file) {
  const contentType = file.metadata?.contentType || "";

  if (contentType.startsWith("image/")) {
    return true;
  }

  return /\.(avif|gif|jpe?g|png|svg|webp|tiff?)$/i.test(file.name);
}

function getTopLevelFolder(fileName) {
  const segments = String(fileName || "").split("/").filter(Boolean);

  return segments.length > 1 ? segments[0] : "";
}

function computeProgressPercent(completedSteps, totalSteps) {
  if (totalSteps <= 0) {
    return 0;
  }

  return Math.round((completedSteps / totalSteps) * 100);
}

function resolveUploadConcurrency(totalItems, override) {
  const configured = Number(override || appConfig.uploadConcurrency || 1);
  const safeConfigured = Number.isFinite(configured) ? configured : 1;

  return Math.max(1, Math.min(Math.round(safeConfigured), totalItems || 1));
}

async function listFiles(folder) {
  const bucket = getBucket();
  const selectedFolder = normalizeSingleFolder(folder || "");
  const prefixQuery = selectedFolder ? `${selectedFolder}/` : undefined;
  const [files] = await bucket.getFiles({
    prefix: prefixQuery,
    autoPaginate: true,
  });

  const imageFiles = files.filter((file) => {
    if (file.name.endsWith("/")) {
      return false;
    }

    if (selectedFolder) {
      return getTopLevelFolder(file.name) === selectedFolder && isImageObject(file);
    }

    return !file.name.includes("/") && isImageObject(file);
  });

  const records = await Promise.all(
    imageFiles.map(async (file) => {
      const record = buildFileRecord(file.name, file.metadata || {});

      return {
        ...record,
        url: await generateFileUrl(file.name),
      };
    })
  );

  return records.sort((left, right) => {
    const leftDate = left.updatedAt || left.createdAt || "";
    const rightDate = right.updatedAt || right.createdAt || "";

    return rightDate.localeCompare(leftDate);
  });
}

async function listFolders() {
  const bucket = getBucket();
  const [files] = await bucket.getFiles({
    autoPaginate: true,
  });
  const folderMap = new Map();

  function ensureFolder(folderName) {
    if (!folderName) {
      return null;
    }

    if (!folderMap.has(folderName)) {
      folderMap.set(folderName, {
        path: folderName,
        name: folderName,
        imageCount: 0,
        updatedAt: "",
        hasMarker: false,
        isEmpty: true,
      });
    }

    return folderMap.get(folderName);
  }

  for (const file of files) {
    const folderName = getTopLevelFolder(file.name);

    if (!folderName) {
      continue;
    }

    const folder = ensureFolder(folderName);
    const updatedAt = file.metadata?.updated || file.metadata?.timeCreated || "";

    if (updatedAt && (!folder.updatedAt || updatedAt > folder.updatedAt)) {
      folder.updatedAt = updatedAt;
    }

    if (file.name === `${folderName}/`) {
      folder.hasMarker = true;
      continue;
    }

    if (isImageObject(file)) {
      folder.imageCount += 1;
      folder.isEmpty = false;
    }
  }

  return [...folderMap.values()].sort((left, right) => left.path.localeCompare(right.path, "pt-BR"));
}

async function createFolder(folderName) {
  const effectiveFolder = normalizeSingleFolder(folderName);

  if (!effectiveFolder) {
    throw new Error("Informe o nome da pasta que deseja criar.");
  }

  await getBucket()
    .file(`${effectiveFolder}/`)
    .save("", {
      resumable: false,
      contentType: "application/x-directory",
    });

  return {
    path: effectiveFolder,
    name: effectiveFolder,
    imageCount: 0,
    updatedAt: new Date().toISOString(),
    hasMarker: true,
    isEmpty: true,
  };
}

async function uploadImages(files, folder, options = {}) {
  return uploadPreparedImages(files, folder, options);
}

async function uploadPreparedImages(entries, folder, options = {}) {
  const bucket = getBucket();
  const effectiveFolder = normalizeSingleFolder(folder || appConfig.defaultPrefix);
  const compressionOptions = normalizeCompressionOptions(options.compressionOptions || {});
  const warnings = [];
  const uploadedFiles = [];
  const totalItems = entries.length;
  const totalSteps = totalItems * 3 || 1;
  const uploadConcurrency = resolveUploadConcurrency(totalItems, options.concurrency);
  const reportProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  let nextIndex = 0;
  let completedSteps = 0;
  let completedItems = 0;

  function reportStep(stage, detail) {
    reportProgress({
      percent: computeProgressPercent(completedSteps, totalSteps),
      stage,
      detail,
      totalItems,
      completedItems,
    });
  }

  reportProgress({
    percent: 0,
    stage: "preparing",
    detail: `Preparando imagens para envio com ${uploadConcurrency} tarefa(s) simultanea(s).`,
    totalItems,
    completedItems: 0,
  });

  async function uploadEntry(index) {
    const entry = entries[index];
    const itemPosition = index + 1;

    reportStep("compressing", `Comprimindo imagem ${itemPosition} de ${totalItems}.`);

    const processedEntry = await compressImageEntry(entry, compressionOptions);
    completedSteps += 1;

    if (processedEntry.compression?.skipped && processedEntry.compression.reason === "unsupported-format") {
      warnings.push(
        `A imagem ${processedEntry.sourceOriginalName || processedEntry.originalname} nao suporta compressao automatica e foi enviada sem alteracoes.`
      );
    }

    const objectPath = buildObjectName(effectiveFolder, processedEntry.originalname, processedEntry.mimetype);
    const remoteFile = bucket.file(objectPath);
    const createdAt = new Date().toISOString();

    reportStep("uploading", `Enviando imagem ${itemPosition} de ${totalItems} para o storage.`);

    await remoteFile.save(processedEntry.buffer, {
      resumable: false,
      contentType: processedEntry.mimetype,
      metadata: {
        cacheControl: "public, max-age=31536000",
        metadata: {
          originalName: processedEntry.sourceOriginalName || processedEntry.originalname,
          compressionEnabled: String(processedEntry.compression?.enabled ?? false),
          compressionApplied: String(processedEntry.compression?.applied ?? false),
          compressionQuality: String(processedEntry.compression?.quality ?? ""),
          compressionMaxWidth: String(processedEntry.compression?.maxWidth ?? ""),
          compressionOriginalBytes: String(processedEntry.compression?.originalBytes ?? ""),
          compressionOutputBytes: String(processedEntry.compression?.outputBytes ?? ""),
          ...processedEntry.customMetadata,
        },
      },
    });

    if (appConfig.makePublic && appConfig.urlMode === "public") {
      try {
        await remoteFile.makePublic();
      } catch (error) {
        warnings.push(
          `Nao foi possivel tornar publico automaticamente o arquivo ${processedEntry.sourceOriginalName || processedEntry.originalname}: ${error.message}`
        );
      }
    }
    completedSteps += 1;

    const fileUrl = await generateFileUrl(objectPath);
    const record = buildFileRecord(objectPath, {
      size: processedEntry.size ?? processedEntry.buffer?.length ?? 0,
      contentType: processedEntry.mimetype,
      timeCreated: createdAt,
      updated: createdAt,
      metadata: {
        originalName: processedEntry.sourceOriginalName || processedEntry.originalname,
        ...processedEntry.customMetadata,
      },
    });

    uploadedFiles.push({
      ...record,
      url: fileUrl,
    });
    completedSteps += 1;
    completedItems += 1;

    reportStep("uploaded", `${completedItems} de ${totalItems} imagem(ns) enviadas com sucesso.`);
  }

  async function worker() {
    while (nextIndex < entries.length) {
      const currentIndex = nextIndex;

      nextIndex += 1;
      await uploadEntry(currentIndex);
    }
  }

  const workers = Array.from(
    { length: Math.min(uploadConcurrency, entries.length || 1) },
    () => worker()
  );

  await Promise.all(workers);

  uploadedFiles.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  reportProgress({
    percent: 100,
    stage: "completed",
    detail: `${uploadedFiles.length} imagem(ns) processadas e enviadas.`,
    totalItems,
    completedItems: uploadedFiles.length,
  });

  return {
    prefix: effectiveFolder,
    files: uploadedFiles,
    warnings: [...new Set(warnings)],
    compression: compressionOptions,
  };
}

module.exports = {
  createFolder,
  listFiles,
  listFolders,
  uploadPreparedImages,
  uploadImages,
};
