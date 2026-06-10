const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const { appConfig, normalizeSingleFolder } = require("./config");
const { createFolder, listFiles, listFolders, uploadImages } = require("./services/storage");
const { completeTask, failTask, getTask, startTask, updateTask } = require("./services/tasks");
const { downloadVtexImageEntries, fetchVtexSkuImages } = require("./services/vtex");
const { createCsv } = require("./utils/csv");
const { buildImageLinkColumns, buildImageLinkExport } = require("./utils/image-links");

const publicDirectory = path.resolve(__dirname, "..", "public");

function createBadRequest(message) {
  const error = new Error(message);

  error.statusCode = 400;
  return error;
}

function buildConfigResponse() {
  return {
    ready: Boolean(appConfig.bucketName) && !appConfig.credentialError,
    authEnabled: appConfig.auth.basicEnabled,
    bucketName: appConfig.bucketName,
    defaultPrefix: appConfig.defaultPrefix,
    credentialMode: appConfig.credentialMode,
    credentialError: appConfig.credentialError,
    urlMode: appConfig.urlMode,
    makePublic: appConfig.makePublic,
    maxFilesPerUpload: appConfig.maxFilesPerUpload,
    maxFileSizeMb: appConfig.maxFileSizeMb,
    uploadConcurrency: appConfig.uploadConcurrency,
    uploadRetryLimit: appConfig.uploadRetryLimit,
    uploadTimeoutMs: appConfig.uploadTimeoutMs,
    resumableUploadMinBytes: appConfig.resumableUploadMinBytes,
    imageCompression: appConfig.imageCompression,
    vtexEnabled: appConfig.vtex.enabled,
    vtexAccountName: appConfig.vtex.accountName,
    vtexMaxSkus: appConfig.vtex.maxSkus,
    vtexRequestRetryLimit: appConfig.vtex.requestRetryLimit,
    missing: appConfig.missing,
    warnings: appConfig.warnings,
  };
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requestAuthentication(response) {
  response.setHeader("WWW-Authenticate", 'Basic realm="Storage Marketplace"');
  response.status(401).json({
    message: "Autenticacao necessaria.",
  });
}

function createBasicAuthMiddleware() {
  return (request, response, next) => {
    if (!appConfig.auth.basicEnabled) {
      next();
      return;
    }

    const authorization = String(request.headers.authorization || "");
    const match = authorization.match(/^Basic\s+(.+)$/i);

    if (!match) {
      requestAuthentication(response);
      return;
    }

    let decoded = "";

    try {
      decoded = Buffer.from(match[1], "base64").toString("utf8");
    } catch (_error) {
      requestAuthentication(response);
      return;
    }

    const separatorIndex = decoded.indexOf(":");

    if (separatorIndex === -1) {
      requestAuthentication(response);
      return;
    }

    const user = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);

    if (safeEqual(user, appConfig.auth.user) && safeEqual(password, appConfig.auth.password)) {
      next();
      return;
    }

    requestAuthentication(response);
  };
}

function resolveRequestedFolder(request) {
  try {
    return normalizeSingleFolder(request.query.prefix || request.body?.prefix || appConfig.defaultPrefix);
  } catch (error) {
    throw createBadRequest(error.message);
  }
}

function resolveFolderPathForCreation(request) {
  const folderName = String(request.body?.folderName || request.body?.folderPath || "").trim();

  if (!folderName) {
    throw createBadRequest("Informe o nome da pasta que deseja criar.");
  }

  try {
    return normalizeSingleFolder(folderName);
  } catch (error) {
    throw createBadRequest(error.message);
  }
}

function resolveCompressionOptions(request) {
  return {
    enabled: request.body?.compressionEnabled,
    quality: request.body?.compressionQuality,
    maxWidth: request.body?.compressionMaxWidth,
  };
}

function scalePercent(percent, rangeStart, rangeEnd) {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));

  return Math.round(rangeStart + ((rangeEnd - rangeStart) * safePercent) / 100);
}

function reportTaskProgress(taskId, progress) {
  updateTask(taskId, {
    status: "running",
    percent: progress.percent,
    stage: progress.stage,
    detail: progress.detail,
    completedItems: progress.completedItems,
    totalItems: progress.totalItems,
  });
}

function createUploadMiddleware() {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      files: appConfig.maxFilesPerUpload,
      fileSize: appConfig.maxFileSizeMb * 1024 * 1024,
    },
    fileFilter: (_request, file, callback) => {
      if (file.mimetype.startsWith("image/")) {
        callback(null, true);
        return;
      }

      callback(new Error("Somente arquivos de imagem sao aceitos."));
    },
  });
}

