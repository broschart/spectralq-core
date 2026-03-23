/**
 * Migration Analysis Provider — UNHCR refugee / asylum data on analysis chart.
 */
(function() {
"use strict";

AnalysisProviders.register("migration", {
  async fetchAndBuild(ctx) {
    var cacheKey = "mig_" + ctx.zoneId + "_" + ctx.fromDate + "_" + ctx.toDate;
    if (!ctx.cache[cacheKey]) {
      ctx.showExtHint("mig", "Migration (UNHCR)", "#8b5cf6");
      try {
        var r = await fetch("/api/watchzones/" + ctx.zoneId + "/migration-history?from=" + ctx.fromDate + "&to=" + ctx.toDate);
        if (r.ok) {
          ctx.setCache(cacheKey, await r.json());
        } else {
          console.warn("[Mig] API error:", r.status);
        }
      } catch(e) { console.warn("[Mig] fetch error:", e); }
      ctx.hideExtHint("mig");
    }

    var cached = ctx.cache[cacheKey];
    if (!cached || !cached.data || !cached.data.length) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    // UNHCR provides yearly data — determine best display strategy
    var chartFromTs = new Date(ctx.labels[0].replace(" ", "T")).getTime();
    var chartToTs = new Date(ctx.labels[ctx.labels.length - 1].replace(" ", "T")).getTime();
    var chartSpanDays = (chartToTs - chartFromTs) / 86400000;

    var migAgg = new Array(ctx.labels.length).fill(null);

    if (chartSpanDays > 365) {
      // Multi-year view: map yearly data to nearest label
      var labelDates = ctx.labels.map(function(l) { return new Date(l.replace(" ", "T")).getTime(); });
      cached.data.forEach(function(d) {
        var dt = new Date(d.date).getTime();
        var bestIdx = 0, bestDist = Infinity;
        for (var i = 0; i < labelDates.length; i++) {
          var dist = Math.abs(labelDates[i] - dt);
          if (dist < bestDist) { bestDist = dist; bestIdx = i; }
        }
        if (d.value != null) migAgg[bestIdx] = d.value;
      });
    } else {
      // Short view (days/weeks/months): show latest UNHCR value as reference line
      var sorted = cached.data.filter(function(d) { return d.value != null; })
        .sort(function(a, b) { return b.date.localeCompare(a.date); });
      if (sorted.length) {
        var latest = sorted[0].value;
        for (var j = 0; j < migAgg.length; j++) migAgg[j] = latest;
      }
    }

    var hasData = migAgg.some(function(v) { return v != null; });
    if (!hasData) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    var isFlat = chartSpanDays <= 365;
    var country = cached.country || "?";

    return {
      datasets: [{
        _isMig: true,
        label: (isFlat ? "UNHCR Stand " : "Refugees+Asylum ") + "(" + country + ")",
        data: migAgg,
        borderColor: "#8b5cf6",
        backgroundColor: isFlat ? "transparent" : "#8b5cf630",
        borderWidth: isFlat ? 1.5 : 2,
        borderDash: isFlat ? [6, 4] : [],
        pointRadius: isFlat ? 0 : 3,
        pointBackgroundColor: "#8b5cf6",
        type: "line",
        yAxisID: "yMig",
        fill: !isFlat,
        spanGaps: true,
      }],
      annotations: {},
      yAxes: {
        yMig: {
          position: "right",
          min: 0,
          ticks: {
            color: "#8b5cf6",
            callback: function(v) {
              return v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(0) + "K" : v;
            },
          },
          grid: { drawOnChartArea: false },
          title: { display: true, text: "Refugees + Asylum", color: "#8b5cf6", font: { size: 11 } },
        },
      },
    };
  },
});

})();
