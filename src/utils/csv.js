function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const stringValue = String(value);

  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function createCsv(rows, columns) {
  const headerLine = columns.map((column) => escapeCsvValue(column.label)).join(",");
  const rowLines = rows.map((row) =>
    columns.map((column) => escapeCsvValue(row[column.key])).join(",")
  );

  return `\uFEFF${[headerLine, ...rowLines].join("\n")}`;
}

module.exports = {
  createCsv,
};
