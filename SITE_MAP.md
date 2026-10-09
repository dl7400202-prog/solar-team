# Row map and device location

Open Settings → Row installation plans → Map. Search by tracker number, pile-plan row number, recorded pile ID or string ID. Open a row card or its automatic pallet layout from the map. Source geometry is read from `solar_shared.data.siteMap` after the existing authenticated workspace access check. It is never bundled in this public repository.

Choose Row plan or Satellite within the existing Map view. Row plan uses the imported module centres and recorded pile coordinates in metres, with pan, pinch, keyboard movement and zoom controls. Row strokes mark their centreline, not a surveyed panel width. Selecting a row focuses the source geometry. Groups retain the existing panel-type colours. The selection card includes panel groups and positive directions, motor and damper positions, and links to the full row and pallet layout. No inverter layer or inverter card is added.

Satellite loads the Google Maps JavaScript API on demand, after authenticated workspace access and a user click. It shows satellite/hybrid imagery, standard Google controls and attribution. The browser key is restricted to the Solar Team host and Maps JavaScript API; it is intentionally present in the web client and is not a server credential. The private key-creation record is not published. Google imagery is not cached by the service worker. Project billing activation and Google authorization must be valid. Network, timeout and authorization failures show a recovery message, while Row plan, search and row/pallet navigation remain usable.

## GPS alignment

`siteMap.crs` must be confirmed from the original project before row geometry can be placed on Google Maps or phone fixes can be overlaid on Row plan. A missing or unsupported CRS shows an alignment message. Row plan does not request location without alignment. Satellite can show the phone's native latitude/longitude independently, but draws no row or motor overlays until the source CRS is confirmed. With a confirmed CRS, field filters draw only the selected North/Mid/South geometry, tapping a row opens its selection card, and the selected row has a readable label. Supported definitions are ETRS89 / UTM 32N (`EPSG:25832`) and WGS84 / UTM 32N (`EPSG:32632`). Never infer the CRS from coordinate magnitude. Other source systems require an explicitly verified definition before enabling them.

Proj4js 2.22.0 is vendored locally, with its MIT licence. Release archive SHA-256: `b4d87394be2e7e6cbee613df4dc835d965f6f857ff3ef244f25b7f7709cdc9ff`. Library SHA-256: `af7df653d91ea591f33d26fb958990bbd3071b2db644a4edaba441cc9861a474`. Definitions and longitude/latitude input order follow https://proj4js.org/.

## Location behaviour

My position starts `watchPosition` only after a user action and HTTPS, with confirmed alignment in Row plan or a loaded Google map in Satellite. The browser or OS requests permission. A blue dot shows the latest device fix, with its reported accuracy circle and timestamp. Follow me recentres the map. Manual interaction cancels following; Stop location clears the watch and dot. Permission denial, timeout, unsupported devices and missing positions have explicit recovery messages.

Fixes older than 30 seconds, invalid fixes, future timestamps and older out-of-order fixes are not displayed as current. Visibility changes pause the watch and remove its dot; returning resumes only the same previously enabled map session. Switching map modes, leaving the map, signing out or pagehide stops tracking. Late GPS and Google load callbacks are ignored. No device coordinates or route history are sent to Supabase, stored locally or shared with other Solar Team devices. Google Maps receives map requests for the displayed viewport, including when following the phone; its standard service terms and privacy policy apply.

The nearest row centreline is informational. Phone GPS accuracy can exceed the spacing between rows, so the physical row label remains the installation reference. Continuous background tracking is not provided.

## Verification

Run `node --test tests/google-map.test.cjs tests/site-map.test.cjs tests/row-plans.test.cjs tests/legacy-ux.test.cjs`. Browser verification covers authenticated viewer access, source searches and card navigation, projected marker updates, accuracy and following, permission failures, hidden/closed maps, zero writes and mobile widths. Native browser geolocation is exercised with controlled test positions. Google boundary checks cover on-demand loading, missing configuration, timeout/network/auth failures, confirmed/unknown CRS, field filters, row selection and late callbacks. These controlled checks do not establish live Google billing readiness. On-site alignment and real-phone accuracy still require confirmation against the project and a known row.
