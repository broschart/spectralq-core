/**
 * Radiation Analysis Provider — BfS ODL / EURDEP gamma dose rate on analysis chart.
 */
(function() {
"use strict";

var _radTopKenn = null;

AnalysisProviders.register("radiation", {
  async fetchAndBuild(ctx) {
    var spanDays = Math.round((new Date(ctx.toDate) - new Date(ctx.fromDate)) / 86400000);
    var radHours = spanDays > 14 ? "24h" : "1h";
    var cacheKey = "rad_" + ctx.zoneId + "_" + ctx.fromDate + "_" + ctx.toDate + "_" + radHours;
    if (!ctx.cache[cacheKey]) {
      ctx.showExtHint("rad", "Radioaktivit\u00e4t", "#eab308");
      try {
        var tsUrl = "/api/watchzones/" + ctx.zoneId + "/radiation-timeseries?hours=" + radHours;
        if (_radTopKenn) tsUrl += "&kenn=" + encodeURIComponent(_radTopKenn);
        var r = await fetch(tsUrl);
        if (r.ok) {
          var tsData = await r.json();
          ctx.setCache(cacheKey, tsData);
          if (tsData.kenn && tsData.count > 0) _radTopKenn = tsData.kenn;
        } else {
          console.warn("[RAD] fetch failed:", r.status);
        }
      } catch(e) { console.warn("[RAD] fetch error:", e); }
      ctx.hideExtHint("rad");
    }

    var cached = ctx.cache[cacheKey];
    if (!cached || !cached.series || !cached.series.length) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    // Parse labels as full timestamps (handles hourly, daily, weekly)
    var labelTs = ctx.labels.map(function(l) { return new Date(l.replace(" ", "T")).getTime(); });
    // Label step: use median of first few steps
    var steps = [];
    for (var i = 1; i < Math.min(labelTs.length, 10); i++) {
      var s = Math.abs(labelTs[i] - labelTs[i - 1]);
      if (s > 0) steps.push(s);
    }
    steps.sort(function(a, b) { return a - b; });
    var labelStep = steps.length ? steps[Math.floor(steps.length / 2)] : 86400000;
    var maxDist = Math.max(labelStep, 3600000);

    var radAgg = new Array(ctx.labels.length).fill(null);
    cached.series.forEach(function(d) {
      var dt = new Date(d.time).getTime();
      var bestIdx = 0, bestDist = Infinity;
      for (var j = 0; j < labelTs.length; j++) {
        var dist = Math.abs(labelTs[j] - dt);
        if (dist < bestDist) { bestDist = dist; bestIdx = j; }
      }
      if (bestDist <= maxDist && d.value != null) {
        radAgg[bestIdx] = radAgg[bestIdx] != null ? Math.max(radAgg[bestIdx], d.value) : d.value;
      }
    });

    if (radAgg.every(function(v) { return v === null; })) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    return {
      datasets: [{
        _isRad: true,
        label: "\u03b3 \u00b5Sv/h (" + (cached.name || "Station") + ")",
        data: radAgg,
        borderColor: "#eab308",
        backgroundColor: "#eab30830",
        borderWidth: 1.5,
        pointRadius: radAgg.map(function(v) { return v != null && v > 0.3 ? 5 : 2; }),
        pointBackgroundColor: radAgg.map(function(v) { return v != null && v > 0.3 ? "#ef4444" : "#eab308"; }),
        type: "line",
        yAxisID: "yRad",
        fill: true,
        spanGaps: true,
      }],
      annotations: {},
      yAxes: {
        yRad: {
          position: "right",
          min: 0,
          ticks: { color: "#eab308" },
          grid: { drawOnChartArea: false },
          title: { display: true, text: "\u03b3 Dosisleistung (\u00b5Sv/h)", color: "#eab308", font: { size: 11 } },
        },
      },
    };
  },
});

})();
