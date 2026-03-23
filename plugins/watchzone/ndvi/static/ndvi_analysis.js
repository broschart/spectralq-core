/**
 * NDVI Analysis Provider — Sentinel-2 Vegetation Index on analysis chart.
 */
(function() {
"use strict";

AnalysisProviders.register("ndvi", {
  async fetchAndBuild(ctx) {
    var cacheKey = "ndvi_" + ctx.zoneId + "_" + ctx.fromDate + "_" + ctx.toDate;
    if (!ctx.cache[cacheKey]) {
      ctx.showExtHint("ndvi", "Sentinel-2 NDVI", "#16a34a");
      try {
        var r = await fetch("/api/watchzones/" + ctx.zoneId + "/ndvi-history?from=" + ctx.fromDate + "&to=" + ctx.toDate + "&interval=P7D");
        if (r.ok) {
          ctx.setCache(cacheKey, await r.json());
        } else {
          var err = "";
          try { err = (await r.json()).error || ""; } catch(_) { err = "HTTP " + r.status; }
          ctx.toast(ctx.t("an_ndvi_error", "NDVI-Fehler: ") + err, "error");
        }
      } catch(e) { console.warn("[NDVI] fetch error:", e); }
      ctx.hideExtHint("ndvi");
    }

    var cached = ctx.cache[cacheKey];
    var ndviData = cached && cached.data ? cached.data : [];
    if (!ndviData.length) {
      if (cached) ctx.toast(ctx.t("an_ndvi_no_data", "Keine NDVI-Daten im Zeitraum (Copernicus)"), "info");
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    var dateMap = {};
    ndviData.forEach(function(p) { if (p.mean_ndvi != null) dateMap[p.date] = p.mean_ndvi; });
    var values = ctx.labels.map(function(d) { return dateMap[d] != null ? dateMap[d] : (dateMap[d.slice(0,10)] != null ? dateMap[d.slice(0,10)] : null); });
    if (values.every(function(v) { return v === null; })) return { datasets: [], annotations: {}, yAxes: {} };

    var zoneName = cached.zone_name || "Zone";
    var datasets = [{
      _isNdvi: true,
      label: "NDVI (" + zoneName + ")",
      data: values,
      borderColor: "#16a34a",
      backgroundColor: "#16a34a22",
      borderWidth: 2,
      tension: 0.3,
      pointRadius: 0,
      pointHoverRadius: 4,
      fill: true,
      spanGaps: true,
      yAxisID: "yNdvi",
    }];

    // Anomaly detection
    var annotations = {};
    var mean = 0, cnt = 0;
    values.forEach(function(v) { if (v !== null) { mean += v; cnt++; } });
    if (cnt > 0) mean /= cnt;
    var stddev = 0;
    values.forEach(function(v) { if (v !== null) stddev += (v - mean) * (v - mean); });
    stddev = cnt > 1 ? Math.sqrt(stddev / (cnt - 1)) : 0;
    var threshold = mean - 2 * stddev;
    var anomalyData = new Array(values.length).fill(null);
    var hasAnomaly = false;
    values.forEach(function(v, i) {
      if (v !== null && v < threshold) {
        anomalyData[i] = v;
        hasAnomaly = true;
        annotations["ndvi_anom_" + i] = {
          type: "point",
          xValue: ctx.labels[i],
          yValue: v,
          yScaleID: "yNdvi",
          backgroundColor: "rgba(239,68,68,.3)",
          borderColor: "#ef4444",
          radius: 6,
        };
      }
    });
    if (hasAnomaly) {
      datasets.push({
        _isNdvi: true, _isNdviAnomaly: true,
        label: "NDVI-Anomalien",
        data: anomalyData,
        borderColor: "#ef4444",
        backgroundColor: "#ef444466",
        borderWidth: 0,
        pointRadius: anomalyData.map(function(v) { return v !== null ? 6 : 0; }),
        pointBackgroundColor: "#ef4444",
        pointBorderColor: "#fff",
        pointBorderWidth: 1,
        fill: false,
        yAxisID: "yNdvi",
      });
    }

    return {
      datasets: datasets,
      annotations: annotations,
      yAxes: {
        yNdvi: {
          position: "right",
          min: -0.2,
          max: 1.0,
          ticks: { color: "#16a34a" },
          grid: { drawOnChartArea: false },
          title: { display: true, text: "NDVI", color: "#16a34a", font: { size: 11 } },
        },
      },
    };
  },
});

})();
