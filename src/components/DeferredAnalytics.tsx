"use client";

import { useEffect, useState, type ComponentType } from "react";

export default function DeferredAnalytics() {
  const [Analytics, setAnalytics] = useState<ComponentType | null>(null);

  useEffect(() => {
    const load = () => {
      void import("@vercel/analytics/react").then(({ Analytics: AnalyticsComponent }) => {
        setAnalytics(() => AnalyticsComponent);
      });
    };

    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(load, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }

    const id = setTimeout(load, 2000);
    return () => clearTimeout(id);
  }, []);

  if (!Analytics) {
    return null;
  }

  return <Analytics />;
}
