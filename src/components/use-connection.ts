"use client";

import { useSyncExternalStore } from "react";

function onConnectionChange(notify: () => void): () => void {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}

/** Whether the device says it is online (the browser's own navigator.onLine), kept current. True on the server. */
export function useOnline(): boolean {
  return useSyncExternalStore(onConnectionChange, () => navigator.onLine, () => true);
}

const never = () => () => {};

/** This page's path and query, "/" on the server. */
export function useHere(): string {
  return useSyncExternalStore(never, () => `${window.location.pathname}${window.location.search}`, () => "/");
}
