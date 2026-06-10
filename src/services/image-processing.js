const path = require("path");
const sharp = require("sharp");
const { appConfig } = require("../config");

const SUPPORTED_RASTER_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/tiff",
]);

function inferMimeTypeFromName(fileName) {
  const extension = path.extname(String(fileName || "")).toLowerCase();

  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".avif":
      return "image/avif";
    case ".tif":
    case ".tiff":
      return "image/tiff";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    default:
      return "";
  }
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function normalizeCompressionOptions(rawOptions = {}) {
  const defaults = appConfig.imageCompression;
  const enabled =
    rawOptions.enabled === undefined || rawOptions.enabled === null || rawOptions.enabled === ""
      ? defaults.enabled
      : ["1", "true", "yes", "on"].includes(String(rawOptions.enabled).toLowerCase());

  return {
    enabled,
    quality: clampNumber(rawOptions.quality, 1, 100, defaults.quality),
    maxWidth: clampNumber(rawOptions.maxWidth, 0, 10000, defaults.maxWidth),
  };
}

function getFormatExtension(format, originalExtension) {
  switch (format) {
    case "jpeg":
    case "jpg":
      return ".jpg";
    case "png":
      return ".png";
    case "webp":
      return ".webp";
    case "avif":
      return ".avif";
    case "tiff":
      return ".tiff";
    default:
      return originalExtension || ".jpg";
  }
}

function getMimeTypeForFormat(format, fallback) {
  switch (format) {
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "tiff":
      return "image/tiff";
    default:
      return fallback || "image/jpeg";
  }
}

async function compressImageEntry(entry, rawOptions = {}) {
  const options = normalizeCompressionOptions(rawOptions);
  const sourceName = entry?.sourceOriginalName || entry?.originalname || "";
  const parsedName = path.parse(entry?.originalname || sourceName || "imagem");

  if (!options.enabled || !entry?.buffer) {
    const inferredMimeType =
      entry?.mimetype && entry.mimetype.startsWith("image/")
        ? entry.mimetype
        : inferMimeTypeFromName(sourceName) || inferMimeTypeFromName(entry?.originalname);

    return {
      ...entry,
      mimetype: inferredMimeType || entry?.mimetype || "",
      sourceOriginalName: sourceName,
      compression: {
        enabled: options.enabled,
        applied: false,
        skipped: true,
        reason: "compression-disabled",
        quality: options.quality,
        maxWidth: options.maxWidth,
        originalBytes: entry.size ?? entry.buffer?.length ?? 0,
        outputBytes: entry.size ?? entry.buffer?.length ?? 0,
      },
    };
  }

  const sourceImage = sharp(entry.buffer, {
    animated: false,
    limitInputPixels: false,
  });
  const metadata = await sourceImage.metadata();
  const detectedFormat = String(metadata.format || "").toLowerCase();
  const detectedMimeType = getMimeTypeForFormat(detectedFormat, "");
  const nameMimeType = inferMimeTypeFromName(sourceName) || inferMimeTypeFromName(entry.originalname);
  const effectiveMimeType =
    entry.mimetype && entry.mimetype.startsWith("image/")
      ? entry.mimetype.toLowerCase()
      : detectedMimeType || nameMimeType || String(entry.mimetype || "").toLowerCase();

  if (!SUPPORTED_RASTER_TYPES.has(effectiveMimeType)) {
    return {
      ...entry,
      mimetype: effectiveMimeType || entry.mimetype || "",
      sourceOriginalName: sourceName,
      compression: {
        enabled: options.enabled,
        applied: false,
        skipped: true,
        reason: "unsupported-format",
        quality: options.quality,
        maxWidth: options.maxWidth,
        originalBytes: entry.size ?? entry.buffer?.length ?? 0,
        outputBytes: entry.size ?? entry.buffer?.length ?? 0,
      },
    };
  }

  const originalExtension = parsedName.ext || path.extname(sourceName);
  let pipeline = sourceImage.rotate();

  if (options.maxWidth > 0) {
    pipeline = pipeline.resize({
      width: options.maxWidth,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  let outputFormat = metadata.format || "jpeg";

  switch (metadata.format) {
    case "jpeg":
    case "jpg":
      outputFormat = "jpeg";
      pipeline = pipeline.jpeg({
        quality: options.quality,
        mozjpeg: true,
      });
      break;
    case "png":
      outputFormat = "png";
      pipeline = pipeline.png({
        quality: options.quality,
        compressionLevel: 9,
        palette: true,
      });
      break;
    case "webp":
      outputFormat = "webp";
      pipeline = pipeline.webp({
        quality: options.quality,
      });
      break;
    case "avif":
      outputFormat = "avif";
      pipeline = pipeline.avif({
        quality: options.quality,
      });
      break;
    case "tiff":
      outputFormat = "tiff";
      pipeline = pipeline.tiff({
        quality: options.quality,
      });
      break;
    default:
      outputFormat = "jpeg";
      pipeline = pipeline.jpeg({
        quality: options.quality,
        mozjpeg: true,
      });
      break;
  }

  const outputBuffer = await pipeline.toBuffer();
  const outputExtension = getFormatExtension(outputFormat, originalExtension);
  const outputMimeType = getMimeTypeForFormat(outputFormat, entry.mimetype);

  return {
    ...entry,
    buffer: outputBuffer,
    size: outputBuffer.length,
    mimetype: outputMimeType,
    originalname: `${parsedName.name}${outputExtension}`,
    sourceOriginalName: sourceName,
    compression: {
      enabled: options.enabled,
      applied: true,
      skipped: false,
      quality: options.quality,
      maxWidth: options.maxWidth,
      originalBytes: entry.size ?? entry.buffer?.length ?? 0,
      outputBytes: outputBuffer.length,
      originalWidth: metadata.width || 0,
      originalHeight: metadata.height || 0,
    },
  };
}

module.exports = {
  compressImageEntry,
  normalizeCompressionOptions,
};
