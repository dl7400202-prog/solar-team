# Row map and device location

Open Settings → Row installation plans → Map. Search by tracker number, pile-plan row number, recorded pile ID or string ID. Open a row card or its automatic pallet layout from the map. Source geometry is read from `solar_shared.data.siteMap` after the existing authenticated workspace access check. It is never bundled in this public repository.

The north-up map uses the imported module centres and recorded pile coordinates in metres, with pan, pinch, keyboard movement and zoom controls. Row strokes mark their centreline, not a surveyed panel width. Selecting a row focuses the source geometry. Groups retain the existing panel-type colours. No inverter layer or inverter card is added.

## GPS alignment

`siteMap.crs` must be confirmed from the original project before device fixes can be overlaid. A missing or unsupported CRS shows an alignment message and does not request location. Supported definitions are ETRS89 / UTM 32N (`EPSG:25832`) and WGS84 / UTM 32N (`EPSG:32632`). Never infer the CRS from coordinate magnitude. Other source systems require an explicitly verified definition before enabling them.

Proj4js 2.22.0 is vendored locally, with its MIT licence. Release archive SHA-256: `b4d87394be2e7e6cbee613df4dc835d965f6f857ff3ef244f25b7f7709cdc9ff`. Library SHA-256: `af7df653d91ea591f33d26fb958990bbd3071b2db644a4edaba441cc9861a474`. Definitions and longitude/latitude input order follow https://proj4js.org/.

## Location behaviour

My position starts `watchPosition` only after a user action, confirmed alignment and HTTPS. The browser or OS requests permission. A blue dot shows the latest device fix, with its reported accuracy circle and timestamp. Follow me recentres the map. Manual zoom or pan cancels following; Stop location clears the watch and dot. Permission denial, timeout, unsupported devices and missing positions have explicit recovery messages.

Fixes older than 30 seconds, invalid fixes, future timestamps and older out-of-order fixes are not displayed as current. Visibility changes pause the watch and remove its dot; returning resumes only the same previously enabled map session. Leaving the map, signing out or pagehide stops tracking. Late callbacks are ignored. No coordinates or route history are sent to Supabase, stored locally or shared with other devices.

The nearest row centreline is informational. Phone GPS accuracy can exceed the spacing between rows, so the physical row label remains the installation reference. Continuous background tracking is not provided.

## Verification

Run `node --test tests/site-map.test.cjs tests/row-plans.test.cjs tests/legacy-ux.test.cjs`. Browser verification covers authenticated viewer access, source searches and card navigation, projected marker updates, accuracy and following, permission failures, hidden/closed maps, zero writes and mobile widths. Native browser geolocation is exercised with controlled test positions. On-site alignment and real-phone accuracy still require confirmation against the project and a known row.
