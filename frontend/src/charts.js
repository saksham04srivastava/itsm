import { h, useRef, useState } from "./react.js";

export function ChartDot({ color }) {
  return h("span", { className: "chart-dot", style: { background: color } });
}

export function ChartEmpty({ text = "No data for this range" }) {
  return h("div", { className: "chart-empty" }, text);
}

// Horizontal bar chart: one row per category, direct value + share labels,
// click-to-drill (calls onSelect with the row key), hover tooltip.
export function BarChartCard({ data, onSelect, selectedKey }) {
  const [hoverKey, setHoverKey] = useState(null);
  if (!data.length) return h(ChartEmpty);
  const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
  const max = Math.max(1, ...data.map((d) => d.value));
  return h("div", { className: "bar-chart" },
    data.map((d) => {
      const pct = (d.value / max) * 100;
      const share = ((d.value / total) * 100).toFixed(0);
      const isSelected = selectedKey === d.key;
      const isHovered = hoverKey === d.key;
      const clickable = Boolean(onSelect) && !d.disabled;
      return h("div", {
        key: d.key,
        className: `bar-row ${isSelected ? "selected" : ""} ${clickable ? "clickable" : ""}`,
        onMouseEnter: () => setHoverKey(d.key),
        onMouseLeave: () => setHoverKey((k) => (k === d.key ? null : k)),
        onClick: clickable ? () => onSelect(d.key) : undefined,
        role: clickable ? "button" : undefined,
        tabIndex: clickable ? 0 : undefined,
        "aria-pressed": clickable ? isSelected : undefined,
        onKeyDown: clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(d.key); } } : undefined,
      },
        h("span", { className: "bar-row-label" }, h(ChartDot, { color: d.color }), h("span", { className: "truncate" }, d.label)),
        h("div", { className: "bar-track" },
          h("div", { className: `bar-fill ${isHovered || isSelected ? "lift" : ""}`, style: { width: `${pct}%`, background: d.color } })
        ),
        h("span", { className: "bar-value mono" }, `${d.value} · ${share}%`),
        isHovered && clickable && h("div", { className: "chart-tooltip" }, isSelected ? "Click to clear filter" : `Filter recent tickets by ${d.label}`)
      );
    })
  );
}

function niceStep(roughStep) {
  const exponent = Math.floor(Math.log10(roughStep || 1));
  const fraction = roughStep / 10 ** exponent;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * 10 ** exponent;
}

function niceTicks(max, count = 4) {
  const top = Math.max(1, max);
  const step = niceStep(top / count) || 1;
  const niceMax = Math.ceil(top / step) * step;
  const ticks = [];
  for (let v = 0; v <= niceMax + 1e-9; v += step) ticks.push(Math.round(v));
  return ticks;
}

// Catmull-Rom to cubic-Bezier smoothing so the line reads as a curve, not a spike.
function smoothPath(points) {
  if (points.length < 3) return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

// Line + area trend chart with a labeled value axis and a pointer-tracked crosshair tooltip.
export function TrendChart({ data, height = 220 }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const svgRef = useRef(null);
  if (!data.length) return h(ChartEmpty, { text: "No tickets created in this range" });

  const width = 640;
  const padding = { top: 16, right: 14, bottom: 28, left: 30 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const rawMax = Math.max(0, ...data.map((d) => d.value));
  const ticks = niceTicks(rawMax, 4);
  const niceMax = ticks[ticks.length - 1] || 1;
  const stepX = data.length > 1 ? innerW / (data.length - 1) : 0;
  const points = data.map((d, i) => ({
    ...d,
    x: padding.left + (data.length > 1 ? stepX * i : innerW / 2),
    y: padding.top + innerH - (d.value / niceMax) * innerH,
  }));
  const linePath = smoothPath(points);
  const baseY = (padding.top + innerH).toFixed(1);
  const areaPath = points.length
    ? `${linePath} L${points[points.length - 1].x.toFixed(1)},${baseY} L${points[0].x.toFixed(1)},${baseY} Z`
    : "";

  const handleMove = (e) => {
    const rect = svgRef.current.getBoundingClientRect();
    if (!rect.width) return;
    const relX = ((e.clientX - rect.left) / rect.width) * width;
    let nearest = 0;
    let best = Infinity;
    points.forEach((p, i) => {
      const dist = Math.abs(p.x - relX);
      if (dist < best) { best = dist; nearest = i; }
    });
    setHoverIndex(nearest);
  };

  const labelStep = Math.max(1, Math.ceil(points.length / 8));
  const hovered = hoverIndex != null ? points[hoverIndex] : null;

  return h("div", { className: "trend-chart" },
    h("svg", {
      ref: svgRef,
      viewBox: `0 0 ${width} ${height}`,
      preserveAspectRatio: "none",
      className: "trend-svg",
      onMouseMove: handleMove,
      onMouseLeave: () => setHoverIndex(null),
    },
      ticks.map((t) => {
        const y = padding.top + innerH - (t / niceMax) * innerH;
        return h("g", { key: t },
          h("line", { x1: padding.left, y1: y, x2: width - padding.right, y2: y, className: t === 0 ? "trend-baseline" : "trend-gridline" }),
          h("text", { x: padding.left - 8, y: y + 3, textAnchor: "end", className: "trend-axis-label mono" }, t)
        );
      }),
      areaPath && h("path", { d: areaPath, className: "trend-area" }),
      h("path", { d: linePath, className: "trend-line" }),
      hovered && h("line", { x1: hovered.x, y1: padding.top, x2: hovered.x, y2: padding.top + innerH, className: "trend-crosshair" }),
      hovered && h("circle", { cx: hovered.x, cy: hovered.y, r: 4, className: "trend-dot" }),
      points.map((p, i) => (i % labelStep === 0 || i === points.length - 1) && h("text", {
        key: p.key,
        x: p.x,
        y: height - 8,
        textAnchor: i === points.length - 1 ? "end" : i === 0 ? "start" : "middle",
        className: "trend-axis-label",
      }, p.label))
    ),
    hovered && h("div", {
      className: "trend-tooltip",
      style: { left: `${Math.min(92, Math.max(8, (hovered.x / width) * 100))}%` },
    },
      h("strong", null, hovered.value), ` ticket${hovered.value === 1 ? "" : "s"}`,
      h("div", { className: "small muted" }, hovered.label)
    )
  );
}
