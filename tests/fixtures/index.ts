import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { withSupabase } from 'jsr:@supabase/server@^1'

const site = {
  name: 'P223_Nagbøl',
  place: 'Solar Park Nagbøl',
  address: 'Nagbølvej 83A, 6640 Lunderskov',
  latitude: 55.46542811620679,
  longitude: 9.280072175497791,
}

const requiredParameters = ['temp_dry', 'humidity', 'wind_speed', 'wind_dir'] as const
type Parameter = typeof requiredParameters[number]
type Measurement = { value: number; observedAt: number }
type Station = {
  stationId: string
  latitude: number
  longitude: number
  measurements: Partial<Record<Parameter, Measurement>>
}

let cachedPayload: unknown = null
let cacheExpiresAt = 0

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': status === 200 ? 'private, max-age=300' : 'no-store',
    },
  })
}

function observationUrl(now = new Date()) {
  const from = new Date(now.getTime() - 4 * 60 * 60 * 1000)
  const url = new URL('https://opendataapi.dmi.dk/v2/metObs/collections/observation/items')
  url.searchParams.set('bbox', '9.0,55.25,9.55,55.7')
  url.searchParams.set('datetime', `${from.toISOString()}/${now.toISOString()}`)
  url.searchParams.set('limit', '1000')
  url.searchParams.set('sortorder', 'observed,DESC')
  return url
}

function precipitationUrl(now = new Date()) {
  const from = new Date(now.getTime() - 60 * 60 * 1000)
  const to = new Date(now.getTime() + 6 * 60 * 60 * 1000)
  const url = new URL('https://opendataapi.dmi.dk/v1/forecastedr/collections/harmonie_dini_sf/position')
  url.searchParams.set('coords', `POINT(${site.longitude} ${site.latitude})`)
  url.searchParams.set('crs', 'crs84')
  url.searchParams.set('parameter-name', 'total-precipitation')
  url.searchParams.set('datetime', `${from.toISOString()}/${to.toISOString()}`)
  url.searchParams.set('f', 'GeoJSON')
  return url
}

function precipitationFallbackUrl() {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(site.latitude))
  url.searchParams.set('longitude', String(site.longitude))
  url.searchParams.set('hourly', 'precipitation')
  url.searchParams.set('forecast_hours', '6')
  url.searchParams.set('timezone', 'UTC')
  url.searchParams.set('models', 'dmi_seamless')
  return url
}

async function precipitationFallbackNext6Hours() {
  const response = await fetch(precipitationFallbackUrl(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(7_000),
  })
  if (!response.ok) throw new Error(`DMI fallback forecast responded with ${response.status}`)
  const payload = await response.json()
  const values = Array.isArray(payload?.hourly?.precipitation)
    ? payload.hourly.precipitation.map(Number).filter(Number.isFinite)
    : []
  if (!values.length) throw new Error('DMI fallback forecast returned no precipitation values')
  const amount = values.reduce((sum: number, value: number) => sum + Math.max(0, value), 0)
  if (!Number.isFinite(amount) || amount > 1000) throw new Error('DMI fallback precipitation is outside the expected range')
  return Math.round(amount * 10) / 10
}

async function precipitationNext6Hours() {
  try {
    const response = await fetch(precipitationUrl(), {
      headers: { Accept: 'application/geo+json' },
      signal: AbortSignal.timeout(7_000),
    })
    if (!response.ok) throw new Error(`DMI forecast responded with ${response.status}`)
    const payload = await response.json()
    const points = (Array.isArray(payload?.features) ? payload.features : [])
      .map((feature: any) => ({
        step: Date.parse(feature?.properties?.step),
        value: Number(feature?.properties?.['total-precipitation']),
      }))
      .filter((point: any) => Number.isFinite(point.step) && Number.isFinite(point.value))
      .sort((a: any, b: any) => a.step - b.step)
    if (points.length < 2) throw new Error('DMI forecast returned too few precipitation steps')
    const amount = Math.max(0, points.at(-1)!.value - points[0].value)
    if (!Number.isFinite(amount) || amount > 1000) throw new Error('DMI forecast precipitation is outside the expected range')
    return Math.round(amount * 10) / 10
  } catch (error) {
    console.warn('DMI precipitation forecast unavailable', error)
    try {
      return await precipitationFallbackNext6Hours()
    } catch (fallbackError) {
      console.warn('DMI fallback precipitation forecast unavailable', fallbackError)
      return null
    }
  }
}

