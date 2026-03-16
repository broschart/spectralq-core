"""Analysis Plugin: Auto Correlate."""
from plugins import PluginManager
from plugins.analysis import AnalysisPlugin

class AutoCorrPlugin(AnalysisPlugin):
    plugin_id = "auto_corr"
    meta = {
        "label": "Auto Correlate",
        "icon_svg": '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 3"/></svg>',
        "color": "#f472b6",
        "symbol": "⟳",
        "description": "Automatische Erkennung der am stärksten korrelierten Keywords.",
        "default_show_in": ["popup"],
        "button_id": "",
        "requires_multi_kw": False,
        "popup_handler": "openAutoCorrForKw",

    }

    def api_routes(self):
        return [{"rule": "/api/auto-correlate/<int:kw_id>", "handler": self._handle, "methods": ["GET"]}]

    def compute(self, body):
        import numpy as np
        from models import Keyword, TrendData, db

        kw_id = body.get("kw_id")
        user_id = body.get("user_id")
        top_n = min(int(body.get("n", 3)), 7)

        if not kw_id or not user_id:
            return {"error": "kw_id und user_id erforderlich.", "_status": 400}

        ref_kw = Keyword.query.filter_by(id=kw_id, user_id=user_id).first()
        if not ref_kw:
            return {"error": "Keyword nicht gefunden.", "_status": 404}

        def _latest_tag(kid):
            row = (db.session.query(TrendData.run_tag)
                   .filter_by(keyword_id=kid)
                   .order_by(TrendData.date.desc())
                   .first())
            return row[0] if row else ""

        def _load_kw_series(kid):
            tag = _latest_tag(kid)
            return (TrendData.query.filter_by(keyword_id=kid, run_tag=tag)
                    .order_by(TrendData.date).all())

        def _to_date_map(data_list):
            return {td.date.strftime("%Y-%m-%d %H:%M") if hasattr(td.date, 'strftime')
                    else str(td.date): td.value for td in data_list}

        ref_data = _load_kw_series(kw_id)
        if len(ref_data) < 5:
            return {"error": "Zu wenige Datenpunkte für Korrelationsanalyse.", "_status": 400}

        ref_dates = _to_date_map(ref_data)

        all_kws = Keyword.query.filter(
            Keyword.user_id == user_id,
            Keyword.id != kw_id
        ).all()

        results = []
        for kw in all_kws:
            kw_data = _load_kw_series(kw.id)
            if len(kw_data) < 5:
                continue

            kw_dates = _to_date_map(kw_data)
            common = sorted(set(ref_dates.keys()) & set(kw_dates.keys()))
            if len(common) < 5:
                continue

            ref_vals = np.array([ref_dates[d] for d in common], dtype=float)
            kw_vals = np.array([kw_dates[d] for d in common], dtype=float)

            if ref_vals.std() == 0 or kw_vals.std() == 0:
                continue
            r = float(np.corrcoef(ref_vals, kw_vals)[0, 1])
            if np.isnan(r):
                continue

            max_lag = min(len(common) // 3, 30)
            best_lag = 0
            best_lag_r = r
            for lag in range(-max_lag, max_lag + 1):
                if lag == 0:
                    continue
                xs, ys = [], []
                for idx in range(len(common)):
                    j_idx = idx - lag
                    if 0 <= j_idx < len(common):
                        xs.append(ref_vals[idx])
                        ys.append(kw_vals[j_idx])
                if len(xs) < 5:
                    continue
                xs_a, ys_a = np.array(xs), np.array(ys)
                if xs_a.std() == 0 or ys_a.std() == 0:
                    continue
                lag_r = float(np.corrcoef(xs_a, ys_a)[0, 1])
                if not np.isnan(lag_r) and abs(lag_r) > abs(best_lag_r):
                    best_lag_r = lag_r
                    best_lag = lag

            results.append({
                "id": kw.id,
                "keyword": kw.keyword,
                "geo": kw.geo,
                "correlation": round(r, 4),
                "abs_correlation": round(abs(r), 4),
                "common_points": len(common),
                "best_lag": best_lag,
                "best_lag_r": round(best_lag_r, 4),
            })

        results.sort(key=lambda x: x["abs_correlation"], reverse=True)

        return {
            "reference": {"id": ref_kw.id, "keyword": ref_kw.keyword},
            "top": results[:top_n],
            "total_compared": len(results),
        }

    def _handle(self, kw_id):
        from flask import request, jsonify
        from flask_login import current_user
        body = {
            "kw_id": kw_id,
            "user_id": current_user.id,
            "n": request.args.get("n", 3),
        }
        result = self.compute(body)
        status = result.pop("_status", 200)
        return jsonify(result), status

PluginManager.register(AutoCorrPlugin())
