import { h, useMemo, useState } from "./react.js";
import { useConfirm } from "./confirm.js";

function valueFor(row, key) {
  if (typeof key === "function") return key(row);
  return String(key || "").split(".").reduce((acc, part) => acc?.[part], row);
}

function textValue(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(textValue).join(" ");
  if (typeof value === "object") return Object.values(value).map(textValue).join(" ");
  return String(value);
}

function download(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const raw = textValue(value).replace(/\r?\n/g, " ");
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function exportCsv(title, rows, columns) {
  const exportable = columns.filter((c) => c.export !== false);
  const header = exportable.map((c) => csvEscape(c.header)).join(",");
  const body = rows.map((row) => exportable.map((c) => csvEscape(c.exportValue ? c.exportValue(row) : valueFor(row, c.accessor))).join(","));
  download(`${title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "export"}.csv`, "text/csv;charset=utf-8", [header, ...body].join("\n"));
}

function exportPdf(title, rows, columns) {
  const exportable = columns.filter((c) => c.export !== false);
  const tableRows = rows.map((row) => `<tr>${exportable.map((c) => `<td>${escapeHtml(textValue(c.exportValue ? c.exportValue(row) : valueFor(row, c.accessor)))}</td>`).join("")}</tr>`).join("");
  const tableHead = exportable.map((c) => `<th>${escapeHtml(c.header)}</th>`).join("");
  const win = window.open("", "_blank", "width=1100,height=800");
  if (!win) {
    alert("Please allow popups to export PDF.");
    return;
  }
  win.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title><style>
    body{font-family:Arial,sans-serif;color:#172033;padding:24px}
    h1{font-size:20px;margin:0 0 16px}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th,td{border:1px solid #d8dee9;padding:8px;text-align:left;vertical-align:top}
    th{background:#f1f5f9;text-transform:uppercase;font-size:10px}
  </style></head><body><h1>${escapeHtml(title)}</h1><table><thead><tr>${tableHead}</tr></thead><tbody>${tableRows}</tbody></table><script>window.onload=()=>{window.print();}</script></body></html>`);
  win.document.close();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[ch]));
}

export function Badge({ value, tone }) {
  const normalized = String(value || "").toLowerCase().replace(/\s+/g, "_");
  return h("span", { className: `badge badge-${tone || normalized}` }, String(value || "None").replace(/_/g, " "));
}

export function Progress({ value }) {
  const n = Number(value || 0);
  return h("div", { className: "progress" },
    h("div", { className: "progress-track" },
      h("div", { className: `progress-fill ${n >= 100 ? "done" : ""}`, style: { width: `${Math.max(0, Math.min(100, n))}%` } })
    ),
    h("span", { className: "mono small muted" }, `${n}%`)
  );
}

export function EnterpriseTable({
  title,
  rows,
  columns,
  searchPlaceholder = "Search records...",
  filters = [],
  defaultPageSize = 10,
  onRowClick,
  emptyText = "No records found",
}) {
  const confirm = useConfirm();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [filterValues, setFilterValues] = useState(() => Object.fromEntries(filters.map((f) => [f.key, ""])));

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch = !q || columns.some((col) => col.search !== false && textValue(col.searchValue ? col.searchValue(row) : valueFor(row, col.accessor)).toLowerCase().includes(q));
      const matchesFilters = filters.every((filter) => {
        const selected = filterValues[filter.key];
        if (!selected) return true;
        const value = filter.value ? filter.value(row) : row[filter.key];
        return String(value) === String(selected);
      });
      return matchesSearch && matchesFilters;
    });
  }, [rows, columns, filters, query, filterValues]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * pageSize;
  const pageRows = filteredRows.slice(start, start + pageSize);

  const changeFilter = (key, value) => {
    setFilterValues((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const doExport = async (kind) => {
    const ok = await confirm({
      title: kind === "csv" ? `Export ${title} CSV` : `Export ${title} PDF`,
      message: `Export ${filteredRows.length} filtered record(s) from ${title}.`,
      confirmText: kind === "csv" ? "Export CSV" : "Export PDF",
    });
    if (!ok) return;
    if (kind === "csv") exportCsv(title, filteredRows, columns);
    else exportPdf(title, filteredRows, columns);
  };

  return h("section", { className: "panel" },
    h("div", { className: "table-toolbar" },
      h("div", { className: "table-tools-left" },
        h("div", { className: "search-wrap" },
          h("input", {
            className: "search-input",
            value: query,
            placeholder: searchPlaceholder,
            onChange: (e) => { setQuery(e.target.value); setPage(1); },
          })
        ),
        filters.map((filter) => h("select", {
          key: filter.key,
          className: "select table-filter",
          value: filterValues[filter.key] || "",
          onChange: (e) => changeFilter(filter.key, e.target.value),
          title: filter.label,
        },
          h("option", { value: "" }, filter.label),
          filter.options.map((option) => h("option", { key: option.value, value: option.value }, option.label))
        ))
      ),
      h("div", { className: "table-tools-right" },
        h("button", { className: "btn btn-outline btn-sm", onClick: () => doExport("csv") }, "CSV"),
        h("button", { className: "btn btn-outline btn-sm", onClick: () => doExport("pdf") }, "PDF")
      )
    ),
    h("div", { className: "table-scroller" },
      h("table", { className: "data-table" },
        h("thead", null, h("tr", null, columns.map((col) => h("th", { key: col.id || col.header }, col.header)))),
        h("tbody", null,
          pageRows.length === 0
            ? h("tr", null, h("td", { colSpan: columns.length }, h("div", { className: "table-empty" }, emptyText)))
            : pageRows.map((row) => h("tr", {
                key: row.id || JSON.stringify(row),
                className: onRowClick ? "interactive" : "",
                onClick: onRowClick ? () => onRowClick(row) : undefined,
              }, columns.map((col) => h("td", { key: col.id || col.header, onClick: col.stopRowClick ? (e) => e.stopPropagation() : undefined },
                col.cell ? col.cell(row) : textValue(valueFor(row, col.accessor))
              ))))
        )
      )
    ),
    h("div", { className: "pagination" },
      h("span", null, `${filteredRows.length === 0 ? 0 : start + 1}-${Math.min(start + pageSize, filteredRows.length)} of ${filteredRows.length}`),
      h("div", { className: "pager-actions" },
        h("select", { className: "page-size", value: pageSize, onChange: (e) => { setPageSize(Number(e.target.value)); setPage(1); } },
          [5, 10, 20, 50].map((n) => h("option", { key: n, value: n }, `${n} / page`))
        ),
        h("button", { className: "btn btn-outline btn-sm", disabled: currentPage <= 1, onClick: () => setPage((p) => Math.max(1, p - 1)) }, "Previous"),
        h("span", { className: "mono small" }, `${currentPage} / ${pageCount}`),
        h("button", { className: "btn btn-outline btn-sm", disabled: currentPage >= pageCount, onClick: () => setPage((p) => Math.min(pageCount, p + 1)) }, "Next")
      )
    )
  );
}
