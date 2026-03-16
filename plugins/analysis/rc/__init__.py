"""Analysis Plugin: Rolling Correlation."""
from plugins import PluginManager
from plugins.analysis import AnalysisPlugin

class RcPlugin(AnalysisPlugin):
    plugin_id = "rc"
    meta = {
        "label": "Rolling Correlation",
        "icon_svg": '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 20C7 16 11 8 21 4"/><path d="M3 4c4 4 8 12 18 16"/></svg>',
        "color": "#38bdf8",
        "symbol": "∿",
        "description": "Gleitende Korrelation zwischen zwei Zeitreihen.",
        "default_show_in": ["lab", "popup"],
        "button_id": "btn-rolling-corr",
        "requires_multi_kw": True,
        "modal_template": "rc/_modal.html",
        "popup_handler": "openRcForKw",

    }

    def api_routes(self):
        return [{"rule": "/api/rolling-correlation", "handler": self._handle, "methods": ["POST"]}]

    def compute(self, body):
        import numpy as np
        from plugins.analysis._helpers import load_series

        window = max(int(body.get("window", 30)), 5)
        phase_threshold = float(body.get("phase_threshold", 0.5))
        fixed_kw = body.get("fixed_keyword_id")
        labels, series = load_series(body)

        if not series or len(series) < 2:
            return {"error": "Mindestens 2 Keyword-Reihen erforderlich.", "_status": 400}

        def pearson_rolling(a, b, win):
            n = len(a)
            result = [None] * n
            half = win // 2
            for i in range(half, n - half):
                xs = a[i - half:i - half + win]
                ys = b[i - half:i - half + win]
                mask = ~(np.isnan(xs) | np.isnan(ys))
                if mask.sum() < 3:
                    continue
                xm, ym = xs[mask], ys[mask]
                mx, my = xm.mean(), ym.mean()
                dx, dy = xm - mx, ym - my
                denom = np.sqrt((dx ** 2).sum() * (dy ** 2).sum())
                result[i] = round(float((dx * dy).sum() / denom), 4) if denom > 1e-10 else None
            return result

        def detect_phases(corrs, thr):
            phases = []
            phase = None
            for i, c in enumerate(corrs):
                if c is None:
                    if phase:
                        phases.append(phase)
                        phase = None
                    continue
                cat = "pos" if c >= thr else "neg" if c <= -thr else "neutral"
                if not phase or phase["cat"] != cat:
                    if phase:
                        phases.append(phase)
                    phase = {"cat": cat, "start": i, "end": i, "r_sum": c, "count": 1}
                else:
                    phase["end"] = i
                    phase["r_sum"] += c
                    phase["count"] += 1
            if phase:
                phases.append(phase)
            return [{
                "cat": p["cat"],
                "start_idx": p["start"],
                "end_idx": p["end"],
                "start_date": labels[p["start"]] if p["start"] < len(labels) else None,
                "end_date": labels[p["end"]] if p["end"] < len(labels) else None,
                "avg_r": round(p["r_sum"] / p["count"], 4),
                "duration": p["end"] - p["start"] + 1,
            } for p in phases]

        pairs_result = []
        np_series = {s["kwId"]: np.array([v if v is not None else np.nan for v in s["values"]], dtype=float) for s in series}

        if fixed_kw is not None:
            fixed = next((s for s in series if s["kwId"] == fixed_kw), None)
            if not fixed:
                return {"error": "Fixiertes Keyword nicht gefunden.", "_status": 400}
            pair_list = [(fixed, s) for s in series if s["kwId"] != fixed_kw]
        else:
            pair_list = [(series[i], series[j])
                         for i in range(len(series)) for j in range(i + 1, len(series))]

        for a, b in pair_list[:20]:
            corrs = pearson_rolling(np_series[a["kwId"]], np_series[b["kwId"]], window)
            valid_corrs = [c for c in corrs if c is not None]
            avg_r = round(sum(valid_corrs) / len(valid_corrs), 4) if valid_corrs else None
            phases = detect_phases(corrs, phase_threshold)
            pairs_result.append({
                "keyword_a": a["keyword"],
                "keyword_b": b["keyword"],
                "avg_r": avg_r,
                "correlations": corrs,
                "phases": phases,
            })

        pairs_result.sort(key=lambda p: abs(p["avg_r"] or 0), reverse=True)

        return {
            "pairs": pairs_result,
            "window": window,
            "phase_threshold": phase_threshold,
            "summary": f"{len(pairs_result)} Keyword-Paar(e) analysiert, "
                       f"Fenstergröße {window}, {len(series)} Reihen.",
        }

    def _handle(self):
        from flask import request, jsonify
        body = request.get_json(force=True, silent=True) or {}
        result = self.compute(body)
        status = result.pop("_status", 200)
        return jsonify(result), status

PluginManager.register(RcPlugin())
