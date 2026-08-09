CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS governorates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  governorate_id uuid NOT NULL REFERENCES governorates(id) ON DELETE CASCADE,
  name_ar text NOT NULL,
  type text NOT NULL CHECK (type IN ('central_hospital', 'clinic', 'field_point')),
  location geography(Point, 4326) NOT NULL,
  total_beds integer NOT NULL CHECK (total_beds > 0),
  occupied_beds integer NOT NULL CHECK (
    occupied_beds >= 0 AND occupied_beds <= total_beds
  ),
  available_beds integer GENERATED ALWAYS AS (
    total_beds - occupied_beds
  ) STORED,
  occupancy numeric(5, 2) GENERATED ALWAYS AS (
    round(occupied_beds::numeric / total_beds * 100, 2)
  ) STORED,
  status text GENERATED ALWAYS AS (
    CASE
      WHEN occupied_beds::numeric / total_beds * 100 > 90 THEN 'red'
      ELSE 'green'
    END
  ) STORED CHECK (status IN ('green', 'red'))
);

CREATE TABLE IF NOT EXISTS ambulances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  governorate_id uuid NOT NULL REFERENCES governorates(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  position geography(Point, 4326) NOT NULL,
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'dispatched')),
  speed_mps numeric(6, 2) NOT NULL DEFAULT 18 CHECK (speed_mps > 0)
);

CREATE TABLE IF NOT EXISTS emergencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  governorate_id uuid NOT NULL REFERENCES governorates(id) ON DELETE CASCADE,
  title_ar text NOT NULL,
  location geography(Point, 4326) NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'assigned', 'resolved')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emergency_id uuid NOT NULL UNIQUE REFERENCES emergencies(id) ON DELETE CASCADE,
  ambulance_id uuid NOT NULL REFERENCES ambulances(id) ON DELETE CASCADE,
  route geometry(LineString, 4326) NOT NULL,
  distance_m double precision NOT NULL CHECK (distance_m >= 0),
  progress double precision NOT NULL DEFAULT 0 CHECK (
    progress >= 0 AND progress <= 1
  ),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('facility_red', 'emergency')),
  facility_id uuid REFERENCES facilities(id) ON DELETE CASCADE,
  emergency_id uuid REFERENCES emergencies(id) ON DELETE CASCADE,
  message_ar text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((facility_id IS NOT NULL)::integer + (emergency_id IS NOT NULL)::integer = 1)
);

