"""Analysis Plugin: Zeitreihen-Zerlegung (Decomposition)."""
from plugins import PluginManager
from plugins.analysis import AnalysisPlugin

class DecompPlugin(AnalysisPlugin):
    plugin_id = "decomp"
    meta = {
        "label": "Zeitreihen-Zerlegung",
        "icon_svg": '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 12h4l3-9 4 18 3-9h4"/></svg>',
        "color": "#a78bfa",
        "symbol": "≋",
        "description": "Zerlegung in Trend, Saisonalität und Residuum.",
        "default_show_in": ["popup"],
        "button_id": "",
        "requires_multi_kw": False,
        "modal_template": "decomp/_modal.html",
        "popup_handler": "openDecompForKw",

    }

    def api_routes(self):
        return [{"rule": "/api/decompose", "handler": self._handle, "methods": ["POST"]}]

    def compute(self, body):
        import numpy as np
        from plugins.analysis._helpers import load_series

        period = max(int(body.get("period", 30)), 2)
        trend_window = max(int(body.get("trend_window", 7)), 3)
        model = body.get("model", "additive")
        labels, series = load_series(body)

        if not series:
            return {"error": "Keine Daten verfügbar.", "_status": 400}

        s = series[0]
        vals = np.array([v if v is not None else np.nan for v in s["values"]], dtype=float)
        n = len(vals)
        non_null = int(np.sum(~np.isnan(vals)))

        if non_null < period * 2:
            return {"error": f"Zu wenige Datenpunkte ({non_null}) für Periode {period}.", "_status": 400}

        half_w = trend_window // 2
        trend = np.full(n, np.nan)
        for i in range(half_w, n - half_w):
            win = vals[i - half_w:i + half_w + 1]
            valid = win[~np.isnan(win)]
            if len(valid) > 0:
                trend[i] = float(valid.mean())

        if model == "multiplicative":
            detrended = np.where(
                ~np.isnan(vals) & ~np.isnan(trend) & (trend > 0),
                vals / trend, np.nan)
        else:
            detrended = np.where(
                ~np.isnan(vals) & ~np.isnan(trend),
                vals - trend, np.nan)

        buckets = [[] for _ in range(period)]
        for i in range(n):
            if not np.isnan(detrended[i]):
                buckets[i % period].append(float(detrended[i]))

        if model == "multiplicative":
            means = [np.mean(b) if b else 1.0 for b in buckets]
            avg = np.mean(means)
            seasonal_pattern = [m / avg if avg > 0 else 1.0 for m in means]
        else:
            means = [np.mean(b) if b else 0.0 for b in buckets]
            center = np.mean(means)
            seasonal_pattern = [m - center for m in means]

        seasonal = np.array([seasonal_pattern[i % period] for i in range(n)])

        if model == "multiplicative":
            residual = np.where(
                ~np.isnan(vals) & ~np.isnan(trend) & (trend > 0) & (seasonal != 0),
                vals / (trend * seasonal), np.nan)
        else:
            residual = np.where(
                ~np.isnan(vals) & ~np.isnan(trend),
                vals - trend - seasonal, np.nan)

        def to_list(arr):
            return [None if np.isnan(v) else round(float(v), 3) for v in arr]

        trend_loss = int(np.sum(np.isnan(trend)))

        return {
            "keyword": s["keyword"],
            "observed": to_list(vals),
            "trend": to_list(trend),
            "seasonal": to_list(seasonal),
            "residual": to_list(residual),
            "seasonal_pattern": [round(float(v), 4) for v in seasonal_pattern],
            "labels": labels,
            "period": period,
            "model": model,
            "trend_window": trend_window,
            "data_points": non_null,
            "trend_loss": trend_loss,
            "summary": f"Zerlegung ({model}): {non_null} Datenpunkte, "
                       f"Trend-Fenster {trend_window}, Saison-Periode {period}, "
                       f"Randverlust {trend_loss} Punkte.",
        }

    def _handle(self):
        from flask import request, jsonify
        body = request.get_json(force=True, silent=True) or {}
        result = self.compute(body)
        status = result.pop("_status", 200)
        return jsonify(result), status

PluginManager.register(DecompPlugin())
