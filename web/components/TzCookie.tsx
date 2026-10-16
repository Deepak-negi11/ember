"use client";

import { useEffect } from "react";

/** Remembers the browser's time zone so a brand-new account starts with the right day boundaries. */
export function TzCookie() {
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) document.cookie = `ember_tz=${encodeURIComponent(tz)}; path=/api/auth; max-age=900; samesite=lax`;
  }, []);
  return null;
}
