"""Analysis Plugin: Granger-Kausalität."""
from plugins import PluginManager
from plugins.analysis import AnalysisPlugin

class GrangerPlugin(AnalysisPlugin):
    plugin_id = "granger"
    meta = {
        "label": "Granger-Kausalität",
        "icon_svg": '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5 12h14"/><polyline points="15,8 19,12 15,16"/><path d="M19 12h-14"/><polyline points="9,8 5,12 9,16"/></svg>',
        "color": "#e879f9",
        "symbol": "⇄",
        "description": "Granger-Kausalitätstest zwischen Zeitreihen.",
        "modal_template": "granger/_modal.html",
        "default_show_in": ["lab"],
        "button_id": "btn-granger",

    }

    def api_routes(self):
        return [{"rule": "/api/granger", "handler": self._handle, "methods": ["POST"]}]

    def compute(self, body):
        import warnings
        warnings.filterwarnings("ignore")

        import numpy as np
        from statsmodels.tsa.stattools import grangercausalitytests

        max_lag = min(max(int(body.get("max_lag", 5)), 1), 20)
        pairs = body.get("pairs", [])

        if not pairs:
            return {"error": "Keine Keyword-Paare übermittelt.", "_status": 400}

        results = []
        for pair in pairs[:20]:
            nameA = pair.get("nameA", "A")
            nameB = pair.get("nameB", "B")
            vA = [v if v is not None else 0.0 for v in pair.get("valuesA", [])]
            vB = [v if v is not None else 0.0 for v in pair.get("valuesB", [])]

            if len(vA) != len(vB) or len(vA) < max_lag + 3:
                continue

            for direction, d_data, cause, effect in [
                ("B→A", np.column_stack([vA, vB]), nameB, nameA),
                ("A→B", np.column_stack([vB, vA]), nameA, nameB),
            ]:
                try:
                    gc = grangercausalitytests(d_data, maxlag=max_lag, verbose=False)
                    best_lag = None
                    best_p = 1.0
                    best_f = 0.0
                    lag_results = []
                    for lag in range(1, max_lag + 1):
                        test = gc[lag][0]
                        f_val = test["ssr_ftest"][0]
                        p_val = test["ssr_ftest"][1]
                        lag_results.append({
                            "lag": lag,
                            "f": round(float(f_val), 3),
                            "p": round(float(p_val), 6),
                        })
                        if p_val < best_p:
                            best_p = p_val
                            best_f = f_val
                            best_lag = lag

                    sig = "***" if best_p < 0.001 else "**" if best_p < 0.01 else "*" if best_p < 0.05 else ""
                    results.append({
                        "cause": cause,
                        "effect": effect,
                        "direction": f"{cause} → {effect}",
                        "best_lag": best_lag,
                        "best_p": round(float(best_p), 6),
                        "best_f": round(float(best_f), 3),
                        "significant": bool(best_p < 0.05),
                        "sig_label": sig,
                        "lags": lag_results,
                    })
                except Exception:
                    pass

        results.sort(key=lambda r: r["best_p"])
        return {"results": results, "max_lag": max_lag}

    def _handle(self):
        from flask import request, jsonify
        body = request.get_json(force=True, silent=True) or {}
        result = self.compute(body)
        status = result.pop("_status", 200)
        return jsonify(result), status

PluginManager.register(GrangerPlugin())
