"""Analysis Plugin: Change-Point-Detection."""
from plugins import PluginManager
from plugins.analysis import AnalysisPlugin

class CpdPlugin(AnalysisPlugin):
    plugin_id = "cpd"
    meta = {
        "label": "Change-Point-Detection",
        "icon_svg": '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 17h6l3-10 3 10h6"/></svg>',
        "color": "#fb923c",
        "symbol": "◆",
        "description": "Erkennung von Strukturbrüchen in Zeitreihen.",
        "default_show_in": ["lab", "popup"],
        "button_id": "btn-changepoint",
        "requires_multi_kw": False,
        "modal_template": "cpd/_modal.html",
        "popup_handler": "openCpdForKw",

    }

    def api_routes(self):
        return [{"rule": "/api/changepoint", "handler": self._handle, "methods": ["POST"]}]

    def compute(self, body):
        import numpy as np
        import ruptures
        from plugins.analysis._helpers import load_series

        penalty = float(body.get("penalty", 10.0))
        min_seg = max(int(body.get("min_segment", 5)), 2)
        labels, series = load_series(body)

        if not series:
            return {"error": "Keine Daten verfügbar.", "_status": 400}

        all_cps = []
        per_series = []

        for s in series:
            vals = np.array([v if v is not None else 0.0 for v in s["values"]], dtype=float)
            if len(vals) < min_seg * 2:
                per_series.append({"keyword": s["keyword"], "changepoints": []})
                continue

            algo = ruptures.Pelt(model="rbf", min_size=min_seg).fit(vals)
            bkps = algo.predict(pen=penalty)
            cps = [b for b in bkps if b < len(vals)]

            detailed = []
            for idx in cps:
                seg_before = vals[max(0, idx - min_seg):idx]
                seg_after = vals[idx:min(len(vals), idx + min_seg)]
                mean_before = float(seg_before.mean()) if len(seg_before) > 0 else 0
                mean_after = float(seg_after.mean()) if len(seg_after) > 0 else 0
                delta = mean_after - mean_before
                detailed.append({
                    "idx": idx,
                    "date": labels[idx] if idx < len(labels) else None,
                    "keyword": s["keyword"],
                    "kwId": s["kwId"],
                    "mean_before": round(mean_before, 2),
                    "mean_after": round(mean_after, 2),
                    "delta": round(delta, 2),
                    "direction": "up" if delta >= 0 else "down",
                    "magnitude": round(abs(delta), 2),
                })
            per_series.append({"keyword": s["keyword"], "changepoints": detailed})
            all_cps.extend(detailed)

        all_cps.sort(key=lambda c: c["magnitude"], reverse=True)

        return {
            "changepoints": all_cps,
            "per_series": per_series,
            "total": len(all_cps),
            "penalty": penalty,
            "min_segment": min_seg,
            "summary": f"{len(all_cps)} Strukturbruch/brüche erkannt bei Penalty {penalty}, "
                       f"min. Segmentlänge {min_seg}, {len(series)} Reihe(n) analysiert.",
        }

    def _handle(self):
        from flask import request, jsonify
        body = request.get_json(force=True, silent=True) or {}
        result = self.compute(body)
        status = result.pop("_status", 200)
        return jsonify(result), status

PluginManager.register(CpdPlugin())
