/**
 * Seismic Analysis Provider — USGS Earthquake data on analysis chart.
 */
(function() {
"use strict";

AnalysisProviders.register("seismic", {
  async fetchAndBuild(ctx) {
    var cacheKey = "seis_" + ctx.zoneId + "_" + ctx.fromDate + "_" + ctx.toDate;
    if (!ctx.cache[cacheKey]) {
      ctx.showExtHint("seis", "Seismik (USGS)", "#ef4444");
      try {
        var r = await fetch("/api/watchzones/" + ctx.zoneId + "/seismic-history?from=" + ctx.fromDate + "&to=" + ctx.toDate);
        if (r.ok) {
          ctx.setCache(cacheKey, await r.json());
        } else {
          console.warn("[Seismic] API error:", r.status);
        }
      } catch(e) { console.warn("[Seismic] fetch error:", e); }
      ctx.hideExtHint("seis");
    }

    var cached = ctx.cache[cacheKey];
    if (!cached || !cached.data || !cached.data.length) {
      if (cached) ctx.toast(ctx.t("an_seis_no_data", "Keine Erdbeben im Zeitraum (USGS)"), "info");
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    // Aggregate: map earthquake data to chart labels
    var labelDates = ctx.labels.map(function(l) { return new Date(l.slice(0, 10)).getTime(); });
    var seisAgg = new Array(ctx.labels.length).fill(null);
    cached.data.forEach(function(d) {
      var dt = new Date(d.date).getTime();
      var bestIdx = 0, bestDist = Infinity;
      for (var i = 0; i < labelDates.length; i++) {
        var dist = Math.abs(labelDates[i] - dt);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      if (bestDist <= 7 * 86400000) {
        seisAgg[bestIdx] = Math.max(seisAgg[bestIdx] || 0, d.value);
      }
    });

    return {
      datasets: [{
        _isSeis: true,
        label: "Erdbeben Mag. (" + (cached.zone_name || "Zone") + ")",
        data: seisAgg,
        borderColor: "#ef4444",
        backgroundColor: "#ef444440",
        borderWidth: 2,
        pointRadius: seisAgg.map(function(v) { return v !== null ? Math.max(3, v * 2) : 0; }),
        pointBackgroundColor: "#ef4444",
        type: "line",
        yAxisID: "ySeis",
        fill: false,
        spanGaps: false,
      }],
      annotations: {},
      yAxes: {
        ySeis: {
          position: "right",
          min: 0,
          ticks: { color: "#ef4444" },
          grid: { drawOnChartArea: false },
          title: { display: true, text: "Erdbeben (Magnitude)", color: "#ef4444", font: { size: 11 } },
        },
      },
    };
  },
});

})();
