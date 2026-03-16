# Changelog

All notable changes to spectralQ Core Edition will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-03-16

Initial open-source release of spectralQ Core Edition.

### Added

- **Core platform** with Flask-based web application, SQLite database, and APScheduler for background data fetching
- **21 Watch Zone plugins**: seismic, radiation, weather, satellite, nightlights, migration, NDVI, website/Wayback, aircraft, vessel, traffic, cell towers, air quality, power grid, ACLED, OSM changes, Telegram monitor, Bluesky monitor, CertWatch, Wayback CDX, Wikipedia, Censys
- **9 Analysis plugins**: forecast (Prophet), outlier detection, change point detection, Granger causality, rolling correlation, FFT/period filter, spike coincidence, self-similarity (SSIM), RQ cluster
- **Plugin architecture** with auto-discovery, self-contained templates, static assets, and i18n per plugin
- **Multilingual support** for German, English, French, and Spanish
- **Alert system** with pluggable transport layer for notifications
- **User authentication** with Flask-Login and bcrypt
- **Interactive maps** with Leaflet and per-plugin map overlays
- **Chart visualizations** with Chart.js and Matplotlib export
- **Docker support** with Dockerfile and docker-compose.yml
- **AGPL-3.0 license** with Plugin Exception for third-party plugin licensing flexibility
