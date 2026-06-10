import { createRequire } from "node:module";
import serverless from "serverless-http";

const require = createRequire(import.meta.url);

let cachedHandler;

function normalizeRequestUrl(request) {
  const functionPrefix = "/.netlify/functions/api";

  if (request.url === functionPrefix) {
    request.url = "/api";
    return;
  }

  if (request.url.startsWith(`${functionPrefix}/`)) {
    request.url = `/api/${request.url.slice(functionPrefix.length + 1)}`;
  }
}

function getHandler() {
  if (!cachedHandler) {
    const { createApp } = require("../../src/server.js");
    const app = createApp();

    cachedHandler = serverless(app, {
      request: normalizeRequestUrl,
    });
  }

  return cachedHandler;
}

export const handler = async (event, context) => getHandler()(event, context);
