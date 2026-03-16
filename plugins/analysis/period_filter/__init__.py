"""Analysis Plugin: Periodizitäts-Filter."""
from plugins import PluginManager
from plugins.analysis import AnalysisPlugin

class PeriodFilterPlugin(AnalysisPlugin):
    plugin_id = "period_filter"
    meta = {
        "label": "Periodizitäts-Filter",
        "icon_svg": '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/></svg>',
        "color": "#14b8a6",
        "symbol": "∼",
        "description": "Spektralanalyse zur Erkennung periodischer Muster.",
        "modal_template": "period_filter/_modal.html",
        "default_show_in": ["lab"],
        "button_id": "btn-period-filter",

    }

    def api_routes(self):
        return [{"rule": "/api/periodicity", "handler": self._handle, "methods": ["POST"]}]

    def compute(self, body):
        import numpy as np
        from scipy.fft import rfft
        from plugins.analysis._helpers import load_series

        top_n = min(int(body.get("top_n", 12)), 30)
        labels, series = load_series(body)

        if not series:
            return {"error": "Keine Daten verfügbar.", "_status": 400}

        s = series[0]
        vals = np.array([v if v is not None else 0.0 for v in s["values"]], dtype=float)

        if len(vals) < 16:
            return {"error": "Mindestens 16 Datenpunkte erforderlich.", "_status": 400}

        # Schrittweite ermitteln
        step_hours = 24.0
        if labels and len(labels) >= 2:
            from datetime import datetime as _dt
            try:
                t0 = _dt.fromisoformat(str(labels[0]).replace("Z", "+00:00"))
                t1 = _dt.fromisoformat(str(labels[1]).replace("Z", "+00:00"))
                diff_h = abs((t1 - t0).total_seconds()) / 3600
                if diff_h > 0:
                    step_hours = diff_h
            except Exception:
                pass

        # Detrend
        mean = float(vals.mean())
        detrended = vals - mean

        # FFT
        N = len(detrended)
        spectrum = rfft(detrended)
        power = np.abs(spectrum) ** 2 / (N * N)

        # Bekannte technische Perioden
        KNOWN_TECH = [
            {"days": 7, "label": "7-Tage (wöchentliches Sampling)", "tolerance": 0.15},
            {"days": 3.5, "label": "3.5-Tage (Halb-Wochen-Harmonische)", "tolerance": 0.1},
            {"days": 1, "label": "24h (täglicher Zyklus)", "tolerance": 0.08},
        ]

        def is_technical(period_days):
            for t in KNOWN_TECH:
                if abs(period_days - t["days"]) / t["days"] <= t["tolerance"]:
                    return t
            return None

        # Spektrum aufbauen
        freq_list = []
        for k in range(1, len(power)):
            freq_per_step = k / N
            period_steps = 1.0 / freq_per_step if freq_per_step > 0 else float("inf")
            period_hours = period_steps * step_hours
            period_days = period_hours / 24.0
            freq_list.append({
                "k": k,
                "power": float(power[k]),
                "period_days": round(period_days, 3),
                "period_hours": round(period_hours, 2),
            })

        # Dominante Frequenzen
        freq_list.sort(key=lambda f: f["power"], reverse=True)
        max_power = freq_list[0]["power"] if freq_list else 1.0
        dominant = []
        for f in freq_list[:top_n]:
            tech = is_technical(f["period_days"])
            dominant.append({
                **f,
                "relative_power": round(f["power"] / max_power, 4),
                "technical": {"label": tech["label"]} if tech else None,
            })

        tech_count = sum(1 for d in dominant if d["technical"])
        natural = [d for d in dominant if not d["technical"]]

        return {
            "keyword": s["keyword"],
            "dominant_frequencies": dominant,
            "total_frequencies": len(dominant),
            "technical_count": tech_count,
            "step_hours": step_hours,
            "data_points": len(vals),
            "summary": f"{len(dominant)} dominante Frequenzen identifiziert, "
                       f"davon {tech_count} technische Artefakte. "
                       f"{len(vals)} Datenpunkte, Schrittweite {step_hours}h. "
                       f"Stärkste natürliche Periode: {natural[0]['period_days']:.1f} Tage"
                       if natural else f"{len(dominant)} Frequenzen, alle technisch.",
        }

    def _handle(self):
        from flask import request, jsonify
        body = request.get_json(force=True, silent=True) or {}
        result = self.compute(body)
        status = result.pop("_status", 200)
        return jsonify(result), status

PluginManager.register(PeriodFilterPlugin())
