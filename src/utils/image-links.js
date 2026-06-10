function getSortablePosition(record, fallback) {
  const candidates = [record.sortPosition, record.position, record.Position];

  for (const candidate of candidates) {
    const parsed = Number(candidate);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function buildImageLinkExport(files) {
  const groups = new Map();

  files.forEach((file, index) => {
    const url = String(file.url || file.image_url || file.imageUrl || "").trim();

    if (!url) {
      return;
    }

    const sku = String(file.sku || file.SkuId || "").trim();
    const groupKey = sku || `__missing_sku_${index}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        sku,
        items: [],
        firstIndex: index,
      });
    }

    groups.get(groupKey).items.push({
      url,
      position: getSortablePosition(file, index),
      index,
    });
  });

  const groupedRows = [...groups.values()]
    .sort((left, right) => {
      if (left.sku && right.sku) {
        return left.sku.localeCompare(right.sku, "pt-BR", { numeric: true });
      }

      return left.firstIndex - right.firstIndex;
    })
    .map((group) => {
      const links = group.items
        .sort((left, right) => left.position - right.position || left.index - right.index)
        .map((item) => item.url);

      const row = {
        sku: group.sku,
        links,
      };

      links.forEach((link, index) => {
        row[`link${index + 1}`] = link;
      });

      return row;
    });

  const maxLinks = Math.max(1, ...groupedRows.map((row) => row.links.length));

  return {
    rows: groupedRows,
    maxLinks,
  };
}

function buildImageLinkColumns(maxLinks) {
  const safeMaxLinks = Math.max(1, Number(maxLinks) || 1);
  const columns = [{ key: "sku", label: "sku" }];

  for (let index = 1; index <= safeMaxLinks; index += 1) {
    columns.push({
      key: `link${index}`,
      label: `link ${index}`,
    });
  }

  return columns;
}

module.exports = {
  buildImageLinkColumns,
  buildImageLinkExport,
};
