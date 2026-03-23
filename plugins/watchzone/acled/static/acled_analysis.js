/**
 * ACLED Analysis Provider — Armed Conflict events on analysis chart.
 */
(function() {
"use strict";

AnalysisProviders.register("acled", {
  async fetchAndBuild(ctx) {
    var cacheKey = "acled_" + ctx.zoneId + "_" + ctx.fromDate + "_" + ctx.toDate;
    if (!ctx.cache[cacheKey]) {
      ctx.showExtHint("acled", "ACLED Konflikte", "#dc2626");
      try {
        var r = await fetch("/api/watchzones/" + ctx.zoneId + "/acled-history?from=" + ctx.fromDate + "&to=" + ctx.toDate);
        if (r.ok) {
          ctx.setCache(cacheKey, await r.json());
        } else {
          console.warn("[ACLED] API error:", r.status);
        }
      } catch(e) { console.warn("[ACLED] fetch error:", e); }
      ctx.hideExtHint("acled");
    }

    var cached = ctx.cache[cacheKey];
    if (!cached || !cached.data || !cached.data.length) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    var labelDates = ctx.labels.map(function(l) { return new Date(l.replace(" ", "T")).getTime(); });
    var labelStep = labelDates.length >= 2 ? Math.abs(labelDates[1] - labelDates[0]) : 86400000;
    var maxDist = Math.max(labelStep, 86400000);
    var acledAgg = new Array(ctx.labels.length).fill(null);
    cached.data.forEach(function(d) {
      var dt = new Date(d.date).getTime();
      var bestIdx = 0, bestDist = Infinity;
      for (var i = 0; i < labelDates.length; i++) {
        var dist = Math.abs(labelDates[i] - dt);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      if (bestDist <= maxDist && d.value != null) {
        acledAgg[bestIdx] = (acledAgg[bestIdx] || 0) + d.value;
      }
    });

    if (acledAgg.every(function(v) { return v === null; })) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    return {
      datasets: [{
        _isAcled: true,
        label: "ACLED Events (" + (cached.zone_name || "Zone") + ")",
        data: acledAgg,
        borderColor: "#dc2626",
        backgroundColor: "#dc262630",
        borderWidth: 1.5,
        pointRadius: acledAgg.map(function(v) { return v != null && v > 5 ? 4 : 2; }),
        pointBackgroundColor: "#dc2626",
        type: "bar",
        yAxisID: "yAcled",
        fill: false,
        spanGaps: false,
      }],
      annotations: {},
      yAxes: {
        yAcled: {
          position: "right",
          min: 0,
          ticks: { color: "#dc2626", stepSize: 1 },
          grid: { drawOnChartArea: false },
          title: { display: true, text: "ACLED Events", color: "#dc2626", font: { size: 11 } },
        },
      },
    };
  },
});

})();