function createApp() {
  const app = express();
  const upload = createUploadMiddleware();

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
    });
  });

  app.use(createBasicAuthMiddleware());
  app.use(express.json());
  app.use(express.static(publicDirectory));

  app.get("/api/config", (_request, response) => {
    response.json(buildConfigResponse());
  });

  app.get("/api/tasks/:taskId", (request, response) => {
    const task = getTask(request.params.taskId);

    if (!task) {
      response.status(404).json({
        message: "Tarefa de progresso nao encontrada ou ja expirada.",
      });
      return;
    }

    response.json(task);
  });

  app.get("/api/files", async (request, response, next) => {
    try {
      const prefix = resolveRequestedFolder(request);
      const files = await listFiles(prefix);

      response.json({
        prefix,
        count: files.length,
        files,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/folders", async (_request, response, next) => {
    try {
      const folders = await listFolders();

      response.json({
        count: folders.length,
        folders,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/folders", async (request, response, next) => {
    try {
      const folderPath = resolveFolderPathForCreation(request);
      const folder = await createFolder(folderPath);

      response.status(201).json({
        message: `Pasta ${folder.path} criada com sucesso.`,
        folder,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/vtex/images", async (request, response, next) => {
    const taskId = String(request.body?.taskId || "").trim();

    try {
      const prefix = resolveRequestedFolder(request);
      const compressionOptions = resolveCompressionOptions(request);

      startTask(taskId, "vtex-images", {
        stage: "querying",
        detail: "Iniciando importacao de fotos por SKU na VTEX.",
      });

      const vtexResult = await fetchVtexSkuImages({
        skusText: request.body?.skusText,
        progressStart: 5,
        progressEnd: 30,
        onProgress: (progress) => reportTaskProgress(taskId, progress),
      });

      const downloadResult = await downloadVtexImageEntries({
        files: vtexResult.files,
        progressStart: 30,
        progressEnd: 55,
        onProgress: (progress) => reportTaskProgress(taskId, progress),
      });

      if (!downloadResult.entries.length) {
        const warnings = [...new Set([...vtexResult.warnings, ...downloadResult.warnings])];
        const result = {
          source: "vtex",
          prefix,
          requestedCount: vtexResult.requestedCount,
          vtexFoundCount: vtexResult.foundCount,
          downloadedCount: 0,
          foundCount: 0,
          files: [],
          warnings,
        };

        completeTask(taskId, {
          detail: "Nenhuma imagem da VTEX foi baixada para envio ao storage.",
          completedItems: vtexResult.requestedCount,
          totalItems: vtexResult.requestedCount,
        });

        response.json(result);
        return;
      }

      const uploadResult = await uploadImages(downloadResult.entries, prefix, {
        compressionOptions,
        onProgress: (progress) =>
          reportTaskProgress(taskId, {
            ...progress,
            percent: scalePercent(progress.percent, 55, 100),
          }),
      });

      const warnings = [
        ...new Set([
          ...vtexResult.warnings,
          ...downloadResult.warnings,
          ...uploadResult.warnings,
        ]),
      ];
      const result = {
        ...uploadResult,
        source: "vtex",
        requestedCount: vtexResult.requestedCount,
        vtexFoundCount: vtexResult.foundCount,
        downloadedCount: downloadResult.entries.length,
        foundCount: uploadResult.files.length,
        warnings,
      };

      completeTask(taskId, {
        detail: `${uploadResult.files.length} imagem(ns) importadas da VTEX para ${uploadResult.prefix}.`,
        completedItems: uploadResult.files.length,
        totalItems: vtexResult.foundCount,
      });

      response.status(201).json(result);
    } catch (error) {
      failTask(taskId, error);
      next(error);
    }
  });

  app.get("/api/export.csv", async (request, response, next) => {
    try {
      const prefix = resolveRequestedFolder(request);
      const files = await listFiles(prefix);
      const exportData = buildImageLinkExport(files);
      const csv = createCsv(exportData.rows, buildImageLinkColumns(exportData.maxLinks));
      const safePrefix = prefix || "raiz";

      response.setHeader("Content-Type", "text/csv; charset=utf-8");
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="links-${safePrefix}.csv"`
      );
      response.send(csv);
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/upload",
    upload.array("images", appConfig.maxFilesPerUpload),
    async (request, response, next) => {
      const taskId = String(request.body?.taskId || "").trim();

      try {
        if (!request.files?.length) {
          response.status(400).json({
            message: "Selecione ao menos uma imagem para enviar.",
          });
          return;
        }

        const prefix = resolveRequestedFolder(request);
        const compressionOptions = resolveCompressionOptions(request);

        startTask(taskId, "upload", {
          stage: "preparing",
          detail: "Recebendo e processando imagens.",
        });

        const result = await uploadImages(request.files, prefix, {
          compressionOptions,
          onProgress: (progress) => {
            updateTask(taskId, {
              status: "running",
              percent: progress.percent,
              stage: progress.stage,
              detail: progress.detail,
              completedItems: progress.completedItems,
              totalItems: progress.totalItems,
            });
          },
        });

        completeTask(taskId, {
          detail: `${result.files.length} imagem(ns) enviadas com sucesso.`,
          completedItems: result.files.length,
          totalItems: request.files.length,
        });

        response.status(201).json(result);
      } catch (error) {
        failTask(taskId, error);
        next(error);
      }
    }
  );

  app.get(/^\/(?!api).*/, (_request, response) => {
    response.sendFile(path.join(publicDirectory, "index.html"));
  });

  app.use((error, _request, response, _next) => {
    if (error instanceof multer.MulterError) {
      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? `Cada arquivo pode ter no maximo ${appConfig.maxFileSizeMb} MB.`
          : error.code === "LIMIT_FILE_COUNT"
            ? `Envie no maximo ${appConfig.maxFilesPerUpload} arquivos por vez.`
            : error.message;

      response.status(400).json({ message });
      return;
    }

    response.status(error.statusCode || error.status || 500).json({
      message: error.message || "Ocorreu um erro inesperado ao processar a solicitacao.",
    });
  });

  return app;
}

const app = createApp();
let activeServer = null;

function startServer(port = appConfig.port) {
  const server = app.listen(port, () => {
    const address = server.address();
    const activePort =
      address && typeof address === "object" && "port" in address ? address.port : port;

    console.log(`Uploader GCS rodando em http://localhost:${activePort}`);
  });

  activeServer = server;

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  createApp,
  startServer,
};
