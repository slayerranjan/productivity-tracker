"use client";

// ===========================================================================
// CHARTS
//
// Both read the same per-day (or per-week, for long ranges) buckets from one
// /reports call, so the two charts and every tile above them always describe
// the same period. Attendance has exactly two series: Present and Absent.
// ===========================================================================

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ChartRow = {
  key: string;
  label: string;
  present: number;
  absent: number;
  productivity: number;
};

const AXIS = { fontSize: 11, fill: "#94a3b8" };
const TOOLTIP_STYLE = {
  borderRadius: 12,
  border: "1px solid #E5E7F4",
  boxShadow: "0 8px 24px rgba(83,104,237,0.12)",
  fontSize: 12,
};

export function AttendanceChart({ rows }: { rows: ChartRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barGap={4}>
        <CartesianGrid vertical={false} stroke="#E5E7F4" />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={12} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip cursor={{ fill: "#F3F4FE" }} contentStyle={TOOLTIP_STYLE} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        <Bar dataKey="present" name="Present" fill="#5368ED" radius={[6, 6, 0, 0]} maxBarSize={22} />
        <Bar dataKey="absent" name="Absent" fill="#fda4af" radius={[6, 6, 0, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ProductivityChart({ rows }: { rows: ChartRow[] }) {
  // Round the axis up to a multiple of 25 so ticks read 0, 25, 50 ... rather
  // than whatever the tallest point happens to be (105%, 90%, 60%...).
  const peak = Math.max(100, ...rows.map((r) => r.productivity));
  const step = peak > 200 ? 100 : 25;
  const top = Math.ceil(peak / step) * step;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="hrProd" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6B7CF0" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#6B7CF0" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="#E5E7F4" />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={12} />
        <YAxis
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          domain={[0, top]}
          ticks={Array.from({ length: top / step + 1 }, (_, i) => i * step)}
          tickFormatter={(v: number) => `${v}%`}
        />
        <Tooltip
          cursor={{ stroke: "#CDD2F8" }}
          contentStyle={TOOLTIP_STYLE}
          formatter={(v) => [`${v}%`, "Productivity"]}
        />
        <ReferenceLine y={100} stroke="#A9B2F4" strokeDasharray="4 4" />
        <Area
          type="monotone"
          dataKey="productivity"
          stroke="#5368ED"
          strokeWidth={2.5}
          fill="url(#hrProd)"
          dot={{ r: 3, fill: "#5368ED", strokeWidth: 0 }}
          activeDot={{ r: 5 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
