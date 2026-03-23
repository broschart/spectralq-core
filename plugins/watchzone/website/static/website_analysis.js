/**
 * Website Analysis Provider — Wayback Machine website changes on analysis chart.
 */
(function() {
"use strict";

AnalysisProviders.register("website", {
  async fetchAndBuild(ctx) {
    var cacheKey = "web_" + ctx.zoneId + "_" + ctx.fromDate + "_" + ctx.toDate;
    if (!ctx.cache[cacheKey]) {
      ctx.showExtHint("web", "Website (Wayback)", "#06b6d4");
      try {
        var r = await fetch("/api/watchzones/" + ctx.zoneId + "/website-history?from=" + ctx.fromDate + "&to=" + ctx.toDate);
        if (r.ok) {
          ctx.setCache(cacheKey, await r.json());
        } else {
          console.warn("[Website] API error:", r.status);
        }
      } catch(e) { console.warn("[Website] fetch error:", e); }
      ctx.hideExtHint("web");
    }

    var cached = ctx.cache[cacheKey];
    if (!cached || !cached.data || !cached.data.length) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    var labelDates = ctx.labels.map(function(l) { return new Date(l.slice(0, 10)).getTime(); });
    // Dynamic threshold: half the gap between adjacent labels
    var maxAllowedDist = Infinity;
    var webGranLabel = "Website-\u00c4nderungen";
    if (labelDates.length >= 2) {
      var minGap = Infinity;
      for (var i = 1; i < labelDates.length; i++) {
        var gap = labelDates[i] - labelDates[i - 1];
        if (gap > 0 && gap < minGap) minGap = gap;
      }
      if (isFinite(minGap)) {
        maxAllowedDist = minGap * 0.6;
        var days = minGap / 86400000;
        if (days <= 1.5)       webGranLabel = "Website-\u00c4nderungen pro Tag";
        else if (days <= 8)    webGranLabel = "Website-\u00c4nderungen pro Woche";
        else if (days <= 16)   webGranLabel = "Website-\u00c4nderungen pro 2 Wochen";
        else if (days <= 40)   webGranLabel = "Website-\u00c4nderungen pro Monat";
        else if (days <= 100)  webGranLabel = "Website-\u00c4nderungen pro Quartal";
        else                   webGranLabel = "Website-\u00c4nderungen pro Jahr";
      }
    }

    // Detect mode from DOM toggle if present
    var isSizeMode = false;
    if (typeof window._webMode !== "undefined") {
      isSizeMode = window._webMode === "size";
    }

    var webAgg = new Array(ctx.labels.length).fill(null);
    var webCnt = new Array(ctx.labels.length).fill(0);
    cached.data.forEach(function(d) {
      var dt = new Date(d.date).getTime();
      var bestIdx = 0, bestDist = Infinity;
      for (var j = 0; j < labelDates.length; j++) {
        var dist = Math.abs(labelDates[j] - dt);
        if (dist < bestDist) { bestDist = dist; bestIdx = j; }
      }
      if (bestDist <= maxAllowedDist) {
        if (isSizeMode) {
          var kb = d.length ? d.length / 1024 : null;
          if (kb !== null) {
            webAgg[bestIdx] = (webAgg[bestIdx] || 0) + kb;
            webCnt[bestIdx]++;
          }
        } else {
          webAgg[bestIdx] = (webAgg[bestIdx] || 0) + (d.value || 1);
        }
      }
    });
    // KB mode: average per bucket
    if (isSizeMode) {
      for (var k = 0; k < webAgg.length; k++) {
        if (webCnt[k] > 0) webAgg[k] = Math.round(webAgg[k] / webCnt[k]);
      }
    }

    if (webAgg.every(function(v) { return v === null; })) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    var zoneName = cached.zone_name || cached.url || "Zone";
    var webColor = isSizeMode ? "#8b5cf6" : "#06b6d4";
    var webLabel = isSizeMode
      ? "Seitengr\u00f6\u00dfe KB (" + zoneName + ")"
      : "Website-\u00c4nderungen (" + zoneName + ")";
    var webGranFinal = isSizeMode
      ? webGranLabel.replace("Website-\u00c4nderungen", "Seitengr\u00f6\u00dfe KB")
      : webGranLabel;

    return {
      datasets: [{
        _isWeb: true,
        _webGranLabel: webGranFinal,
        _webIsSizeMode: isSizeMode,
        label: webLabel,
        data: webAgg,
        backgroundColor: webColor + "60",
        borderColor: webColor,
        borderWidth: isSizeMode ? 2 : 1,
        borderRadius: 3,
        type: isSizeMode ? "line" : "bar",
        tension: 0.3,
        pointRadius: isSizeMode ? 3 : 0,
        fill: isSizeMode,
        yAxisID: "yWeb",
      }],
      annotations: {},
      yAxes: (function() {
        var wCol = isSizeMode ? "#8b5cf6" : "#06b6d4";
        var ticks = { color: wCol };
        if (isSizeMode) ticks.callback = function(v) { return v + " KB"; };
        else ticks.stepSize = 1;
        return {
          yWeb: {
            position: "right",
            min: 0,
            ticks: ticks,
            grid: { drawOnChartArea: false },
            title: { display: true, text: webGranFinal, color: wCol, font: { size: 11 } },
          },
        };
      })(),
    };
  },
});

})();