function distanceSquared(station: Station) {
  const longitudeScale = Math.cos(site.latitude * Math.PI / 180)
  const latitudeDistance = station.latitude - site.latitude
  const longitudeDistance = (station.longitude - site.longitude) * longitudeScale
  return latitudeDistance ** 2 + longitudeDistance ** 2
}

function nearestCompleteStation(features: any[]) {
  const stations = new Map<string, Station>()

  for (const feature of features) {
    const properties = feature?.properties ?? {}
    const parameterId = String(properties.parameterId ?? '') as Parameter
    if (!requiredParameters.includes(parameterId)) continue

    const stationId = String(properties.stationId ?? '')
    const value = Number(properties.value)
    const observedAt = Date.parse(properties.observed)
    const coordinates = feature?.geometry?.coordinates
    const longitude = Number(coordinates?.[0])
    const latitude = Number(coordinates?.[1])
    if (!stationId || !Number.isFinite(value) || !Number.isFinite(observedAt) ||
      !Number.isFinite(longitude) || !Number.isFinite(latitude)) continue

    const station = stations.get(stationId) ?? {
      stationId,
      latitude,
      longitude,
      measurements: {},
    }
    const current = station.measurements[parameterId]
    if (!current || observedAt > current.observedAt) {
      station.measurements[parameterId] = { value, observedAt }
    }
    stations.set(stationId, station)
  }

  return [...stations.values()]
    .filter((station) => requiredParameters.every((parameter) => station.measurements[parameter]))
    .sort((a, b) => distanceSquared(a) - distanceSquared(b))[0]
}

async function readWeather() {
  const now = Date.now()
  if (cachedPayload && now < cacheExpiresAt) return cachedPayload

  const response = await fetch(observationUrl(), {
    headers: { Accept: 'application/geo+json' },
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error(`DMI responded with ${response.status}`)

  const payload = await response.json()
  const features = Array.isArray(payload?.features) ? payload.features : []
  const station = nearestCompleteStation(features)
  if (!station) throw new Error('DMI returned no nearby station with complete observations')

  const temperature = station.measurements.temp_dry!
  const humidity = station.measurements.humidity!
  const windSpeed = station.measurements.wind_speed!
  const windDirection = station.measurements.wind_dir!
  const observedAt = Math.min(
    temperature.observedAt,
    humidity.observedAt,
    windSpeed.observedAt,
    windDirection.observedAt,
  )

  const precipitationMm = await precipitationNext6Hours()
  cachedPayload = {
    site,
    weather: {
      temperatureC: Math.round(temperature.value * 10) / 10,
      humidityPct: Math.round(humidity.value),
      windSpeedMs: Math.round(windSpeed.value * 10) / 10,
      windDirectionDeg: Math.round(windDirection.value),
      forecastAt: new Date(observedAt).toISOString(),
      precipitationMm,
      precipitationHours: precipitationMm === null ? null : 6,
    },
    station: {
      id: station.stationId,
      latitude: station.latitude,
      longitude: station.longitude,
    },
    source: 'DMI Meteorological Observation API',
  }
  cacheExpiresAt = now + 15 * 60 * 1000
  return cachedPayload
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request) => {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)

    try {
      return json(await readWeather())
    } catch (error) {
      console.error('DMI weather proxy failed', error)
      return json({ error: 'Weather data is temporarily unavailable' }, 502)
    }
  }),
}
