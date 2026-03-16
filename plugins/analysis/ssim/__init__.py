"""Analysis Plugin: Self-Similarity Matrix."""
from plugins import PluginManager
from plugins.analysis import AnalysisPlugin

class SsimPlugin(AnalysisPlugin):
    plugin_id = "ssim"
    meta = {
        "label": "Self-Similarity Matrix",
        "icon_svg": '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
        "color": "#60a5fa",
        "symbol": "▣",
        "description": "Selbstähnlichkeitsmatrix zur Erkennung wiederkehrender Muster in Zeitreihen.",
        "default_show_in": ["popup"],
        "button_id": "",
        "requires_multi_kw": False,
        "modal_template": "ssim/_modal.html",
        "popup_handler": "openSsimForKw",

    }

    def api_routes(self):
        return [{"rule": "/api/self-similarity", "handler": self._handle, "methods": ["POST"]}]

    def compute(self, body):
        import numpy as np
        from plugins.analysis._helpers import load_series

        metric = body.get("metric", "diff")
        win_size = max(int(body.get("window", 7)), 3)
        labels, series = load_series(body)

        if not series:
            return {"error": "Keine Daten verfügbar.", "_status": 400}

        s = series[0]
        vals = np.array([v if v is not None else np.nan for v in s["values"]], dtype=float)
        n = len(vals)

        if n > 500:
            step = int(np.ceil(n / 500))
            vals = vals[::step]
            labels = labels[::step] if labels else []
            n = len(vals)

        mat = np.zeros((n, n))

        if metric == "corr":
            half_w = win_size // 2
            for i in range(n):
                for j in range(i + 1):
                    wi = vals[max(0, i - half_w):min(n, i + half_w + 1)]
                    wj = vals[max(0, j - half_w):min(n, j + half_w + 1)]
                    min_len = min(len(wi), len(wj))
                    wi, wj = wi[:min_len], wj[:min_len]
                    mask = ~(np.isnan(wi) | np.isnan(wj))
                    if mask.sum() < 3:
                        mat[i, j] = mat[j, i] = float("nan")
                        continue
                    xi, xj = wi[mask], wj[mask]
                    mx, mj = xi.mean(), xj.mean()
                    dx, dj = xi - mx, xj - mj
                    denom = np.sqrt((dx ** 2).sum() * (dj ** 2).sum())
                    r = float((dx * dj).sum() / denom) if denom > 1e-10 else 0.0
                    sim = (r + 1) / 2
                    mat[i, j] = mat[j, i] = sim
        else:
            for i in range(n):
                for j in range(i + 1):
                    vi, vj = vals[i], vals[j]
                    if np.isnan(vi) or np.isnan(vj):
                        mat[i, j] = mat[j, i] = float("nan")
                    else:
                        mat[i, j] = mat[j, i] = 1 - abs(vi - vj) / 100.0

        flat = [round(float(v), 3) if not np.isnan(v) else None
                for v in mat.flatten()]

        valid = mat[~np.isnan(mat)]
        avg_sim = round(float(valid.mean()), 4) if len(valid) > 0 else None
        min_sim = round(float(valid.min()), 4) if len(valid) > 0 else None
        max_sim = round(float(valid.max()), 4) if len(valid) > 0 else None

        high_sim_regions = []
        threshold_sim = 0.85
        block_size = max(5, n // 20)
        for i in range(0, n - block_size, block_size):
            for j in range(0, i, block_size):
                block = mat[i:i + block_size, j:j + block_size]
                block_valid = block[~np.isnan(block)]
                if len(block_valid) > 0 and float(block_valid.mean()) > threshold_sim:
                    high_sim_regions.append({
                        "region_a": labels[i] if i < len(labels) else f"idx {i}",
                        "region_b": labels[j] if j < len(labels) else f"idx {j}",
                        "avg_similarity": round(float(block_valid.mean()), 3),
                    })

        return {
            "keyword": s["keyword"],
            "matrix_size": n,
            "metric": metric,
            "window": win_size if metric == "corr" else None,
            "avg_similarity": avg_sim,
            "min_similarity": min_sim,
            "max_similarity": max_sim,
            "high_similarity_regions": high_sim_regions[:20],
            "matrix": flat,
            "labels": labels,
            "summary": f"Self-Similarity ({metric}): {n}×{n} Matrix, "
                       f"Ø Ähnlichkeit {avg_sim}, "
                       f"{len(high_sim_regions)} hochähnliche Regionen (>{threshold_sim}).",
        }

    def _handle(self):
        from flask import request, jsonify
        body = request.get_json(force=True, silent=True) or {}
        result = self.compute(body)
        status = result.pop("_status", 200)
        return jsonify(result), status

PluginManager.register(SsimPlugin())
