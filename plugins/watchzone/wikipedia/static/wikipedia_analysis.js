/**
 * Wikipedia Analysis Provider — Wikipedia page views & edits on analysis chart.
 * Uses the WZ wiki-history endpoint which returns article edit data,
 * plus the global wiki-views API for page view data.
 */
(function() {
"use strict";

var VIEW_COLORS = ["#ff9f1c", "#e040fb", "#00e5ff", "#76ff03", "#ff5252"];
var EDIT_COLORS = ["#4ade80", "#c084fc", "#67e8f9", "#fbbf24", "#fb7185"];

AnalysisProviders.register("wikipedia", {
  async fetchAndBuild(ctx) {
    // First get the zone config to find article list
    var configKey = "wikicfg_" + ctx.zoneId;
    if (!ctx.cache[configKey]) {
      try {
        var zr = await fetch("/api/watchzones/" + ctx.zoneId);
        if (zr.ok) ctx.setCache(configKey, await zr.json());
      } catch(e) {}
    }
    var zoneCfg = ctx.cache[configKey];
    var articles = [];
    if (zoneCfg && zoneCfg.config && zoneCfg.config.articles) {
      articles = zoneCfg.config.articles.map(function(a) {
        return typeof a === "string" ? a : (a.title || "");
      }).filter(Boolean);
    }
    if (!articles.length) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    var datasets = [];
    var wikiDays = Math.min(730, Math.max(30, ctx.labels.length + 14));

    // Fetch page views via global wiki-views API
    var viewsKey = "wikiviews_" + articles.join(",") + "_" + wikiDays;
    if (!ctx.cache[viewsKey]) {
      ctx.showExtHint("wiki", "Wikipedia", "#ff9f1c");
      try {
        var vr = await fetch("/api/wiki-views?articles=" + encodeURIComponent(articles.join(",")) + "&days=" + wikiDays);
        if (vr.ok) ctx.setCache(viewsKey, await vr.json());
      } catch(e) { console.warn("[Wiki] views error:", e); }
      ctx.hideExtHint("wiki");
    }
    var viewsData = ctx.cache[viewsKey];
    if (Array.isArray(viewsData)) {
      var ci = 0;
      for (var vi = 0; vi < viewsData.length; vi++) {
        var item = viewsData[vi];
        if (item.error || !item.series || !item.series.length) continue;
        var dateMap = {};
        item.series.forEach(function(p) { dateMap[p.date] = p.views; });
        var values = ctx.labels.map(function(d) { return dateMap[d] != null ? dateMap[d] : (dateMap[d.slice(0,10)] != null ? dateMap[d.slice(0,10)] : null); });
        if (values.every(function(v) { return v === null; })) continue;
        var title = item.wiki_title || item.article || articles[vi] || "?";
        datasets.push({
          _isWiki: true,
          label: title + " (Wikipedia)",
          data: values,
          borderColor: VIEW_COLORS[ci % VIEW_COLORS.length],
          backgroundColor: VIEW_COLORS[ci % VIEW_COLORS.length] + "18",
          borderWidth: 1.5,
          borderDash: [6, 3],
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 4,
          fill: false,
          spanGaps: true,
          yAxisID: "yWiki",
        });
        ci++;
      }
    }

    // Fetch edits via global wiki-edits API
    var editsKey = "wikiedits_" + articles.join(",") + "_" + wikiDays;
    if (!ctx.cache[editsKey]) {
      try {
        var er = await fetch("/api/wiki-edits?articles=" + encodeURIComponent(articles.join(",")) + "&days=" + wikiDays);
        if (er.ok) ctx.setCache(editsKey, await er.json());
      } catch(e) { console.warn("[Wiki] edits error:", e); }
    }
    var editsData = ctx.cache[editsKey];
    if (Array.isArray(editsData)) {
      var ei = 0;
      for (var ej = 0; ej < editsData.length; ej++) {
        var eItem = editsData[ej];
        if (eItem.error || !eItem.series || !eItem.series.length) continue;
        var eDateMap = {};
        eItem.series.forEach(function(p) { eDateMap[p.date] = p.edits; });
        var eValues = ctx.labels.map(function(d) { return eDateMap[d] != null ? eDateMap[d] : (eDateMap[d.slice(0,10)] != null ? eDateMap[d.slice(0,10)] : null); });
        if (eValues.every(function(v) { return v === null; })) continue;
        var eTitle = eItem.wiki_title || eItem.article || articles[ej] || "?";
        datasets.push({
          _isWikiEdit: true,
          type: "bar",
          label: eTitle + " (Wiki-Edits)",
          data: eValues,
          borderColor: EDIT_COLORS[ei % EDIT_COLORS.length],
          backgroundColor: EDIT_COLORS[ei % EDIT_COLORS.length] + "40",
          borderWidth: 1,
          barPercentage: 0.5,
          categoryPercentage: 0.8,
          order: 10,
          yAxisID: "yWikiEdit",
        });
        ei++;
      }
    }

    if (!datasets.length) {
      return { datasets: [], annotations: {}, yAxes: {} };
    }

    var yAxes = {};
    if (datasets.some(function(ds) { return ds._isWiki; })) {
      yAxes.yWiki = {
        position: "right",
        min: 0,
        ticks: { color: "#ff9f1c" },
        grid: { drawOnChartArea: false },
        title: { display: true, text: "Wikipedia Pageviews / Tag", color: "#ff9f1c", font: { size: 11 } },
      };
    }
    if (datasets.some(function(ds) { return ds._isWikiEdit; })) {
      yAxes.yWikiEdit = {
        position: "right",
        min: 0,
        ticks: { color: "#4ade80", stepSize: 1 },
        grid: { drawOnChartArea: false },
        title: { display: true, text: "Wikipedia Edits / Tag", color: "#4ade80", font: { size: 11 } },
      };
    }

    return {
      datasets: datasets,
      annotations: {},
      yAxes: yAxes,
    };
  },
});

})();
