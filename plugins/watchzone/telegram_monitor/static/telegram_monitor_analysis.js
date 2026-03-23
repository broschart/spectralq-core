/**
 * Telegram Monitor Analysis Provider — Telegram mention counts on analysis chart.
 */
(function() {
"use strict";

AnalysisProviders.register("telegram_monitor", {
  async fetchAndBuild(ctx) {
    var cacheKey = "tgm_" + ctx.zoneId + "_" + ctx.fromDate + "_" + ctx.toDate;
    if (!ctx.cache[cacheKey]) {
      ctx.showExtHint("tgm", "Telegram Monitor", "#0088cc");
      try {
        var r = await fetch("/api/watchzones/" + ctx.zoneId + "/telegram-history?from=" + ctx.fromDate + "&to=" + ctx.toDate);
        if (r.ok) {
          ctx.setCache(cacheKey, await r.json());
        } else {
          console.warn("[TGM] API error:", r.status);
        }
      } catch(e) { console.warn("[TGM] fetch error:", e); }
      ctx.hideExtHint("tgm");
    }

    var cached = ctx.cache[cacheKey];
    if (!cached || !cached.data || !cached.data.length) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    var labelDates = ctx.labels.map(function(l) { return new Date(l.replace(" ", "T")).getTime(); });
    var labelStep = labelDates.length >= 2 ? Math.abs(labelDates[1] - labelDates[0]) : 86400000;
    var maxDist = Math.max(labelStep, 86400000);
    var tgmAgg = new Array(ctx.labels.length).fill(null);
    cached.data.forEach(function(d) {
      var dt = new Date(d.date).getTime();
      var bestIdx = 0, bestDist = Infinity;
      for (var i = 0; i < labelDates.length; i++) {
        var dist = Math.abs(labelDates[i] - dt);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      if (bestDist <= maxDist && d.value != null) {
        tgmAgg[bestIdx] = (tgmAgg[bestIdx] || 0) + d.value;
      }
    });

    if (tgmAgg.every(function(v) { return v === null; })) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    var keywords = cached.keywords || [];

    return {
      datasets: [{
        _isTgm: true,
        label: "Telegram (" + keywords.join(", ") + ")",
        data: tgmAgg,
        borderColor: "#0088cc",
        backgroundColor: "#0088cc30",
        borderWidth: 1.5,
        borderDash: [6, 3],
        pointRadius: 2,
        pointBackgroundColor: "#0088cc",
        type: "line",
        yAxisID: "yTgm",
        fill: true,
        spanGaps: false,
      }],
      annotations: {},
      yAxes: {
        yTgm: {
          position: "right",
          min: 0,
          ticks: { color: "#0088cc", stepSize: 1 },
          grid: { drawOnChartArea: false },
          title: { display: true, text: "Telegram Mentions", color: "#0088cc", font: { size: 11 } },
        },
      },
    };
  },
});

})();
