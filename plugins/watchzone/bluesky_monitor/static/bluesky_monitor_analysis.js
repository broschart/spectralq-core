/**
 * Bluesky Monitor Analysis Provider — Bluesky post counts on analysis chart.
 */
(function() {
"use strict";

AnalysisProviders.register("bluesky_monitor", {
  async fetchAndBuild(ctx) {
    var cacheKey = "bsm_" + ctx.zoneId + "_" + ctx.fromDate + "_" + ctx.toDate;
    if (!ctx.cache[cacheKey]) {
      ctx.showExtHint("bsm", "Bluesky Monitor", "#0085ff");
      try {
        var r = await fetch("/api/watchzones/" + ctx.zoneId + "/bluesky-history?from=" + ctx.fromDate + "&to=" + ctx.toDate);
        if (r.ok) {
          ctx.setCache(cacheKey, await r.json());
        } else {
          console.warn("[BSM] API error:", r.status);
        }
      } catch(e) { console.warn("[BSM] fetch error:", e); }
      ctx.hideExtHint("bsm");
    }

    var cached = ctx.cache[cacheKey];
    if (!cached || !cached.data || !cached.data.length) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    var labelDates = ctx.labels.map(function(l) { return new Date(l.replace(" ", "T")).getTime(); });
    var labelStep = labelDates.length >= 2 ? Math.abs(labelDates[1] - labelDates[0]) : 86400000;
    var maxDist = Math.max(labelStep, 86400000);
    var bsmAgg = new Array(ctx.labels.length).fill(null);
    cached.data.forEach(function(d) {
      var dt = new Date(d.date).getTime();
      var bestIdx = 0, bestDist = Infinity;
      for (var i = 0; i < labelDates.length; i++) {
        var dist = Math.abs(labelDates[i] - dt);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      if (bestDist <= maxDist && d.value != null) {
        bsmAgg[bestIdx] = (bsmAgg[bestIdx] || 0) + d.value;
      }
    });

    if (bsmAgg.every(function(v) { return v === null; })) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    var keywords = cached.keywords || [];

    return {
      datasets: [{
        _isBsm: true,
        label: "Bluesky (" + keywords.join(", ") + ")",
        data: bsmAgg,
        borderColor: "#0085ff",
        backgroundColor: "#0085ff30",
        borderWidth: 1.5,
        pointRadius: 2,
        pointBackgroundColor: "#0085ff",
        type: "line",
        yAxisID: "yBsm",
        fill: true,
        spanGaps: false,
      }],
      annotations: {},
      yAxes: {
        yBsm: {
          position: "right",
          min: 0,
          ticks: { color: "#0085ff", stepSize: 1 },
          grid: { drawOnChartArea: false },
          title: { display: true, text: "Bluesky Posts", color: "#0085ff", font: { size: 11 } },
        },
      },
    };
  },
});

})();
