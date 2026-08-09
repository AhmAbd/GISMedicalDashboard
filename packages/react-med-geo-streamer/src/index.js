import { useSyncExternalStore } from "react";
import { io } from "socket.io-client";

const emptyMap = {
  type: "FeatureCollection",
  features: [],
};

const empty = {
  error: null,
  governorates: [],
  facilities: emptyMap,
  ambulances: emptyMap,
  emergencies: [],
  alerts: [],
  dispatches: [],
};

export function makeStore(options = {}) {
  const socketUrl = options.socketUrl;

  let data = empty;
  let socket;
  let query = "";
  let loadId = 0;
  const listeners = new Set();

  function update() {
    for (const listener of listeners) listener();
  }

  async function load() {
    loadId += 1;
    const id = loadId;
    let next;

    try {
      const response = await fetch("/api/state?" + query);
      if (!response.ok) throw new Error("STATE_REQUEST_FAILED");
      next = { ...empty, ...(await response.json()), error: null };
    } catch (error) {
      next = { ...data, error: error.message };
    }

    if (id !== loadId) return data;
    data = next;
    update();
    return data;
  }

  async function start() {
    if (socket) return data;
    socket = io(socketUrl, { transports: ["websocket"] });
    socket.on("connect", load);
    socket.on("medical:update", load);
    return load();
  }

  async function setQuery(value = "") {
    if (value === query) return data;
    query = value;
    if (socket) return load();
    return data;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return function stop() {
      listeners.delete(listener);
    };
  }

  function getData() {
    return data;
  }

  function getEmpty() {
    return empty;
  }

  return {
    getServerSnapshot: getEmpty,
    getSnapshot: getData,
    setQuery,
    start,
    subscribe,
  };
}

export function useStore(store) {
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
}
