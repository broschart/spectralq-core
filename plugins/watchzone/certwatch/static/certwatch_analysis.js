/**
 * Certwatch Analysis Provider — Certificate Transparency log counts on analysis chart.
 */
(function() {
"use strict";

AnalysisProviders.register("certwatch", {
  async fetchAndBuild(ctx) {
    var cacheKey = "cw_" + ctx.zoneId + "_" + ctx.fromDate + "_" + ctx.toDate;
    if (!ctx.cache[cacheKey]) {
      ctx.showExtHint("cw", "Certwatch (CT)", "#14b8a6");
      try {
        var r = await fetch("/api/watchzones/" + ctx.zoneId + "/ct-history?from=" + ctx.fromDate + "&to=" + ctx.toDate);
        if (r.ok) {
          ctx.setCache(cacheKey, await r.json());
        } else {
          console.warn("[CW] API error:", r.status);
        }
      } catch(e) { console.warn("[CW] fetch error:", e); }
      ctx.hideExtHint("cw");
    }

    var cached = ctx.cache[cacheKey];
    if (!cached || !cached.data || !cached.data.length) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    var labelDates = ctx.labels.map(function(l) { return new Date(l.replace(" ", "T")).getTime(); });
    var labelStep = labelDates.length >= 2 ? Math.abs(labelDates[1] - labelDates[0]) : 86400000;
    var maxDist = Math.max(labelStep, 86400000);
    var cwAgg = new Array(ctx.labels.length).fill(null);
    cached.data.forEach(function(d) {
      var dt = new Date(d.date).getTime();
      var bestIdx = 0, bestDist = Infinity;
      for (var i = 0; i < labelDates.length; i++) {
        var dist = Math.abs(labelDates[i] - dt);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      if (bestDist <= maxDist && d.value != null) {
        cwAgg[bestIdx] = (cwAgg[bestIdx] || 0) + d.value;
      }
    });

    if (cwAgg.every(function(v) { return v === null; })) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    var zoneName = cached.zone_name || cached.domain || "Zone";

    return {
      datasets: [{
        _isCw: true,
        label: "CT Certs (" + zoneName + ")",
        data: cwAgg,
        borderColor: "#14b8a6",
        backgroundColor: "#14b8a630",
        borderWidth: 1.5,
        pointRadius: cwAgg.map(function(v) { return v != null && v > 5 ? 4 : 2; }),
        pointBackgroundColor: "#14b8a6",
        type: "bar",
        yAxisID: "yCw",
        fill: false,
        spanGaps: false,
      }],
      annotations: {},
      yAxes: {
        yCw: {
          position: "right",
          min: 0,
          ticks: { color: "#14b8a6", stepSize: 1 },
          grid: { drawOnChartArea: false },
          title: { display: true, text: "CT Zertifikate", color: "#14b8a6", font: { size: 11 } },
        },
      },
    };
  },
});

})();
