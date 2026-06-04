"use client";

import { createContext, useContext, useState } from "react";

const DateRangeContext = createContext(null);

export function DateRangeProvider({ children }) {
  const [dateRange, setDateRange] = useState("30daysAgo");

  return (
    <DateRangeContext.Provider value={{ dateRange, setDateRange }}>
      {children}
    </DateRangeContext.Provider>
  );
}

export function useDateRange() {
  const context = useContext(DateRangeContext);

  if (!context) {
    throw new Error("useDateRange must be used inside DateRangeProvider");
  }

  return context;
}
