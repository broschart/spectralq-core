/**
 * WZ Module: Wayback CDX Archiving Frequency renderer.
 */
(function() {
"use strict";
var WZ = window.WZ;
var t = window._t || function(k, fb) { return fb; };

var _wbfChart = null;

function _renderWaybackCDXLive(data) {
  var ctx = WZ._currentCtx;
  var daily = data.daily || [];
  var total = data.count || 0;

  ctx.countEl.textContent =
    total + " " + t("wz_wbf_snapshots", "Snapshots") +
    " \u00b7 " + (data.days_with_data || 0) + " " + t("wz_wbf_days", "days");

  if (WZ._liveMarkers) WZ._liveMarkers.clearLayers();

  var content = ctx.contentEl;

  if (data.error) {
    content.innerHTML = '<div style="padding:24px;text-align:center;color:#ef4444;">' + _esc(data.error) + '</div>';
    return;
  }

  var dateFrom = data.date_from || "";
  var dateTo = data.date_to || "";

  var html = '<div style="padding:12px 0;overflow-y:auto;">';

  // Date range picker + URL
  html += '<div style="margin-bottom:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">';
  html += '<div style="flex:1;min-width:200px;padding:6px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;">';
  html += '<span style="font-size:11px;color:var(--muted);">URL:</span> ';
  html += '<span style="font-size:12px;font-family:monospace;color:var(--text);word-break:break-all;">' + _esc(data.url || "?") + '</span>';
  html += '</div>';
  html += '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">';
  html += '<span style="font-size:11px;color:var(--muted);">' + _fmtD(dateFrom) + '</span>';
  html += '<input type="date" id="wbf-date-from" value="' + _esc(dateFrom) + '" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);width:28px;opacity:.6;" title="' + _fmtD(dateFrom) + '">';
  html += '<span style="color:var(--muted);font-size:11px;">\u2013</span>';
  html += '<input type="date" id="wbf-date-to" value="' + _esc(dateTo) + '" style="font-size:11px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);width:28px;opacity:.6;" title="' + _fmtD(dateTo) + '">';
  html += '<span style="font-size:11px;color:var(--muted);">' + _fmtD(dateTo) + '</span>';
  html += '<button id="wbf-reload-btn" onclick="wbfReloadRange()" style="font-size:11px;font-weight:600;padding:4px 10px;border:1px solid var(--accent3);border-radius:6px;background:var(--accent3);color:#fff;cursor:pointer;white-space:nowrap;">' + t("wz_wbf_apply","Apply") + '</button>';
  html += '</div></div>';

  // Stats row
  html += '<div style="margin-bottom:10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 14px;">';
  html += '<div style="display:flex;gap:20px;flex-wrap:wrap;align-items:center;">';
  html += '<div style="text-align:center;">' +
    '<div style="font-size:22px;font-weight:800;color:#06b6d4;">' + total.toLocaleString() + '</div>' +
    '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_wbf_total","Total") + '</div></div>';
  html += '<div style="text-align:center;">' +
    '<div style="font-size:16px;font-weight:700;color:var(--text);">' + (data.daily_avg || 0) + '</div>' +
    '<div style="font-size:10px;color:var(--muted);text-transform:uppercase;">' + t("wz_wbf_daily_avg","\u2300/day") + '</div></div>';
  if (data.peak > 0) {
    html += '<div style="text-align:center;">' +
      '<div style="font-size:16px;font-weight:700;color:#ef4444;">' + data.peak + '</div>' +
      '<div style="font-size:10px;color:var(--muted);">' + t("wz_wbf_peak","Peak") + ' ' + _fmtD(data.peak_date) + '</div></div>';
  }
  if (data.first_date) {
    html += '<div style="text-align:center;">' +
      '<div style="font-size:13px;font-weight:600;color:var(--muted);">' + _fmtD(data.first_date) + '</div>' +
      '<div style="font-size:10px;color:var(--muted);">' + t("wz_wbf_first","First") + '</div></div>';
  }
  if (data.last_date) {
    html += '<div style="text-align:center;">' +
      '<div style="font-size:13px;font-weight:600;color:var(--muted);">' + _fmtD(data.last_date) + '</div>' +
      '<div style="font-size:10px;color:var(--muted);">' + t("wz_wbf_last","Last") + '</div></div>';
  }
  if (data.domain_total_pages != null) {
    html += '<div style="text-align:center;">' +
      '<div style="font-size:16px;font-weight:700;color:#8b5cf6;">' + data.domain_total_pages.toLocaleString() + '</div>' +
      '<div style="font-size:10px;color:var(--muted);">' + t("wz_wbf_domain_pages","Domain-Seiten (gesamt)") + '</div></div>';
  }
  html += '</div></div>';

  // Chart
  if (daily.length > 2) {
    html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 14px;">';
    html += '<div style="font-size:12px;font-weight:600;margin-bottom:6px;">' + t("wz_wbf_header","Archiving frequency") + '</div>';
    html += '<div style="position:relative;height:160px;"><canvas id="wbf-chart"></canvas></div>';
    html += '</div>';
  }

  if (!daily.length) {
    html += '<div style="padding:16px;text-align:center;color:var(--muted);font-size:12px;">' +
      t("wz_wbf_empty","No Wayback snapshots for this URL.") + '</div>';
  }

  // Site tree
  if (data.site_tree) {
    var st = data.site_tree;
    html += '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-top:10px;">';
    html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">';
    html += '<span style="font-size:12px;font-weight:600;">' + t("wz_wbf_site_tree","Website-Struktur") + '</span>';
    html += '<span style="font-size:11px;color:var(--muted);">' + (st.total_urls || 0) + ' URLs</span>';
    html += '</div>';
    // Mime type breakdown (clickable filter)
    if (st.mime_counts) {
      html += '<div id="wbf-mime-filter" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">';
      var mc = st.mime_counts;
      Object.keys(mc).forEach(function(m) {
        var col = m === "HTML" ? "#06b6d4" : m === "Bilder" ? "#22c55e" : m === "JS" ? "#f59e0b" : m === "CSS" ? "#8b5cf6" : m === "PDF" ? "#ef4444" : m === "Daten" ? "#f97316" : "#888";
        html += '<button class="wbf-mime-btn" data-mime="' + _esc(m) + '" style="font-size:10px;padding:2px 10px;border-radius:10px;border:1px solid ' + col + ';background:' + col + '20;color:' + col + ';cursor:pointer;font-weight:600;" title="Filter: ' + _esc(m) + '">' + _esc(m) + ': ' + mc[m] + '</button>';
      });
      html += '<button class="wbf-mime-btn" data-mime="all" style="font-size:10px;padding:2px 10px;border-radius:10px;border:1px solid var(--border);background:none;color:var(--muted);cursor:pointer;">Alle</button>';
      html += '</div>';
    }
    // Render tree
    html += '<div id="wbf-tree" style="font-size:11px;font-family:monospace;max-height:300px;overflow-y:auto;"></div>';
    html += '</div>';
  }

  html += '</div>';
  content.innerHTML = html;

  // Render chart
  _renderChart(daily, total);

  // Render site tree (interactive with MIME filter)
  if (data.site_tree && data.site_tree.tree) {
    var treeEl = document.getElementById("wbf-tree");
    var _wbfMimeFilter = "all";
    var _MIME_COLORS = { HTML: "#06b6d4", Bilder: "#22c55e", JS: "#f59e0b", CSS: "#8b5cf6", PDF: "#ef4444", Daten: "#f97316", Sonstige: "#888" };

    function _wbfRenderTree() {
      if (!treeEl) return;
      treeEl.innerHTML = "";

      // Build domain base URL for links
      var _wbfDomain = data.url || "";
      if (_wbfDomain && _wbfDomain.indexOf("://") === -1) _wbfDomain = "https://" + _wbfDomain;
      _wbfDomain = _wbfDomain.replace(/\/+$/, "");

      function _buildNode(nodeData, name, depth, parentPath) {
        var children = nodeData.children || {};
        var mime = nodeData.mime;
        var childKeys = Object.keys(children).sort();
        var isLeaf = childKeys.length === 0;
        var fullPath = parentPath + "/" + name;

        // Filter: skip if leaf doesn't match mime filter
        if (_wbfMimeFilter !== "all") {
          if (isLeaf && mime && mime !== _wbfMimeFilter) return null;
          if (!isLeaf) {
            var hasMatch = false;
            function _checkMatch(n) {
              var ck = Object.keys(n.children || {});
              if (ck.length === 0 && n.mime === _wbfMimeFilter) { hasMatch = true; return; }
              ck.forEach(function(k) { if (!hasMatch) _checkMatch(n.children[k]); });
            }
            _checkMatch(nodeData);
            if (!hasMatch) return null;
          }
        }

        var div = document.createElement("div");
        div.style.paddingLeft = (depth * 16) + "px";
        var row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:4px;padding:2px 0;cursor:" + (isLeaf ? "default" : "pointer") + ";color:var(--text);";
        var mimeCol = mime ? (_MIME_COLORS[mime] || "#888") : "#06b6d4";
        var mimeBadge = mime ? '<span style="font-size:8px;padding:0 4px;border-radius:3px;background:' + mimeCol + '20;color:' + mimeCol + ';margin-left:4px;">' + _esc(mime) + '</span>' : '';
        // Wayback link for leaf nodes
        var nameHtml;
        if (isLeaf && mime && nodeData.url) {
          var wbUrl = "https://web.archive.org/web/*/" + nodeData.url;
          nameHtml = '<a href="' + _esc(wbUrl) + '" target="_blank" rel="noopener" style="color:var(--text);text-decoration:none;" title="' + _esc(nodeData.url) + '">' + _esc(name) + '</a>';
        } else {
          nameHtml = '<span>' + _esc(name) + '</span>';
        }
        row.innerHTML = (isLeaf
          ? '<span style="color:' + mimeCol + ';width:12px;text-align:center;">\u2022</span>'
          : '<span style="color:#06b6d4;width:12px;text-align:center;font-size:8px;">\u25b6</span>')
          + nameHtml
          + mimeBadge
          + (childKeys.length ? '<span style="color:var(--muted);font-size:9px;margin-left:4px;">(' + childKeys.length + ')</span>' : '');
        div.appendChild(row);
        if (!isLeaf) {
          var childDiv = document.createElement("div");
          childDiv.style.display = "none";
          childKeys.forEach(function(k) {
            var childNode = _buildNode(children[k], k, depth + 1, fullPath);
            if (childNode) childDiv.appendChild(childNode);
          });
          if (childDiv.children.length) {
            div.appendChild(childDiv);
            row.addEventListener("click", function() {
              var open = childDiv.style.display !== "none";
              childDiv.style.display = open ? "none" : "block";
              row.querySelector("span").textContent = open ? "\u25b6" : "\u25bc";
            });
          }
        }
        return div;
      }

      var rootKeys = Object.keys(data.site_tree.tree).sort();
      var rootDiv = document.createElement("div");
      rootDiv.style.cssText = "font-weight:700;color:#06b6d4;margin-bottom:4px;";
      rootDiv.textContent = "\ud83c\udf10 / (" + rootKeys.length + " Verzeichnisse)" + (_wbfMimeFilter !== "all" ? " \u2014 Filter: " + _wbfMimeFilter : "");
      treeEl.appendChild(rootDiv);
      rootKeys.forEach(function(k) {
        var node = _buildNode(data.site_tree.tree[k], k, 1, "");
        if (node) treeEl.appendChild(node);
      });
    }

    _wbfRenderTree();

    // MIME filter click handlers
    document.querySelectorAll(".wbf-mime-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var mime = btn.getAttribute("data-mime");
        _wbfMimeFilter = mime;
        // Highlight active
        document.querySelectorAll(".wbf-mime-btn").forEach(function(b) {
          b.style.fontWeight = b.getAttribute("data-mime") === mime ? "800" : "600";
          b.style.opacity = b.getAttribute("data-mime") === mime ? "1" : "0.5";
        });
        _wbfRenderTree();
      });
    });
  }
}

