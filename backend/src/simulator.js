const lock = 748392002;

async function runTick(db, send) {
  await db.query("BEGIN");

  try {
    const lockResult = await db.query(
      "SELECT pg_try_advisory_xact_lock($1) AS acquired",
      [lock],
    );
    if (!lockResult.rows[0].acquired) {
      await db.query("ROLLBACK");
      return false;
    }

    const result = await db.query(
      "SELECT id, governorate_id, location FROM facilities ORDER BY id",
    );
    const places = result.rows;
    const place = places[Math.floor(Math.random() * places.length)];

    let change = 1 + Math.floor(Math.random() * 5);
    if (Math.random() < 0.5) change *= -1;

    await db.query(
      `UPDATE facilities
       SET occupied_beds = GREATEST(
         0,
         LEAST(total_beds, occupied_beds + $2)
       )
       WHERE id = $1`,
      [place.id, change],
    );

    if (Math.random() < 0.02) {
      const origin = places[Math.floor(Math.random() * places.length)];
      await db.query(
        `INSERT INTO emergencies (governorate_id, title_ar, location)
         VALUES (
           $1,
           'حالة طارئة محاكاة',
           ST_Translate($2::geography::geometry, $3, $4)::geography
         )`,
        [
          origin.governorate_id,
          origin.location,
          (Math.random() - 0.5) * 0.08,
          (Math.random() - 0.5) * 0.08,
        ],
      );
    }

    await db.query("SELECT advance_ambulances(2)");
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }

  await send();
  return true;
}

export function startSim(db, send) {
  let busy = false;

  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    let client;

    try {
      client = await db.connect();
      await runTick(client, send);
    } catch (error) {
      console.error("Simulator tick failed", error.message);
    } finally {
      if (client) client.release();
      busy = false;
    }
  }, 2000);

  timer.unref();

  return function stop() {
    clearInterval(timer);
  };
}
