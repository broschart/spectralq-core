/**
 * Satellite Analysis Provider — Sentinel acquisition dates as annotations on analysis chart.
 */
(function() {
"use strict";

AnalysisProviders.register("satellite", {
  async fetchAndBuild(ctx) {
    var cacheKey = "sat_" + ctx.zoneId + "_" + ctx.fromDate + "_" + ctx.toDate;
    if (!ctx.cache[cacheKey]) {
      ctx.showExtHint("sat", "Satellitendaten", "#8b5cf6");
      try {
        var r = await fetch("/api/watchzones/" + ctx.zoneId + "/satellite-dates?from=" + ctx.fromDate + "&to=" + ctx.toDate);
        if (r.ok) {
          ctx.setCache(cacheKey, await r.json());
        } else {
          console.warn("[Sat] API error:", r.status);
        }
      } catch(e) { console.warn("[Sat] fetch error:", e); }
      ctx.hideExtHint("sat");
    }

    var cached = ctx.cache[cacheKey];
    if (!cached || !cached.dates || !cached.dates.length) {
      if (cached) ctx.toast(ctx.t("an_sat_no_data", "Keine Satelliten-Aufnahmedaten im Zeitraum"), "info");
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    var labelSet = {};
    ctx.labels.forEach(function(l) { labelSet[l] = true; labelSet[l.slice(0, 10)] = l; });

    var annotations = {};
    cached.dates.forEach(function(d, i) {
      var lbl = null;
      for (var j = 0; j < ctx.labels.length; j++) {
        if (ctx.labels[j].slice(0, 10) === d) { lbl = ctx.labels[j]; break; }
      }
      if (!lbl) return;
      annotations["sat_" + i] = {
        type: "line",
        xMin: lbl, xMax: lbl,
        borderColor: "rgba(124,58,237,.19)",
        borderWidth: 1,
        drawTime: "beforeDatasetsDraw",
      };
    });

    // No datasets — satellite only produces annotations
    return {
      datasets: [],
      annotations: annotations,
      yAxes: {},
    };
  },
});

})();