function _renderChart(daily, total) {
  if (!window.Chart || daily.length < 3) return;
  var canvas = document.getElementById("wbf-chart");
  if (!canvas) return;

  if (_wbfChart) { _wbfChart.destroy(); _wbfChart = null; }

  // Fill gaps — include days with zero snapshots
  var dateMap = {};
  daily.forEach(function(d) { dateMap[d.date] = d.count; });
  var sortedDates = daily.map(function(d) { return d.date; }).sort();
  var labels = [], values = [];
  if (sortedDates.length >= 2) {
    var cur = new Date(sortedDates[0] + "T12:00:00");
    var end = new Date(sortedDates[sortedDates.length - 1] + "T12:00:00");
    while (cur <= end) {
      var ds = cur.toISOString().slice(0, 10);
      labels.push(ds);
      values.push(dateMap[ds] || 0);
      cur.setDate(cur.getDate() + 1);
    }
  } else {
    labels = sortedDates;
    values = daily.map(function(d) { return d.count; });
  }
  var avg = total / Math.max(labels.length, 1);
  var avgLine = values.map(function() { return Math.round(avg * 10) / 10; });

  _wbfChart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: t("wz_wbf_snapshots","Snapshots") + "/Tag",
          data: values,
          backgroundColor: values.map(function(v) { return v > avg * 3 ? "#ef444480" : "#06b6d460"; }),
          borderColor: values.map(function(v) { return v > avg * 3 ? "#ef4444" : "#06b6d4"; }),
          borderWidth: 1,
        },
        {
          label: t("wz_wbf_daily_avg","\u2300/day"),
          data: avgLine,
          type: "line",
          borderColor: "#64748b",
          borderWidth: 1,
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true, labels: { font: { size: 10 }, boxWidth: 10 } } },
      scales: {
        x: { ticks: { maxTicksLimit: 12, font: { size: 9 }, color: "#888", callback: function(v, i) { return window.fmtDateOnly ? window.fmtDateOnly(labels[i] + "T00:00") : labels[i]; } }, grid: { display: false } },
        y: { min: 0, ticks: { font: { size: 9 }, color: "#888", stepSize: 1 }, grid: { color: "rgba(100,100,100,.1)" } },
      },
      interaction: { intersect: false, mode: "index" },
    },
  });
}

