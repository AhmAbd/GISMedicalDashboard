import { pool } from "./db/pool.js";
import { isUuid } from "./uuid.js";

const validTypes = [
  "central_hospital",
  "clinic",
  "field_point",
];

function badQuery() {
  const error = new Error("INVALID_QUERY");
  error.status = 400;
  error.publicCode = "INVALID_QUERY";
  error.publicMessage = "قيم البحث غير صالحة";
  return error;
}

function readText(value) {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string") throw badQuery();
  return value;
}

export function readQuery(query) {
  const dateText = readText(query.at);
  let at = null;
  if (dateText) {
    const date = new Date(dateText);
    if (Number.isNaN(date.valueOf())) throw badQuery();
    at = date.toISOString();
  }

  const area = readText(query.governorate);
  if (area && !isUuid(area)) throw badQuery();

  const typeText = readText(query.facilityType);
  let types = null;
  if (typeText) {
    types = typeText.split(",").filter(Boolean);
    if (!types.length) throw badQuery();
    for (const type of types) {
      if (!validTypes.includes(type)) throw badQuery();
    }
  }

  let zoom = 8;
  if (query.zoom !== undefined) zoom = Number(query.zoom);
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 22) throw badQuery();

  return { at, area, types, zoom };
}

export async function getData(filters) {
  const result = await pool.query(
    `SELECT
      medical_facilities_geojson(
        $1::timestamptz, $2::uuid, $3::text[], $4::integer
      ) AS facilities,
      medical_ambulances_geojson($1::timestamptz, $2::uuid) AS ambulances,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object('id', g.id, 'nameAr', g.name_ar)
          ORDER BY g.name_ar
        )
        FROM governorates g
      ), '[]'::jsonb) AS governorates,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', e.id,
            'titleAr', e.title_ar,
            'location', ST_AsGeoJSON(e.location::geometry)::jsonb,
            'status', CASE
              WHEN $1::timestamptz IS NULL THEN e.status
              WHEN d.started_at <= $1::timestamptz THEN 'assigned'
              ELSE 'active'
            END,
            'createdAt', e.created_at
          )
          ORDER BY e.created_at DESC, e.id
        )
        FROM emergencies e
        LEFT JOIN dispatches d ON d.emergency_id = e.id
        WHERE ($2::uuid IS NULL OR e.governorate_id = $2::uuid)
          AND (
            ($1::timestamptz IS NULL AND e.status <> 'resolved')
            OR (
              $1::timestamptz IS NOT NULL
              AND e.created_at <= $1::timestamptz
              AND (d.completed_at IS NULL OR d.completed_at > $1::timestamptz)
            )
          )
      ), '[]'::jsonb) AS emergencies,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', a.id,
            'messageAr', a.message_ar,
            'createdAt', a.created_at
          )
          ORDER BY a.created_at DESC, a.id
        )
        FROM (
          SELECT a.id, a.message_ar, a.created_at
          FROM alerts a
          LEFT JOIN facilities f ON f.id = a.facility_id
          LEFT JOIN emergencies e ON e.id = a.emergency_id
          WHERE ($2::uuid IS NULL OR COALESCE(f.governorate_id, e.governorate_id) = $2::uuid)
            AND ($1::timestamptz IS NULL OR a.created_at <= $1::timestamptz)
          ORDER BY a.created_at DESC, a.id
          LIMIT 8
        ) a
      ), '[]'::jsonb) AS alerts,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', d.id,
            'route', ST_AsGeoJSON(d.route)::jsonb
          )
          ORDER BY d.started_at DESC, d.id
        )
        FROM dispatches d
        JOIN emergencies e ON e.id = d.emergency_id
        WHERE ($2::uuid IS NULL OR e.governorate_id = $2::uuid)
          AND (
            ($1::timestamptz IS NULL AND d.status = 'active')
            OR (
              $1::timestamptz IS NOT NULL
              AND d.started_at <= $1::timestamptz
              AND (d.completed_at IS NULL OR d.completed_at > $1::timestamptz)
            )
          )
      ), '[]'::jsonb) AS dispatches`,
    [filters.at, filters.area, filters.types, filters.zoom],
  );
  return result.rows[0];
}
