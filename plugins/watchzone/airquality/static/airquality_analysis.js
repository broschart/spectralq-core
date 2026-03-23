/**
 * Air Quality Analysis Provider — AQI / PM2.5 data on analysis chart.
 */
(function() {
"use strict";

AnalysisProviders.register("airquality", {
  async fetchAndBuild(ctx) {
    var cacheKey = "aq_" + ctx.zoneId + "_" + ctx.fromDate + "_" + ctx.toDate;
    if (!ctx.cache[cacheKey]) {
      ctx.showExtHint("aq", "Luftqualit\u00e4t", "#22c55e");
      try {
        var r = await fetch("/api/watchzones/" + ctx.zoneId + "/airquality-history?from=" + ctx.fromDate + "&to=" + ctx.toDate);
        if (r.ok) {
          ctx.setCache(cacheKey, await r.json());
        } else {
          console.warn("[AQ] API error:", r.status);
        }
      } catch(e) { console.warn("[AQ] fetch error:", e); }
      ctx.hideExtHint("aq");
    }

    var cached = ctx.cache[cacheKey];
    if (!cached || !cached.data || !cached.data.length) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    var labelDates = ctx.labels.map(function(l) { return new Date(l.replace(" ", "T")).getTime(); });
    var labelStep = labelDates.length >= 2 ? Math.abs(labelDates[1] - labelDates[0]) : 86400000;
    var maxDist = Math.max(labelStep, 86400000);
    var aqAgg = new Array(ctx.labels.length).fill(null);
    var aqCnt = new Array(ctx.labels.length).fill(0);
    cached.data.forEach(function(d) {
      var dt = new Date(d.date).getTime();
      var bestIdx = 0, bestDist = Infinity;
      for (var i = 0; i < labelDates.length; i++) {
        var dist = Math.abs(labelDates[i] - dt);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      if (bestDist <= maxDist && d.value != null) {
        aqAgg[bestIdx] = (aqAgg[bestIdx] || 0) + d.value;
        aqCnt[bestIdx]++;
      }
    });
    // Average per bucket
    for (var k = 0; k < aqAgg.length; k++) {
      if (aqCnt[k] > 1) aqAgg[k] = Math.round(aqAgg[k] / aqCnt[k] * 10) / 10;
    }

    if (aqAgg.every(function(v) { return v === null; })) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    var metric = (cached.metric || "AQI");
    var zoneName = cached.zone_name || "Zone";

    return {
      datasets: [{
        _isAq: true,
        label: metric + " (" + zoneName + ")",
        data: aqAgg,
        borderColor: "#22c55e",
        backgroundColor: "#22c55e25",
        borderWidth: 2,
        pointRadius: 2,
        pointBackgroundColor: "#22c55e",
        type: "line",
        yAxisID: "yAq",
        fill: true,
        spanGaps: true,
      }],
      annotations: {},
      yAxes: {
        yAq: {
          position: "right",
          min: 0,
          ticks: { color: "#22c55e" },
          grid: { drawOnChartArea: false },
          title: { display: true, text: metric, color: "#22c55e", font: { size: 11 } },
        },
      },
    };
  },
});

})();
