/**
 * Weather Analysis Provider — Open-Meteo / DWD weather data on analysis chart.
 */
(function() {
"use strict";

AnalysisProviders.register("weather", {
  async fetchAndBuild(ctx) {
    // Weather needs sub-type from the WZ selector; fall back to "niederschlag"
    var wxType = "niederschlag";
    var wxSel = document.getElementById("wx-type-select");
    if (wxSel) wxType = wxSel.value || "niederschlag";

    var cacheKey = "wx_" + ctx.zoneId + "_" + wxType + "_" + ctx.fromDate + "_" + ctx.toDate;
    if (!ctx.cache[cacheKey]) {
      ctx.showExtHint("wx", "Wetter", "#3b82f6");
      try {
        var r = await fetch("/api/watchzones/" + ctx.zoneId + "/weather-history?from=" + ctx.fromDate + "&to=" + ctx.toDate + "&type=" + encodeURIComponent(wxType));
        if (r.ok) {
          ctx.setCache(cacheKey, await r.json());
        } else {
          console.warn("[Wx] API error:", r.status);
        }
      } catch(e) { console.warn("[Wx] fetch error:", e); }
      ctx.hideExtHint("wx");
    }

    var cached = ctx.cache[cacheKey];
    if (!cached || !cached.data || !cached.data.length) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    var wxLabel = {
      pegel: "Niederschlag (mm)",
      niederschlag: "Niederschlag (mm)",
      warnung: "Wetterwarnungen",
      sturm: "Windb\u00f6en (km/h)",
    }[wxType] || wxType;
    var wxColor = {
      pegel: "#3b82f6",
      niederschlag: "#3b82f6",
      warnung: "#f59e0b",
      sturm: "#ef4444",
    }[wxType] || "#22c55e";

    // Aggregate weather data to chart labels (labels may be weekly)
    var labelDates = ctx.labels.map(function(l) { return new Date(l.slice(0, 10)).getTime(); });
    var wxAgg = new Array(ctx.labels.length).fill(null);
    var isSumType = wxType === "pegel" || wxType === "niederschlag";
    cached.data.forEach(function(d) {
      var dt = new Date(d.date).getTime();
      var bestIdx = 0, bestDist = Infinity;
      for (var i = 0; i < labelDates.length; i++) {
        var dist = Math.abs(labelDates[i] - dt);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
      }
      if (bestDist <= 7 * 86400000) {
        if (isSumType) {
          wxAgg[bestIdx] = (wxAgg[bestIdx] || 0) + d.value;
        } else {
          wxAgg[bestIdx] = Math.max(wxAgg[bestIdx] || 0, d.value);
        }
      }
    });
    var wxData = wxAgg.map(function(v) { return v !== null ? Math.round(v * 10) / 10 : null; });
    if (wxData.every(function(v) { return v === null; })) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    var isBar = wxType === "pegel" || wxType === "niederschlag";
    var zoneName = cached.zone_name || "Zone";

    return {
      datasets: [{
        label: wxLabel + " (" + zoneName + ")",
        data: wxData,
        borderColor: wxColor,
        backgroundColor: isBar ? wxColor + "60" : wxColor + "20",
        borderWidth: isBar ? 0 : 2,
        pointRadius: isBar ? 0 : 2,
        type: isBar ? "bar" : "line",
        yAxisID: "yWx",
        fill: !isBar,
        spanGaps: true,
        order: isBar ? 10 : 1,
      }],
      annotations: {},
      yAxes: {
        yWx: {
          position: "right",
          min: 0,
          ticks: { color: wxColor },
          grid: { drawOnChartArea: false },
          title: { display: true, text: wxLabel, color: wxColor, font: { size: 11 } },
        },
      },
    };
  },
});

})();
