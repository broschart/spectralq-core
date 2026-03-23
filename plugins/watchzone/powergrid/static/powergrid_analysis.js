/**
 * Power Grid Analysis Provider — Grid frequency / outage data on analysis chart.
 */
(function() {
"use strict";

AnalysisProviders.register("powergrid", {
  async fetchAndBuild(ctx) {
    var cacheKey = "pg_" + ctx.zoneId + "_" + ctx.fromDate + "_" + ctx.toDate;
    if (!ctx.cache[cacheKey]) {
      ctx.showExtHint("pg", "Stromnetz", "#f59e0b");
      try {
        var r = await fetch("/api/watchzones/" + ctx.zoneId + "/powergrid-history?from=" + ctx.fromDate + "&to=" + ctx.toDate);
        if (r.ok) {
          ctx.setCache(cacheKey, await r.json());
        } else {
          console.warn("[PG] API error:", r.status);
        }
      } catch(e) { console.warn("[PG] fetch error:", e); }
      ctx.hideExtHint("pg");
    }

    var cached = ctx.cache[cacheKey];
    if (!cached || !cached.data || !cached.data.length) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    var labelDates = ctx.labels.map(function(l) { return new Date(l.replace(" ", "T")).getTime(); });
    var labelStep = labelDates.length >= 2 ? Math.abs(labelDates[1] - labelDates[0]) : 86400000;
    var maxDist = Math.max(labelStep, 86400000);
    var pgAgg = new Array(ctx.labels.length).fill(null);
    var pgCnt = new Array(ctx.labels.length).fill(0);
    cached.data.forEach(function(d) {
      var dt = new Date(d.date).getTime();
      var bestIdx = 0, bestDist = Infinity;
      for (var i = 0; i < labelDates.length; i++) {
        var dist = Math.abs(labelDates[i] - dt);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      if (bestDist <= maxDist && d.value != null) {
        pgAgg[bestIdx] = (pgAgg[bestIdx] || 0) + d.value;
        pgCnt[bestIdx]++;
      }
    });
    // Average per bucket
    for (var k = 0; k < pgAgg.length; k++) {
      if (pgCnt[k] > 1) pgAgg[k] = Math.round(pgAgg[k] / pgCnt[k] * 100) / 100;
    }

    if (pgAgg.every(function(v) { return v === null; })) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    var zoneName = cached.zone_name || "Zone";
    var metric = cached.metric || "Netzfrequenz";

    return {
      datasets: [{
        _isPg: true,
        label: metric + " (" + zoneName + ")",
        data: pgAgg,
        borderColor: "#f59e0b",
        backgroundColor: "#f59e0b25",
        borderWidth: 2,
        pointRadius: 2,
        pointBackgroundColor: "#f59e0b",
        type: "line",
        yAxisID: "yPg",
        fill: true,
        spanGaps: true,
      }],
      annotations: {},
      yAxes: {
        yPg: {
          position: "right",
          min: 0,
          ticks: { color: "#f59e0b" },
          grid: { drawOnChartArea: false },
          title: { display: true, text: metric, color: "#f59e0b", font: { size: 11 } },
        },
      },
    };
  },
});

})();
