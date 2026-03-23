/**
 * Nightlights Analysis Provider — NASA VIIRS Nighttime Lights on analysis chart.
 */
(function() {
"use strict";

AnalysisProviders.register("nightlights", {
  async fetchAndBuild(ctx) {
    var cacheKey = "nl_" + ctx.zoneId + "_" + ctx.fromDate + "_" + ctx.toDate;
    if (!ctx.cache[cacheKey]) {
      ctx.showExtHint("nl", "Nighttime Lights (NASA)", "#fbbf24");
      try {
        var r = await fetch("/api/watchzones/" + ctx.zoneId + "/nightlights-history?from=" + ctx.fromDate + "&to=" + ctx.toDate);
        if (r.ok) {
          ctx.setCache(cacheKey, await r.json());
        } else {
          console.warn("[NightLights] API error:", r.status);
        }
      } catch(e) { console.warn("[NightLights] fetch error:", e); }
      ctx.hideExtHint("nl");
    }

    var cached = ctx.cache[cacheKey];
    if (!cached || !cached.data || !cached.data.length) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    var labelDates = ctx.labels.map(function(l) { return new Date(l.slice(0, 10)).getTime(); });
    var nlAgg = new Array(ctx.labels.length).fill(null);
    cached.data.forEach(function(d) {
      var dt = new Date(d.date).getTime();
      var bestIdx = 0, bestDist = Infinity;
      for (var i = 0; i < labelDates.length; i++) {
        var dist = Math.abs(labelDates[i] - dt);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      if (bestDist <= 7 * 86400000) {
        if (nlAgg[bestIdx] === null) nlAgg[bestIdx] = d.value;
        else nlAgg[bestIdx] = (nlAgg[bestIdx] + d.value) / 2;
      }
    });
    var nlData = nlAgg.map(function(v) { return v !== null ? Math.round(v * 10) / 10 : null; });
    if (nlData.every(function(v) { return v === null; })) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    return {
      datasets: [{
        _isNL: true,
        label: "Nighttime Lights (" + (cached.zone_name || "Zone") + ")",
        data: nlData,
        borderColor: "#fbbf24",
        backgroundColor: "#fbbf2420",
        borderWidth: 2,
        pointRadius: 3,
        pointBackgroundColor: "#fbbf24",
        type: "line",
        yAxisID: "yNL",
        fill: true,
        spanGaps: true,
      }],
      annotations: {},
      yAxes: {
        yNL: {
          position: "right",
          min: 0,
          ticks: { color: "#fbbf24" },
          grid: { drawOnChartArea: false },
          title: { display: true, text: "Nighttime Lights (Helligkeit)", color: "#fbbf24", font: { size: 11 } },
        },
      },
    };
  },
});

})();
