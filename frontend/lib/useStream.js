"use client";

import { useEffect } from "react";
import { makeStore, useStore } from "react-med-geo-streamer";

let socketUrl;
if (process.env.NODE_ENV === "development") {
  socketUrl = "http://127.0.0.1:4000";
}

const store = makeStore({ socketUrl });

function makeQuery(filters) {
  const query = new URLSearchParams();
  if (filters.at) query.set("at", new Date(filters.at).toISOString());
  if (filters.governorate) {
    query.set("governorate", filters.governorate);
  }
  if (filters.facilityTypes.length) {
    query.set("facilityType", filters.facilityTypes.join(","));
  }
  query.set("zoom", String(filters.zoom));
  return query.toString();
}

export function useStream(filters) {
  const query = makeQuery(filters);
  const data = useStore(store);

  useEffect(() => {
    store.setQuery(query);
    store.start();
  }, [query]);

  return data;
}
