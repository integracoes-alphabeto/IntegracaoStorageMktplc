const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function parseNumber(value, fallback) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSegment(value) {
  return String(value)
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizePrefix(prefix) {
  if (!prefix) {
    return "";
  }

  return String(prefix)
    .split(/[\\/]+/)
    .map((segment) => normalizeSegment(segment))
    .filter(Boolean)
    .join("/");
}

function normalizeSingleFolder(value) {
  const rawValue = String(value || "").trim();

  if (!rawValue) {
    return "";
  }

  if (/[\\/]/.test(rawValue)) {
    throw new Error("Use apenas uma pasta simples. Subpastas nao sao permitidas.");
  }

  return normalizeSegment(rawValue);
}

function parseInlineCredentials() {
  const rawJson = process.env.GCS_SERVICE_ACCOUNT_JSON;
  const rawBase64 = process.env.GCS_SERVICE_ACCOUNT_JSON_BASE64;

  if (!rawJson && !rawBase64) {
    return { inlineCredentials: null, credentialError: "" };
  }

  try {
    if (rawJson) {
      return {
        inlineCredentials: JSON.parse(rawJson),
        credentialError: "",
      };
    }

    const decoded = Buffer.from(rawBase64, "base64").toString("utf8");

    return {
      inlineCredentials: JSON.parse(decoded),
      credentialError: "",
    };
  } catch (error) {
    return {
      inlineCredentials: null,
      credentialError:
        "Nao foi possivel interpretar as credenciais inline do Google Cloud. Verifique o JSON/base64 informado.",
    };
  }
}

const { inlineCredentials, credentialError } = parseInlineCredentials();
const basicAuthUser = String(process.env.APP_BASIC_AUTH_USER || "").trim();
const basicAuthPassword = String(process.env.APP_BASIC_AUTH_PASSWORD || "");
const bucketName = String(process.env.GCS_BUCKET_NAME || "").trim();
const projectId = String(process.env.GCS_PROJECT_ID || "").trim();
const credentialsFile = String(
  process.env.GCS_CREDENTIALS_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS || ""
).trim();
const defaultPrefix = normalizeSingleFolder(process.env.GCS_DEFAULT_PREFIX || "produtos");
const urlMode = String(process.env.GCS_URL_MODE || "public").toLowerCase() === "signed" ? "signed" : "public";
const signedUrlDays = Math.max(parseNumber(process.env.GCS_SIGNED_URL_DAYS, 7), 1);
const maxFilesPerUpload = Math.max(parseNumber(process.env.MAX_FILES_PER_UPLOAD, 100), 1);
const maxFileSizeMb = Math.max(parseNumber(process.env.MAX_FILE_SIZE_MB, 20), 1);
const uploadConcurrency = Math.min(
  Math.max(parseNumber(process.env.UPLOAD_CONCURRENCY || process.env.STORAGE_UPLOAD_CONCURRENCY, 4), 1),
  12
);
const imageCompressionEnabled = parseBoolean(process.env.IMAGE_COMPRESSION_ENABLED, true);
const imageQuality = Math.min(Math.max(parseNumber(process.env.IMAGE_QUALITY, 82), 1), 100);
const imageMaxWidth = Math.max(parseNumber(process.env.IMAGE_MAX_WIDTH, 1600), 0);
const vtexAccountName = String(process.env.VTEX_ACCOUNT_NAME || process.env.VTEX_ACCOUNT || "alphabeto").trim();
const vtexApiBaseUrl = String(
  process.env.VTEX_API_BASE_URL ||
    (vtexAccountName ? `https://${vtexAccountName}.vtexcommercestable.com.br` : "")
)
  .trim()
  .replace(/\/+$/, "");
const vtexApiAppKey = String(process.env.VTEX_API_APP_KEY || "").trim();
const vtexApiAppToken = String(process.env.VTEX_API_APP_TOKEN || "").trim();
const vtexMaxSkus = Math.max(parseNumber(process.env.VTEX_MAX_EXPORT_SKUS, 2500), 1);
const vtexRequestConcurrency = Math.min(
  Math.max(parseNumber(process.env.VTEX_REQUEST_CONCURRENCY, 6), 1),
  20
);

const missing = [];

if (!bucketName) {
  missing.push("GCS_BUCKET_NAME");
}

const warnings = [];

if (urlMode === "public" && !parseBoolean(process.env.GCS_MAKE_PUBLIC, false)) {
  warnings.push(
    "Os links publicos so funcionam se o bucket ou os objetos tiverem permissao de leitura publica."
  );
}

if (urlMode === "signed") {
  warnings.push(
    "URLs assinadas expiram. Para AnyMarket, normalmente o melhor caminho e usar links publicos."
  );
}

if (!credentialsFile && !inlineCredentials) {
  warnings.push(
    "A autenticacao esta em modo Application Default Credentials. Garanta que sua conta local consiga acessar o bucket."
  );
}

if (!vtexApiBaseUrl || !vtexApiAppKey || !vtexApiAppToken) {
  warnings.push(
    "A importacao de fotos por SKU da VTEX so fica disponivel depois de preencher VTEX_API_APP_KEY e VTEX_API_APP_TOKEN no .env."
  );
}

if (!basicAuthUser || !basicAuthPassword) {
  warnings.push(
    "A interface nao tem autenticacao propria. Antes de hospedar publicamente, preencha APP_BASIC_AUTH_USER e APP_BASIC_AUTH_PASSWORD."
  );
}

const appConfig = {
  port: parseNumber(process.env.PORT, 3000),
  auth: {
    basicEnabled: Boolean(basicAuthUser && basicAuthPassword),
    user: basicAuthUser,
    password: basicAuthPassword,
  },
  bucketName,
  projectId,
  credentialsFile: credentialsFile ? path.resolve(process.cwd(), credentialsFile) : "",
  inlineCredentials,
  credentialError,
  credentialMode: credentialsFile ? "file" : inlineCredentials ? "inline" : "application-default",
  publicBaseUrl: String(process.env.GCS_PUBLIC_BASE_URL || "").trim().replace(/\/+$/, ""),
  urlMode,
  makePublic: parseBoolean(process.env.GCS_MAKE_PUBLIC, false),
  signedUrlDays,
  defaultPrefix,
  maxFilesPerUpload,
  maxFileSizeMb,
  uploadConcurrency,
  imageCompression: {
    enabled: imageCompressionEnabled,
    quality: imageQuality,
    maxWidth: imageMaxWidth,
  },
  vtex: {
    enabled: Boolean(vtexApiBaseUrl && vtexApiAppKey && vtexApiAppToken),
    accountName: vtexAccountName,
    apiBaseUrl: vtexApiBaseUrl,
    appKey: vtexApiAppKey,
    appToken: vtexApiAppToken,
    maxSkus: vtexMaxSkus,
    requestConcurrency: vtexRequestConcurrency,
  },
  missing,
  warnings,
};

module.exports = {
  appConfig,
  normalizePrefix,
  normalizeSegment,
  normalizeSingleFolder,
};