CREATE TABLE IF NOT EXISTS facility_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  total_beds integer NOT NULL,
  occupied_beds integer NOT NULL,
  available_beds integer NOT NULL,
  occupancy numeric(5, 2) NOT NULL,
  status text NOT NULL CHECK (status IN ('green', 'red')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS ambulance_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ambulance_id uuid NOT NULL REFERENCES ambulances(id) ON DELETE CASCADE,
  position geography(Point, 4326) NOT NULL,
  status text NOT NULL CHECK (status IN ('available', 'dispatched')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS socket_io_attachments (
  id bigserial UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  payload bytea
);

CREATE UNIQUE INDEX IF NOT EXISTS dispatches_one_active_ambulance_idx
  ON dispatches (ambulance_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS dispatches_ambulance_idx
  ON dispatches (ambulance_id);
CREATE INDEX IF NOT EXISTS facilities_location_gist
  ON facilities USING gist (location);
CREATE INDEX IF NOT EXISTS facilities_governorate_type_idx
  ON facilities (governorate_id, type);
CREATE INDEX IF NOT EXISTS ambulances_position_gist
  ON ambulances USING gist (position);
CREATE INDEX IF NOT EXISTS ambulances_governorate_status_idx
  ON ambulances (governorate_id, status);
CREATE INDEX IF NOT EXISTS emergencies_location_gist
  ON emergencies USING gist (location);
CREATE INDEX IF NOT EXISTS emergencies_governorate_status_idx
  ON emergencies (governorate_id, status);
CREATE INDEX IF NOT EXISTS emergencies_status_created_idx
  ON emergencies (status, created_at DESC);
CREATE INDEX IF NOT EXISTS dispatches_route_gist
  ON dispatches USING gist (route);
CREATE INDEX IF NOT EXISTS dispatches_status_started_idx
  ON dispatches (status, started_at DESC);
CREATE INDEX IF NOT EXISTS alerts_facility_idx
  ON alerts (facility_id);
CREATE INDEX IF NOT EXISTS alerts_emergency_idx
  ON alerts (emergency_id);
CREATE INDEX IF NOT EXISTS alerts_created_idx
  ON alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS facility_history_entity_time_idx
  ON facility_history (facility_id, recorded_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ambulance_history_position_gist
  ON ambulance_history USING gist (position);
CREATE INDEX IF NOT EXISTS ambulance_history_entity_time_idx
  ON ambulance_history (ambulance_id, recorded_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS socket_io_attachments_created_idx
  ON socket_io_attachments (created_at);

CREATE OR REPLACE FUNCTION alert_new_emergency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO alerts (kind, emergency_id, message_ar)
  VALUES ('emergency', NEW.id, 'حالة طارئة جديدة: ' || NEW.title_ar);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION capture_facility_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR (OLD.total_beds, OLD.occupied_beds)
        IS DISTINCT FROM
        (NEW.total_beds, NEW.occupied_beds) THEN
    INSERT INTO facility_history (
      facility_id, total_beds, occupied_beds,
      available_beds, occupancy, status, recorded_at
    ) VALUES (
      NEW.id, NEW.total_beds, NEW.occupied_beds,
      NEW.available_beds, NEW.occupancy, NEW.status, clock_timestamp()
    );
  END IF;

  IF NEW.status = 'red'
     AND (TG_OP = 'INSERT' OR OLD.status = 'green') THEN
    INSERT INTO alerts (kind, facility_id, message_ar)
    VALUES (
      'facility_red',
      NEW.id,
      'تجاوز إشغال ' || NEW.name_ar || ' نسبة 90٪'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION capture_ambulance_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR (OLD.position, OLD.status) IS DISTINCT FROM (NEW.position, NEW.status) THEN
    INSERT INTO ambulance_history (ambulance_id, position, status, recorded_at)
    VALUES (NEW.id, NEW.position, NEW.status, clock_timestamp());
  END IF;
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS dispatch_nearest_ambulance(uuid);

CREATE FUNCTION dispatch_nearest_ambulance(p_emergency_id uuid)
RETURNS TABLE (
  dispatch_id uuid,
  ambulance_id uuid,
  distance_m double precision,
  route_geojson jsonb
)
LANGUAGE plpgsql
AS $$
DECLARE
  car_id uuid;
  car_point geography(Point, 4326);
  case_point geography(Point, 4326);
  metres double precision;
  job_id uuid;
  line geometry(LineString, 4326);
BEGIN
  SELECT e.location
  INTO case_point
  FROM emergencies e
  WHERE e.id = p_emergency_id AND e.status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM emergencies WHERE id = p_emergency_id) THEN
      RAISE EXCEPTION 'EMERGENCY_NOT_ACTIVE' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'EMERGENCY_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT a.id, a.position, ST_Distance(a.position, case_point)
  INTO car_id, car_point, metres
  FROM ambulances a
  WHERE a.status = 'available'
  ORDER BY ST_Distance(a.position, case_point), a.id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NO_AMBULANCE_AVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  line = ST_MakeLine(car_point::geometry, case_point::geometry);

  INSERT INTO dispatches (
    emergency_id, ambulance_id, route, distance_m
  ) VALUES (
    p_emergency_id, car_id, line, metres
  )
  RETURNING id INTO job_id;

  UPDATE ambulances
  SET status = 'dispatched'
  WHERE id = car_id;

  UPDATE emergencies
  SET status = 'assigned'
  WHERE id = p_emergency_id;

  RETURN QUERY SELECT
    job_id,
    car_id,
    metres,
    ST_AsGeoJSON(line)::jsonb;
END;
$$;

DROP FUNCTION IF EXISTS advance_ambulances(double precision);

CREATE FUNCTION advance_ambulances(p_elapsed_seconds double precision DEFAULT 2)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  item record;
  done double precision;
  point geometry(Point, 4326);
BEGIN
  IF p_elapsed_seconds <= 0 THEN
    RAISE EXCEPTION 'ELAPSED_SECONDS_MUST_BE_POSITIVE';
  END IF;

  FOR item IN
    SELECT
      d.id AS dispatch_id,
      d.emergency_id,
      d.ambulance_id,
      d.route,
      d.distance_m,
      d.progress,
      a.speed_mps
    FROM dispatches d
    JOIN ambulances a ON a.id = d.ambulance_id
    WHERE d.status = 'active'
    ORDER BY d.started_at, d.id
    FOR UPDATE OF d, a
  LOOP
    done = CASE
      WHEN item.distance_m = 0 THEN 1
      ELSE LEAST(
        1,
        item.progress + item.speed_mps::double precision
        * p_elapsed_seconds / item.distance_m
      )
    END;
    point = ST_LineInterpolatePoint(item.route, done);

    UPDATE dispatches
    SET
      progress = done,
      status = CASE WHEN done = 1 THEN 'completed' ELSE 'active' END,
      completed_at = CASE WHEN done = 1 THEN clock_timestamp() END
    WHERE id = item.dispatch_id;

    UPDATE ambulances
    SET
      position = point::geography,
      status = CASE WHEN done = 1 THEN 'available' ELSE 'dispatched' END
    WHERE id = item.ambulance_id;

    IF done = 1 THEN
      UPDATE emergencies SET status = 'resolved' WHERE id = item.emergency_id;
    END IF;
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS medical_facilities_geojson(timestamptz, uuid, text[], integer);

CREATE FUNCTION medical_facilities_geojson(
  p_at timestamptz DEFAULT NULL,
  p_governorate_id uuid DEFAULT NULL,
  p_facility_types text[] DEFAULT NULL,
  p_zoom integer DEFAULT 8
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
WITH data AS (
  SELECT
    f.id, f.governorate_id, f.name_ar, f.type, f.location,
    f.total_beds, f.occupied_beds, f.available_beds, f.occupancy, f.status
  FROM facilities f
  WHERE p_at IS NULL

  UNION ALL

  SELECT
    f.id, f.governorate_id, f.name_ar, f.type, f.location,
    h.total_beds, h.occupied_beds, h.available_beds, h.occupancy, h.status
  FROM facilities f
  JOIN LATERAL (
    SELECT history.*
    FROM facility_history history
    WHERE history.facility_id = f.id
        AND history.recorded_at <= p_at
    ORDER BY history.recorded_at DESC, history.id DESC
    LIMIT 1
  ) h ON true
  WHERE p_at IS NOT NULL
),
shown AS (
  SELECT *
  FROM data
  WHERE (p_governorate_id IS NULL OR governorate_id = p_governorate_id)
    AND (p_facility_types IS NULL OR type = ANY(p_facility_types))
),
grouped AS (
  SELECT
    shown.*,
    CASE
      WHEN COALESCE(p_zoom, 8) < 13 THEN ST_ClusterDBSCAN(
        ST_Transform(location::geometry, 3857),
        CASE
          WHEN COALESCE(p_zoom, 8) <= 6 THEN 120000
          WHEN COALESCE(p_zoom, 8) <= 8 THEN 50000
          WHEN COALESCE(p_zoom, 8) <= 10 THEN 20000
          ELSE 7000
        END,
        2
      ) OVER ()
    END AS cluster_id
  FROM shown
),
items AS (
  SELECT
    id::text AS sort_key,
    jsonb_build_object(
      'type', 'Feature',
      'geometry', ST_AsGeoJSON(location::geometry)::jsonb,
      'properties', jsonb_build_object(
        'kind', 'facility',
        'id', id,
        'nameAr', name_ar,
        'type', type,
        'status', status,
        'availableBeds', available_beds,
        'occupancy', occupancy
      )
    ) AS feature
  FROM grouped
  WHERE cluster_id IS NULL

  UNION ALL

  SELECT
    'cluster-' || cluster_id,
    jsonb_build_object(
      'type', 'Feature',
      'geometry', ST_AsGeoJSON(ST_Centroid(ST_Collect(location::geometry)))::jsonb,
      'properties', jsonb_build_object(
        'kind', 'cluster',
        'id', 'cluster-' || cluster_id,
        'count', count(*),
        'status', CASE WHEN bool_or(status = 'red') THEN 'red' ELSE 'green' END,
        'redCount', count(*) FILTER (WHERE status = 'red'),
        'greenCount', count(*) FILTER (WHERE status = 'green'),
        'availableBeds', sum(available_beds)
      )
    )
  FROM grouped
  WHERE cluster_id IS NOT NULL
  GROUP BY cluster_id
)
SELECT jsonb_build_object(
  'type', 'FeatureCollection',
  'features', COALESCE(jsonb_agg(feature ORDER BY sort_key), '[]'::jsonb)
)
FROM items;
$$;

DROP FUNCTION IF EXISTS medical_ambulances_geojson(timestamptz, uuid);

CREATE FUNCTION medical_ambulances_geojson(
  p_at timestamptz DEFAULT NULL,
  p_governorate_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
WITH data AS (
  SELECT a.id, a.governorate_id, a.code, a.position, a.status
  FROM ambulances a
  WHERE p_at IS NULL

  UNION ALL

  SELECT a.id, a.governorate_id, a.code, h.position, h.status
  FROM ambulances a
  JOIN LATERAL (
    SELECT history.*
    FROM ambulance_history history
    WHERE history.ambulance_id = a.id
        AND history.recorded_at <= p_at
    ORDER BY history.recorded_at DESC, history.id DESC
    LIMIT 1
  ) h ON true
  WHERE p_at IS NOT NULL
),
items AS (
  SELECT
    id,
    jsonb_build_object(
      'type', 'Feature',
      'geometry', ST_AsGeoJSON(position::geometry)::jsonb,
      'properties', jsonb_build_object(
        'kind', 'ambulance',
        'id', id,
        'code', code,
        'status', status
      )
    ) AS feature
  FROM data
  WHERE p_governorate_id IS NULL OR governorate_id = p_governorate_id
)
SELECT jsonb_build_object(
  'type', 'FeatureCollection',
  'features', COALESCE(jsonb_agg(feature ORDER BY id), '[]'::jsonb)
)
FROM items;
$$;

DROP TRIGGER IF EXISTS emergencies_alert ON emergencies;
CREATE TRIGGER emergencies_alert
AFTER INSERT ON emergencies
FOR EACH ROW EXECUTE FUNCTION alert_new_emergency();

DROP TRIGGER IF EXISTS facilities_history_alert ON facilities;
CREATE TRIGGER facilities_history_alert
AFTER INSERT OR UPDATE ON facilities
FOR EACH ROW EXECUTE FUNCTION capture_facility_state();

DROP TRIGGER IF EXISTS ambulances_history ON ambulances;
CREATE TRIGGER ambulances_history
AFTER INSERT OR UPDATE ON ambulances
FOR EACH ROW EXECUTE FUNCTION capture_ambulance_state();
