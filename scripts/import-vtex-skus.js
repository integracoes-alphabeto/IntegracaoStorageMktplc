#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const { appConfig } = require("../src/config");
const { listFiles, uploadImages } = require("../src/services/storage");
const { downloadVtexImageEntries, fetchVtexSkuImages, parseSkusText } = require("../src/services/vtex");
const { createCsv } = require("../src/utils/csv");
const { buildImageLinkColumns, buildImageLinkExport } = require("../src/utils/image-links");

function parseArgs(argv) {
  const args = {
    _: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=");
    const key = rawKey.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());

    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }

    const nextValue = argv[index + 1];

    if (nextValue && !nextValue.startsWith("--")) {
      args[key] = nextValue;
      index += 1;
      continue;
    }

    args[key] = "true";
  }

  return args;
}

async function readStdin() {
  if (process.stdin.isTTY) {
    return "";
  }

  const chunks = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function readSkusText(args) {
  if (args.skusFile) {
    return fs.readFile(path.resolve(process.cwd(), args.skusFile), "utf8");
  }

  if (args.skus) {
    return args.skus;
  }

  if (args._.length) {
    return args._.join("\n");
  }

  return readStdin();
}

function createProgressLogger(label) {
  let lastLogAt = 0;
  let lastDetail = "";

  return (progress) => {
    const now = Date.now();
    const detail = `${progress.percent}% - ${progress.detail || progress.stage || ""}`;

    if (detail === lastDetail || now - lastLogAt < 3000) {
      return;
    }

    lastLogAt = now;
    lastDetail = detail;
    console.log(`[${label}] ${detail}`);
  };
}

async function writeJson(filePath, payload) {
  const resolvedPath = path.resolve(process.cwd(), filePath);

  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`);

  return resolvedPath;
}

async function writeCsv(filePath, files) {
  const resolvedPath = path.resolve(process.cwd(), filePath);
  const exportData = buildImageLinkExport(files);
  const csv = createCsv(exportData.rows, buildImageLinkColumns(exportData.maxLinks));

  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, csv);

  return resolvedPath;
}

function normalizeKeyPart(value) {
  return String(value || "").trim();
}

function buildImportKey(parts) {
  const sku = normalizeKeyPart(parts.sku);
  const position = normalizeKeyPart(parts.position);
  const archiveId = normalizeKeyPart(parts.archiveId || parts.vtexArchiveId);
  const fileId = normalizeKeyPart(parts.vtexFileId || parts.id);
  const originalUrl = normalizeKeyPart(parts.originalUrl || parts.vtexOriginalUrl || parts.url);

  return [sku, position, archiveId, fileId, originalUrl].join("|");
}

function buildEntryImportKey(entry) {
  return buildImportKey({
    sku: entry?.customMetadata?.sku,
    position: entry?.customMetadata?.position,
    vtexArchiveId: entry?.customMetadata?.vtexArchiveId,
    vtexFileId: entry?.customMetadata?.vtexFileId,
    vtexOriginalUrl: entry?.customMetadata?.vtexOriginalUrl,
  });
}

function selectImportFiles(allFiles, sourceFiles) {
  const expectedKeys = new Set(sourceFiles.map(buildImportKey));
  const selectedByKey = new Map();

  for (const file of allFiles) {
    const key = buildImportKey(file);

    if (!expectedKeys.has(key)) {
      continue;
    }

    const current = selectedByKey.get(key);
    const currentDate = current?.updatedAt || current?.createdAt || "";
    const fileDate = file.updatedAt || file.createdAt || "";

    if (!current || fileDate > currentDate) {
      selectedByKey.set(key, file);
    }
  }

  return [...selectedByKey.values()];
}

async function listExistingFiles(prefix) {
  try {
    return await listFiles(prefix);
  } catch (error) {
    console.warn(`Nao foi possivel listar arquivos existentes para retomada: ${error.message}`);
    return [];
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prefix = String(args.prefix || appConfig.defaultPrefix || "").trim();
  const outputPath = args.out || `docs/imports/${prefix || "importacao"}-resultado.json`;
  const csvOutputPath = args.csvOut || `docs/imports/${prefix || "importacao"}-links.csv`;
  const skusText = await readSkusText(args);
  const skus = parseSkusText(skusText);

  if (!prefix) {
    throw new Error("Informe --prefix com a pasta de destino no bucket.");
  }

  if (!skus.length) {
    throw new Error("Informe SKUs por --skus-file, --skus, argumentos ou stdin.");
  }

  const startedAt = new Date().toISOString();
  const compressionOptions = {
    enabled: args.compressionEnabled,
    quality: args.compressionQuality,
    maxWidth: args.compressionMaxWidth,
  };
  const resumeEnabled = args.resume !== "false";

  console.log(`Importando ${skus.length} SKU(s) para a pasta ${prefix}.`);
  console.log(
    `Upload: concorrencia=${appConfig.uploadConcurrency}, retries=${appConfig.uploadRetryLimit}, resumableMinBytes=${appConfig.resumableUploadMinBytes}.`
  );

  const vtexResult = await fetchVtexSkuImages({
    skusText: skus.join("\n"),
    onProgress: createProgressLogger("VTEX"),
  });

  let sourceFiles = vtexResult.files;
  let skippedExistingCount = 0;

  if (resumeEnabled && sourceFiles.length) {
    const existingFiles = await listExistingFiles(prefix);
    const existingKeys = new Set(existingFiles.map(buildImportKey));

    sourceFiles = vtexResult.files.filter((file) => !existingKeys.has(buildImportKey(file)));
    skippedExistingCount = vtexResult.files.length - sourceFiles.length;

    if (skippedExistingCount) {
      console.log(`Retomada: ${skippedExistingCount} imagem(ns) ja existiam em ${prefix}; enviando apenas faltantes.`);
    }
  }

  const downloadResult = await downloadVtexImageEntries({
    files: sourceFiles,
    onProgress: createProgressLogger("Download"),
  });

  let pendingEntries = downloadResult.entries;

  if (resumeEnabled && skippedExistingCount && pendingEntries.length) {
    const existingFiles = await listExistingFiles(prefix);
    const existingKeys = new Set(existingFiles.map(buildImportKey));

    pendingEntries = downloadResult.entries.filter((entry) => !existingKeys.has(buildEntryImportKey(entry)));
  }

  const uploadResult = pendingEntries.length
    ? await uploadImages(pendingEntries, prefix, {
        compressionOptions,
        concurrency: args.concurrency,
        onProgress: createProgressLogger("Storage"),
      })
    : {
        prefix,
        files: [],
        warnings: [],
      };

  const warnings = [
    ...new Set([
      ...vtexResult.warnings,
      ...downloadResult.warnings,
      ...uploadResult.warnings,
    ]),
  ];

  const completedAt = new Date().toISOString();
  const finalFiles = await listExistingFiles(prefix);
  const importFiles = selectImportFiles(finalFiles, vtexResult.files);
  const exportFiles = importFiles.length ? importFiles : uploadResult.files;
  const result = {
    source: "vtex",
    prefix,
    startedAt,
    completedAt,
    requestedCount: vtexResult.requestedCount,
    vtexFoundCount: vtexResult.foundCount,
    skippedExistingCount,
    downloadedCount: downloadResult.entries.length,
    uploadedCount: uploadResult.files.length,
    finalFileCount: finalFiles.length,
    exportedFileCount: exportFiles.length,
    warnings,
    files: exportFiles,
  };

  const writtenJson = await writeJson(outputPath, result);
  const writtenCsv = await writeCsv(csvOutputPath, result.files);

  console.log(`Importacao concluida: ${uploadResult.files.length} imagem(ns) enviadas.`);
  console.log(`Resumo JSON: ${writtenJson}`);
  console.log(`CSV de links: ${writtenCsv}`);

  if (warnings.length) {
    console.log(`Avisos: ${warnings.length}. Veja o JSON para detalhes.`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArgs,
};
