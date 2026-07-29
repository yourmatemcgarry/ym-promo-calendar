/**
 * charts.js — tiny dependency-free SVG line chart renderer.
 * Not a general charting library — just enough for period-over-period
 * trend lines (COGS $, GP %, etc.) used on the Trends page.
 */
const Charts = (function () {
  "use strict";

  function fmtNum(n, decimals) {
    if (n == null || Number.isNaN(n)) return "-";
    return n.toFixed(decimals != null ? decimals : 2);
  }

  /**
   * series: [{ name, color, points: [{x: label, y: number|null}] }]
   * opts: { width, height, yLabel, yIsPct }
   */
  function lineChart(series, opts) {
    opts = opts || {};
    const width = opts.width || 640;
    const height = opts.height || 260;
    const padL = 56, padR = 20, padT = 20, padB = 36;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const labels = (series[0] && series[0].points.map((p) => p.x)) || [];
    const allY = series.flatMap((s) => s.points.map((p) => p.y)).filter((y) => y != null);
    let minY = Math.min(...allY, 0);
    let maxY = Math.max(...allY, 1);
    if (opts.yIsPct) {
      minY = Math.min(minY, 0);
    }
    if (minY === maxY) {
      minY -= 1;
      maxY += 1;
    }
    const pad = (maxY - minY) * 0.1;
    minY -= pad;
    maxY += pad;

    const xStep = labels.length > 1 ? plotW / (labels.length - 1) : 0;
    const xOf = (i) => padL + i * xStep;
    const yOf = (v) => padT + plotH - ((v - minY) / (maxY - minY)) * plotH;

    let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" class="chart-svg">`;

    // gridlines + y axis labels
    const gridCount = 4;
    for (let g = 0; g <= gridCount; g++) {
      const v = minY + ((maxY - minY) * g) / gridCount;
      const y = yOf(v);
      svg += `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" class="chart-grid" />`;
      const label = opts.yIsPct ? (v * 100).toFixed(0) + "%" : fmtNum(v, 1);
      svg += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" class="chart-axis-label">${label}</text>`;
    }

    // x axis labels
    labels.forEach((label, i) => {
      svg += `<text x="${xOf(i)}" y="${height - padB + 18}" text-anchor="middle" class="chart-axis-label">${label}</text>`;
    });

    // lines
    series.forEach((s) => {
      const pts = s.points.map((p, i) => (p.y == null ? null : `${xOf(i)},${yOf(p.y)}`)).filter(Boolean);
      if (pts.length > 0) {
        svg += `<polyline points="${pts.join(" ")}" fill="none" stroke="${s.color}" stroke-width="2.5" />`;
        s.points.forEach((p, i) => {
          if (p.y == null) return;
          svg += `<circle cx="${xOf(i)}" cy="${yOf(p.y)}" r="3.5" fill="${s.color}" />`;
        });
      }
    });

    svg += `</svg>`;

    // legend
    let legend = `<div class="chart-legend">`;
    series.forEach((s) => {
      legend += `<span class="chart-legend-item"><span class="chart-swatch" style="background:${s.color}"></span>${s.name}</span>`;
    });
    legend += `</div>`;

    return `<div class="chart-wrap">${svg}${legend}</div>`;
  }

  return { lineChart };
})();
