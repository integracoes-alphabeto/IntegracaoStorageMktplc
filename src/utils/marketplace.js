const path = require("path");

function parseImageNameConvention(fileName) {
  const sourceName = String(fileName || "").trim();
  const baseName = path.parse(sourceName).name.trim();
  const match = /^([^_]+)_(.+)$/.exec(baseName);

  if (!match) {
    return {
      sourceName,
      baseName,
      sku: "",
      position: "",
      detected: false,
    };
  }

  const sku = match[1].trim();
  const rawPosition = match[2].trim();
  const parsedPosition = Number(rawPosition);

  return {
    sourceName,
    baseName,
    sku,
    position: Number.isFinite(parsedPosition) ? parsedPosition : "",
    detected: Boolean(sku && rawPosition),
  };
}

module.exports = {
  parseImageNameConvention,
};
