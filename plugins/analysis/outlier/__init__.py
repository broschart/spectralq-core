"""Analysis Plugin: Outlier Detection."""
from plugins import PluginManager
from plugins.analysis import AnalysisPlugin

class OutlierPlugin(AnalysisPlugin):
    plugin_id = "outlier"
    meta = {
        "label": "Outlier Detection",
        "icon_svg": '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
        "color": "#facc15",
        "symbol": "⊘",
        "description": "Erkennung statistischer Ausreißer in Zeitreihen.",
        "default_show_in": ["popup"],
        "button_id": "",
        "requires_multi_kw": False,
        "modal_template": "outlier/_modal.html",
        "popup_handler": "openOutlierForKw",

    }

    def api_routes(self):
        return [{"rule": "/api/outliers", "handler": self._handle, "methods": ["POST"]}]

    def compute(self, body):
        import numpy as np
        from plugins.analysis._helpers import load_series

        method = body.get("method", "zscore_global")
        threshold = float(body.get("threshold", 2.0))
        win_size = max(int(body.get("window", 14)), 3)
        labels, series = load_series(body)

        if not series:
            return {"error": "Keine Daten verfügbar.", "_status": 400}

        s = series[0]
        vals = np.array([v if v is not None else np.nan for v in s["values"]], dtype=float)
        n = len(vals)
        outliers = []

        if method == "zscore_global":
            nn = vals[~np.isnan(vals)]
            if len(nn) < 3:
                return {"error": "Zu wenige gültige Datenpunkte.", "_status": 400}
            mean, std = float(nn.mean()), float(nn.std())
            lo, hi = mean - threshold * std, mean + threshold * std
            for i in range(n):
                if np.isnan(vals[i]):
                    continue
                z = (vals[i] - mean) / std if std > 0 else 0.0
                if abs(z) > threshold:
                    outliers.append({
                        "idx": i, "date": labels[i] if i < len(labels) else None,
                        "value": int(vals[i]), "deviation": round(float(z), 3),
                        "direction": "hoch" if z > 0 else "niedrig", "unit": "σ",
                    })
            bands = {"type": "global", "lo": round(lo, 2), "hi": round(hi, 2)}

        elif method == "zscore_rolling":
            hw = win_size // 2
            bands_data = {"type": "rolling", "mean": [], "lo": [], "hi": []}
            for i in range(n):
                win = vals[max(0, i - hw):i + hw + 1]
                win = win[~np.isnan(win)]
                if len(win) < 3:
                    bands_data["mean"].append(None)
                    bands_data["lo"].append(None)
                    bands_data["hi"].append(None)
                    continue
                m, s_val = float(win.mean()), float(win.std())
                bands_data["mean"].append(round(m, 2))
                bands_data["lo"].append(round(m - threshold * s_val, 2))
                bands_data["hi"].append(round(m + threshold * s_val, 2))
                if not np.isnan(vals[i]):
                    z = (vals[i] - m) / s_val if s_val > 0 else 0.0
                    if abs(z) > threshold:
                        outliers.append({
                            "idx": i, "date": labels[i] if i < len(labels) else None,
                            "value": int(vals[i]), "deviation": round(float(z), 3),
                            "direction": "hoch" if z > 0 else "niedrig", "unit": "σ",
                        })
            bands = bands_data

        else:  # IQR
            sorted_vals = np.sort(vals[~np.isnan(vals)])
            if len(sorted_vals) < 4:
                return {"error": "Zu wenige gültige Datenpunkte.", "_status": 400}
            q1 = float(np.percentile(sorted_vals, 25))
            q3 = float(np.percentile(sorted_vals, 75))
            iqr = q3 - q1
            lo, hi = q1 - threshold * iqr, q3 + threshold * iqr
            for i in range(n):
                if np.isnan(vals[i]):
                    continue
                if vals[i] < lo or vals[i] > hi:
                    dev = float((vals[i] - q3) / (iqr or 1) if vals[i] > hi else (q1 - vals[i]) / (iqr or 1))
                    outliers.append({
                        "idx": i, "date": labels[i] if i < len(labels) else None,
                        "value": int(vals[i]),
                        "deviation": round(dev if vals[i] > hi else -dev, 3),
                        "direction": "hoch" if vals[i] > hi else "niedrig", "unit": "×IQR",
                    })
            bands = {"type": "iqr", "lo": round(lo, 2), "hi": round(hi, 2)}

        outliers.sort(key=lambda o: abs(o["deviation"]), reverse=True)

        return {
            "keyword": s["keyword"],
            "outliers": outliers,
            "total": len(outliers),
            "method": method,
            "threshold": threshold,
            "bands": bands,
            "summary": f"{len(outliers)} Ausreißer erkannt ({method}, Schwelle {threshold}), "
                       f"{n} Datenpunkte analysiert.",
        }

    def _handle(self):
        from flask import request, jsonify
        body = request.get_json(force=True, silent=True) or {}
        result = self.compute(body)
        status = result.pop("_status", 200)
        return jsonify(result), status

PluginManager.register(OutlierPlugin())