// Reload with new date range
window.wbfReloadRange = async function() {
  var fromEl = document.getElementById("wbf-date-from");
  var toEl = document.getElementById("wbf-date-to");
  if (!fromEl || !toEl) return;
  var dateFrom = fromEl.value;
  var dateTo = toEl.value;
  if (!dateFrom || !dateTo) return;

  var zoneId = WZ._liveZoneId;
  if (!zoneId) return;

  var btn = document.getElementById("wbf-reload-btn");
  if (btn) { btn.disabled = true; btn.textContent = "\u2026"; }

  try {
    var asType = WZ._liveAsType ? "&as_type=" + WZ._liveAsType : "";
    var url = "/api/watchzones/" + zoneId + "/live?from=" + encodeURIComponent(dateFrom) + "&to=" + encodeURIComponent(dateTo) + asType;
    var r = await fetch(url);
    var data = await r.json();
    if (r.ok) _renderWaybackCDXLive(data);
    else alert(data.error || "Error");
  } catch(e) {
    alert(e.message || "Error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t("wz_wbf_apply","Apply"); }
  }
};

function _fmtD(s) {
  if (!s) return "";
  if (window.fmtDateOnly) return window.fmtDateOnly(String(s).replace(" ", "T"));
  return String(s).slice(0, 10);
}

function _esc(s) {
  if (!s) return "";
  var d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

WZ.registerPlugin("wayback_cdx", {
  renderer: _renderWaybackCDXLive,
  has_map: false,
  has_live_map: false,
  live_box_max_width: "800px",
  live_box_height: "auto",
  default_source: "wayback",
});

})();
