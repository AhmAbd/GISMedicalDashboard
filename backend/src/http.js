import express from "express";

import { pool } from "./db/pool.js";
import { getData, readQuery } from "./state.js";
import { isUuid } from "./uuid.js";

export function makeApp(send) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  app.get("/api/state", async (request, response) => {
    const filters = readQuery(request.query);
    response.json(await getData(filters));
  });

  app.post("/api/dispatches", async (request, response) => {
    const id = request.body && request.body.emergencyId;
    if (typeof id !== "string" || !isUuid(id)) {
      const error = new Error("INVALID_REQUEST");
      error.status = 400;
      error.publicCode = "INVALID_REQUEST";
      error.publicMessage = "معرّف الحالة الطارئة غير صالح";
      throw error;
    }

    const client = await pool.connect();
    let item;

    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT * FROM dispatch_nearest_ambulance($1)",
        [id],
      );
      item = result.rows[0];
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    try {
      await send();
    } catch (error) {
      console.error("medical:update broadcast failed", error.message);
    }

    response.status(201).json({
      dispatchId: item.dispatch_id,
      ambulanceId: item.ambulance_id,
      distanceMetres: item.distance_m,
      route: item.route_geojson,
    });
  });

  app.use((request, response) => {
    response.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "المسار المطلوب غير موجود",
      },
    });
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);

    let status = error.status || 500;
    let code = error.publicCode || "INTERNAL_ERROR";
    let message = error.publicMessage || "حدث خطأ غير متوقع";

    if (error.message === "NO_AMBULANCE_AVAILABLE") {
      status = 409;
      code = "NO_AMBULANCE_AVAILABLE";
      message = "لا توجد سيارة إسعاف متاحة حالياً";
    }
    if (error.message === "EMERGENCY_NOT_FOUND") {
      status = 404;
      code = "EMERGENCY_NOT_FOUND";
      message = "الحالة الطارئة غير موجودة";
    }
    if (error.message === "EMERGENCY_NOT_ACTIVE") {
      status = 409;
      code = "EMERGENCY_NOT_ACTIVE";
      message = "تم التعامل مع الحالة الطارئة مسبقاً";
    }

    response.status(status).json({ error: { code, message } });
  });

  return app;
}
