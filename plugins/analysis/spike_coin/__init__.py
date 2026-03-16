"""Analysis Plugin: Spike-Koinzidenz."""
from plugins import PluginManager
from plugins.analysis import AnalysisPlugin

class SpikeCoinPlugin(AnalysisPlugin):
    plugin_id = "spike_coin"
    meta = {
        "label": "Spike-Koinzidenz",
        "icon_svg": '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><polyline points="4,18 8,10 12,14 16,4 20,12"/></svg>',
        "color": "#f87171",
        "symbol": "⚡",
        "description": "Erkennung gleichzeitiger Spitzen über mehrere Keywords hinweg.",
        "modal_template": "spike_coin/_modal.html",
        "default_show_in": ["lab"],
        "button_id": "btn-spike-coin",

    }

    def api_routes(self):
        return [{"rule": "/api/spike-coincidence", "handler": self._handle, "methods": ["POST"]}]

    def compute(self, body):
        import numpy as np
        from plugins.analysis._helpers import load_series

        threshold = float(body.get("threshold", 2.0))
        min_kw = max(int(body.get("min_keywords", 2)), 2)
        labels, series = load_series(body)

        if not series or len(series) < 2:
            return {"error": "Mindestens 2 Keyword-Reihen erforderlich.", "_status": 400}

        z_scores = []
        for s in series:
            vals = np.array([v if v is not None else np.nan for v in s["values"]], dtype=float)
            nn = vals[~np.isnan(vals)]
            if len(nn) < 3:
                z_scores.append(np.zeros(len(vals)))
                continue
            mean, std = nn.mean(), nn.std()
            z = np.where(np.isnan(vals), 0.0, (vals - mean) / std if std > 0 else 0.0)
            z_scores.append(z)

        coincidences = []
        for i in range(len(labels)):
            spiking = []
            for k, s in enumerate(series):
                if abs(z_scores[k][i]) >= threshold:
                    spiking.append({
                        "keyword": s["keyword"],
                        "kwId": s["kwId"],
                        "value": s["values"][i],
                        "z_score": round(float(z_scores[k][i]), 3),
                        "direction": "hoch" if z_scores[k][i] > 0 else "niedrig",
                    })
            if len(spiking) >= min_kw:
                avg_z = sum(abs(sp["z_score"]) for sp in spiking) / len(spiking)
                coincidences.append({
                    "idx": i,
                    "date": labels[i],
                    "keywords": spiking,
                    "count": len(spiking),
                    "avg_z": round(avg_z, 3),
                })

        coincidences.sort(key=lambda c: c["avg_z"], reverse=True)

        return {
            "coincidences": coincidences,
            "total": len(coincidences),
            "threshold": threshold,
            "min_keywords": min_kw,
            "series_count": len(series),
            "summary": f"{len(coincidences)} Spike-Koinzidenz(en) erkannt bei Schwelle {threshold}σ, "
                       f"min. {min_kw} gleichzeitige Keywords, {len(series)} Reihen analysiert.",
        }

    def _handle(self):
        from flask import request, jsonify
        body = request.get_json(force=True, silent=True) or {}
        result = self.compute(body)
        status = result.pop("_status", 200)
        return jsonify(result), status

PluginManager.register(SpikeCoinPlugin())
