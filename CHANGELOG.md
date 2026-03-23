# Changelog

All notable changes to spectralQ Core Edition will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.1] - 2026-03-23

Sync with Enterprise 0.921 (post-refactoring).

### Changed

- **Plugin architecture** — plugin-specific routes and scheduler jobs migrated from app.py into plugin directories
  - Website plugin: `snapshot-diff` and `tracker-reverse-lookup` routes now in `website/_routes.py`
  - Satoverpass plugin: TLE refresh scheduler now via `scheduler_jobs()` method
  - Telegram monitor plugin: cache cleanup scheduler now via `scheduler_jobs()` method
- **New `scheduler_jobs()` hook** in WatchZonePlugin base class — plugins can register their own scheduler jobs (analogous to `api_routes()`)
- **Credential mapping** — plugins declare `credential_group` in meta instead of hardcoded mapping in app.py
- **Source availability** — plugins declare `availability_key` in meta instead of naming convention hack

## [1.1.0] - 2026-03-23

Sync with Enterprise 0.921. All Watch Zone and Analysis plugins updated.

### Added

- **Map styles** — switchable map tile layers (Street, Dark, Light, Satellite, Terrain, OpenStreetMap) across all Watch Zone maps
- **Distance measurement** — press `D` on any map to measure distances between two points with travel time estimates (walking, bicycle, car, plane)
- **Time Focus location marker** — shared map marker for event-linked Watch Zones
- **Plugin search** on the Plugins management page
- **Autocorrelation analysis** — new templates for the auto_corr analysis plugin
- **New dependencies**: numpy, pandas, requests, beautifulsoup4, lxml (used by core plugins)

### Changed

- **Watch Zone UI overhaul** — new accent color (accent3/mint) for WZ elements, 3-column zone grid layout with responsive breakpoints, fullwidth live view, help drawer with plugin documentation, zone context menu
- **Fullscreen mode** replaced with browser-native fullscreen (was CSS-only wide mode)
- **Events page** — Leaflet maps integrated, project selector for events, flexible date/time inputs with calendar pickers, translation suggestions in event search, collapsible filter section
- **Analysis page** — Desk/Keywords tab layout, dynamic Watch Zone analysis providers for triangulation
- **Start page** — updated hero section with tagline, intro video link, and about link
- **All 22 Watch Zone plugins** updated — improved JS renderers, i18n additions, panel template enhancements, backend improvements across acled, aircraft, airquality, bluesky_monitor, celltowers, censys, certwatch, migration, ndvi, nightlights, osm_changes, powergrid, radiation, satellite, seismic, telegram_monitor, traffic, vessel, wayback_cdx, weather, website, wikipedia
- **All 11 Analysis plugins** updated — improved computation and rendering for auto_corr, cluster, cpd, decomp, forecast, granger, outlier, period_filter, rc, spike_coin, ssim
- **Plugin system** — dynamic credential mapping, improved plugin discovery
- **Help pages** (all 4 languages) updated with comprehensive Watch Zone plugin documentation
- **Technical documentation** and **Plugin Development Guide** updated with new plugin features and architecture details
- **Admin page** — third accent color (Mint) for Watch Zone theming
- **Projects page** — improved layout and functionality
- **Keywords page** — expanded country list

### Fixed

- **CertWatch** — improved reliability and timeout handling for crt.sh queries
- **Website plugin** — enhanced transport layer and change detection
- **Wikipedia plugin** — backend improvements for edit monitoring
- **Radiation plugin** — improved data source handling (BfS + EURDEP)

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
