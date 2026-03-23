/**
 * OSM Changes Analysis Provider — OpenStreetMap edit counts on analysis chart.
 */
(function() {
"use strict";

AnalysisProviders.register("osm_changes", {
  async fetchAndBuild(ctx) {
    var cacheKey = "osm_" + ctx.zoneId + "_" + ctx.fromDate + "_" + ctx.toDate;
    if (!ctx.cache[cacheKey]) {
      ctx.showExtHint("osm", "OSM \u00c4nderungen", "#7cb342");
      try {
        var r = await fetch("/api/watchzones/" + ctx.zoneId + "/osm-history?from=" + ctx.fromDate + "&to=" + ctx.toDate);
        if (r.ok) {
          ctx.setCache(cacheKey, await r.json());
        } else {
          console.warn("[OSM] API error:", r.status);
        }
      } catch(e) { console.warn("[OSM] fetch error:", e); }
      ctx.hideExtHint("osm");
    }

    var cached = ctx.cache[cacheKey];
    if (!cached || !cached.data || !cached.data.length) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    var labelDates = ctx.labels.map(function(l) { return new Date(l.replace(" ", "T")).getTime(); });
    var labelStep = labelDates.length >= 2 ? Math.abs(labelDates[1] - labelDates[0]) : 86400000;
    var maxDist = Math.max(labelStep, 86400000);
    var osmAgg = new Array(ctx.labels.length).fill(null);
    cached.data.forEach(function(d) {
      var dt = new Date(d.date).getTime();
      var bestIdx = 0, bestDist = Infinity;
      for (var i = 0; i < labelDates.length; i++) {
        var dist = Math.abs(labelDates[i] - dt);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      if (bestDist <= maxDist && d.value != null) {
        osmAgg[bestIdx] = (osmAgg[bestIdx] || 0) + d.value;
      }
    });

    if (osmAgg.every(function(v) { return v === null; })) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    return {
      datasets: [{
        _isOsm: true,
        label: "OSM Edits (" + (cached.zone_name || "Zone") + ")",
        data: osmAgg,
        borderColor: "#7cb342",
        backgroundColor: "#7cb34230",
        borderWidth: 1.5,
        pointRadius: osmAgg.map(function(v) { return v != null && v > 10 ? 4 : 2; }),
        pointBackgroundColor: "#7cb342",
        type: "bar",
        yAxisID: "yOsm",
        fill: false,
        spanGaps: false,
      }],
      annotations: {},
      yAxes: {
        yOsm: {
          position: "right",
          min: 0,
          ticks: { color: "#7cb342", stepSize: 1 },
          grid: { drawOnChartArea: false },
          title: { display: true, text: "OSM Edits", color: "#7cb342", font: { size: 11 } },
        },
      },
    };
  },
});

})();
