const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

function readEnv(name, fallback = "") {
  const netlifyEnv = globalThis.Netlify?.env;
  const netlifyValue =
    typeof netlifyEnv?.get === "function" ? netlifyEnv.get(name) : undefined;

  if (netlifyValue !== undefined && netlifyValue !== null && netlifyValue !== "") {
    return netlifyValue;
  }

  return process.env[name] ?? fallback;
}

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

function parseOptionalPositiveInteger(value) {
  const rawValue = String(value ?? "").trim().toLowerCase();

  if (!rawValue || ["0", "false", "no", "none", "unlimited", "sem-limite"].includes(rawValue)) {
    return null;
  }

  const parsed = Number(rawValue);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.floor(parsed);
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
  const rawJson = readEnv("GCS_SERVICE_ACCOUNT_JSON");
  const rawBase64 = readEnv("GCS_SERVICE_ACCOUNT_JSON_BASE64");
  const splitClientEmail = readEnv("GCS_CLIENT_EMAIL");
  const splitPrivateKeyBase64 = [
    readEnv("GCS_PRIVATE_KEY_BASE64_PART1"),
    readEnv("GCS_PRIVATE_KEY_BASE64_PART2"),
    readEnv("GCS_PRIVATE_KEY_BASE64_PART3"),
    readEnv("GCS_PRIVATE_KEY_BASE64_PART4"),
  ].join("");

  if (!rawJson && !rawBase64 && !(splitClientEmail && splitPrivateKeyBase64)) {
    return { inlineCredentials: null, credentialError: "" };
  }

  try {
    if (rawJson) {
      return {
        inlineCredentials: JSON.parse(rawJson),
        credentialError: "",
      };
    }

    if (splitClientEmail && splitPrivateKeyBase64) {
      return {
        inlineCredentials: {
          type: "service_account",
          project_id: readEnv("GCS_PROJECT_ID"),
          client_email: splitClientEmail,
          private_key: Buffer.from(splitPrivateKeyBase64, "base64").toString("utf8"),
          token_uri: readEnv("GCS_TOKEN_URI", "https://oauth2.googleapis.com/token"),
        },
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
const basicAuthUser = String(readEnv("APP_BASIC_AUTH_USER")).trim();
const basicAuthPassword = String(readEnv("APP_BASIC_AUTH_PASSWORD"));
const bucketName = String(readEnv("GCS_BUCKET_NAME")).trim();
const projectId = String(readEnv("GCS_PROJECT_ID")).trim();
const credentialsFile = String(
  readEnv("GCS_CREDENTIALS_FILE") || readEnv("GOOGLE_APPLICATION_CREDENTIALS")
).trim();
const defaultPrefix = normalizeSingleFolder(readEnv("GCS_DEFAULT_PREFIX", "produtos"));
const urlMode = String(readEnv("GCS_URL_MODE", "public")).toLowerCase() === "signed" ? "signed" : "public";
const signedUrlDays = Math.max(parseNumber(readEnv("GCS_SIGNED_URL_DAYS", 7), 7), 1);
const maxFilesPerUpload = Math.max(parseNumber(readEnv("MAX_FILES_PER_UPLOAD", 100), 100), 1);
const maxFileSizeMb = Math.max(parseNumber(readEnv("MAX_FILE_SIZE_MB", 20), 20), 1);
const uploadConcurrency = Math.min(
  Math.max(parseNumber(readEnv("UPLOAD_CONCURRENCY") || readEnv("STORAGE_UPLOAD_CONCURRENCY"), 4), 1),
  12
);
const imageCompressionEnabled = parseBoolean(readEnv("IMAGE_COMPRESSION_ENABLED"), true);
const imageQuality = Math.min(Math.max(parseNumber(readEnv("IMAGE_QUALITY"), 82), 1), 100);
const imageMaxWidth = Math.max(parseNumber(readEnv("IMAGE_MAX_WIDTH"), 1600), 0);
const vtexAccountName = String(readEnv("VTEX_ACCOUNT_NAME") || readEnv("VTEX_ACCOUNT") || "alphabeto").trim();
const vtexApiBaseUrl = String(
  readEnv("VTEX_API_BASE_URL") ||
    (vtexAccountName ? `https://${vtexAccountName}.vtexcommercestable.com.br` : "")
)
  .trim()
  .replace(/\/+$/, "");
const vtexApiAppKey = String(readEnv("VTEX_API_APP_KEY")).trim();
const vtexApiAppToken = String(readEnv("VTEX_API_APP_TOKEN")).trim();
const vtexMaxSkus = parseOptionalPositiveInteger(readEnv("VTEX_MAX_EXPORT_SKUS"));
const vtexRequestConcurrency = Math.min(
  Math.max(parseNumber(readEnv("VTEX_REQUEST_CONCURRENCY"), 6), 1),
  20
);

const missing = [];

if (!bucketName) {
  missing.push("GCS_BUCKET_NAME");
}

const warnings = [];

if (urlMode === "public" && !parseBoolean(readEnv("GCS_MAKE_PUBLIC"), false)) {
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
  port: parseNumber(readEnv("PORT"), 3000),
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
  publicBaseUrl: String(readEnv("GCS_PUBLIC_BASE_URL")).trim().replace(/\/+$/, ""),
  urlMode,
  makePublic: parseBoolean(readEnv("GCS_MAKE_PUBLIC"), false),
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
