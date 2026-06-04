"use client";

import { useDateRange } from "../app/context/DateRangeContext";

export default function DateRangePicker() {
  const { dateRange, setDateRange } = useDateRange();

  return (
    <div className="date-range-filter">
      <label>Date Range</label>

      <select value={dateRange} onChange={(e) => setDateRange(e.target.value)}>
        <option value="today">Today</option>
        <option value="yesterday">Yesterday</option>
        <option value="7daysAgo">Last 7 Days</option>
        <option value="30daysAgo">Last 30 Days</option>
        <option value="90daysAgo">Last 90 Days</option>
      </select>
    </div>
  );
}
