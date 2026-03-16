"""Analysis Plugin: Forecasting."""
import logging

from plugins import PluginManager
from plugins.analysis import AnalysisPlugin

log = logging.getLogger(__name__)

class ForecastPlugin(AnalysisPlugin):
    plugin_id = "forecast"
    meta = {
        "label": "Forecasting",
        "icon_svg": '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><polyline points="3,17 9,11 13,15 21,7"/><polyline points="16,7 21,7 21,12"/></svg>',
        "color": "#22d3ee",
        "symbol": "📈",
        "description": "Zeitreihen-Prognose basierend auf historischen Daten.",
        "default_show_in": ["popup"],
        "button_id": "",
        "requires_multi_kw": False,
        "modal_template": "forecast/_modal.html",
        "popup_handler": "openFcForKw",

    }

    def api_routes(self):
        return [{"rule": "/api/forecast", "handler": self._handle, "methods": ["POST"]}]

    def compute(self, body):
        import warnings
        warnings.filterwarnings("ignore")

        import pandas as pd
        import numpy as np

        model_type = (body.get("model") or "prophet").strip().lower()
        horizon = min(max(int(body.get("horizon", 30)), 1), 365)
        data_points = body.get("data", [])

        if not data_points or len(data_points) < 10:
            return {"error": "Mindestens 10 Datenpunkte erforderlich.", "_status": 400}

        df = pd.DataFrame(data_points)
        df["date"] = pd.to_datetime(df["date"], format="ISO8601")
        df = df.dropna(subset=["value"]).sort_values("date").reset_index(drop=True)

        if len(df) < 10:
            return {"error": "Zu wenige gültige Datenpunkte.", "_status": 400}

        diffs = df["date"].diff().dropna().dt.total_seconds()
        median_diff = diffs.median()
        if median_diff < 7200:
            freq = "h"
        elif median_diff < 172800:
            freq = "D"
        elif median_diff < 1209600:
            freq = "W"
        else:
            freq = "MS"

        try:
            if model_type == "prophet":
                from prophet import Prophet
                logging.getLogger("prophet").setLevel(logging.WARNING)
                logging.getLogger("cmdstanpy").setLevel(logging.WARNING)

                pdf = df.rename(columns={"date": "ds", "value": "y"})
                m = Prophet(
                    yearly_seasonality="auto",
                    weekly_seasonality=(freq in ("D", "h")),
                    daily_seasonality=(freq == "h"),
                    changepoint_prior_scale=0.05,
                )
                m.fit(pdf)

                if freq == "h":
                    future = m.make_future_dataframe(periods=horizon, freq="h")
                elif freq == "D":
                    future = m.make_future_dataframe(periods=horizon)
                elif freq == "W":
                    future = m.make_future_dataframe(periods=horizon, freq="W")
                else:
                    future = m.make_future_dataframe(periods=horizon, freq="MS")

                forecast = m.predict(future)
                fc = forecast.tail(horizon)

                return {
                    "model": "Prophet",
                    "horizon": horizon,
                    "freq": freq,
                    "forecast": [
                        {
                            "date": row.ds.strftime("%Y-%m-%d %H:%M") if freq == "h" else row.ds.strftime("%Y-%m-%d"),
                            "yhat": round(float(row.yhat), 2),
                            "yhat_lower": round(float(row.yhat_lower), 2),
                            "yhat_upper": round(float(row.yhat_upper), 2),
                        }
                        for _, row in fc.iterrows()
                    ],
                    "changepoints": [
                        cp.strftime("%Y-%m-%d") for cp in m.changepoints
                    ] if hasattr(m, "changepoints") else [],
                }

            elif model_type == "arima":
                from statsmodels.tsa.arima.model import ARIMA

                values = df["value"].values.astype(float)
                order = (2, 1, 2) if len(values) > 50 else (1, 1, 1)

                try:
                    model = ARIMA(values, order=order)
                    fit = model.fit()
                except Exception:
                    order = (1, 1, 0)
                    model = ARIMA(values, order=order)
                    fit = model.fit()

                fc = fit.get_forecast(steps=horizon)
                fc_mean = fc.predicted_mean
                fc_ci = fc.conf_int(alpha=0.05)

                last_date = df["date"].iloc[-1]
                if freq == "h":
                    future_dates = pd.date_range(last_date, periods=horizon + 1, freq="h")[1:]
                elif freq == "D":
                    future_dates = pd.date_range(last_date, periods=horizon + 1, freq="D")[1:]
                elif freq == "W":
                    future_dates = pd.date_range(last_date, periods=horizon + 1, freq="W")[1:]
                else:
                    future_dates = pd.date_range(last_date, periods=horizon + 1, freq="MS")[1:]

                fmt = "%Y-%m-%d %H:%M" if freq == "h" else "%Y-%m-%d"
                return {
                    "model": f"ARIMA{order}",
                    "horizon": horizon,
                    "freq": freq,
                    "forecast": [
                        {
                            "date": future_dates[i].strftime(fmt),
                            "yhat": round(float(fc_mean.iloc[i]), 2),
                            "yhat_lower": round(float(fc_ci.iloc[i, 0]), 2),
                            "yhat_upper": round(float(fc_ci.iloc[i, 1]), 2),
                        }
                        for i in range(min(horizon, len(future_dates)))
                    ],
                    "aic": round(float(fit.aic), 1),
                    "bic": round(float(fit.bic), 1),
                }

            else:
                return {"error": f"Unbekanntes Modell: {model_type}", "_status": 400}

        except Exception as e:
            log.exception("Forecast-Fehler")
            return {"error": f"Prognose fehlgeschlagen: {str(e)}", "_status": 500}

    def _handle(self):
        from flask import request, jsonify
        body = request.get_json(force=True, silent=True) or {}
        result = self.compute(body)
        status = result.pop("_status", 200)
        return jsonify(result), status

PluginManager.register(ForecastPlugin())
