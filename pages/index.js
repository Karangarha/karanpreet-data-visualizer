import Head from "next/head";
import { useMemo, useState } from "react";
import Papa from "papaparse";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  ScatterChart,
  Scatter,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import styles from "./index.module.css";

const AUTHOR = "Karanpreet Singh";
const MAX_BARS = 30;
const MAX_POINTS = 2000;
const AGG_LABEL = { sum: "Total", avg: "Average", count: "Count of rows" };

const fmt = (v) =>
  typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v;

// Look at every value in a column to decide if it's a number, a date, or text
function columnType(rows, name) {
  const values = rows.map((r) => r[name]).filter((v) => v !== null && v !== "");
  if (values.length && values.every((v) => typeof v === "number")) return "number";
  if (values.length && values.every((v) => !isNaN(Date.parse(v)))) return "date";
  return "text";
}

// Pick a sensible first chart: a line over time, else a bar per category
function defaultSpec(columns) {
  const num = columns.filter((c) => c.type === "number");
  const x =
    columns.find((c) => c.type === "date") ||
    columns.find((c) => c.type === "text") ||
    columns[0];
  const y = num.find((c) => c.name !== x.name);
  return {
    chart: x.type === "date" ? "line" : x.type === "text" ? "bar" : "scatter",
    x: x.name,
    y: y ? y.name : "",
    agg: y ? "sum" : "count",
  };
}

// Turn raw rows into the points the chart draws
function buildPoints(rows, columns, { chart, x, y, agg }) {
  if (chart === "scatter") {
    const points = rows
      .filter((r) => typeof r[x] === "number" && typeof r[y] === "number")
      .map((r) => ({ x: r[x], y: r[y] }));
    return { points: points.slice(0, MAX_POINTS), total: points.length };
  }

  const groups = new Map();
  for (const r of rows) {
    if (r[x] === null || r[x] === undefined || r[x] === "") continue;
    if (agg !== "count" && typeof r[y] !== "number") continue;
    const g = groups.get(r[x]) || { sum: 0, count: 0 };
    g.sum += agg === "count" ? 0 : r[y];
    g.count += 1;
    groups.set(r[x], g);
  }
  let points = [...groups].map(([key, g]) => ({
    key,
    value: agg === "count" ? g.count : agg === "avg" ? g.sum / g.count : g.sum,
  }));

  if (chart === "line") {
    const type = columns.find((c) => c.name === x)?.type;
    const sortKey = (k) => (type === "date" ? Date.parse(k) : k);
    points.sort((a, b) =>
      type === "text" ? String(a.key).localeCompare(b.key) : sortKey(a.key) - sortKey(b.key)
    );
  } else {
    points.sort((a, b) => b.value - a.value);
  }
  const total = points.length;
  return { points: chart === "bar" ? points.slice(0, MAX_BARS) : points, total };
}

const axisProps = {
  tick: { fill: "var(--text-muted)", fontSize: 12 },
  axisLine: { stroke: "var(--baseline)" },
  tickLine: false,
};
const tooltipProps = {
  contentStyle: {
    background: "var(--surface-1)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--text-primary)",
  },
  labelStyle: { color: "var(--text-secondary)" },
  itemStyle: { color: "var(--text-primary)" },
};

export default function Home() {
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [fileName, setFileName] = useState("");
  const [spec, setSpec] = useState(null);
  const [question, setQuestion] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadCsv = (text, name) => {
    const parsed = Papa.parse(text, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
    });
    const fields = (parsed.meta.fields || []).filter(Boolean);
    if (!parsed.data.length || !fields.length) {
      setError("Couldn't find any rows in that file. Is it a CSV with a header row?");
      return;
    }
    const cols = fields.map((name) => ({ name, type: columnType(parsed.data, name) }));
    setRows(parsed.data);
    setColumns(cols);
    setFileName(name);
    setSpec(defaultSpec(cols));
    setReason("");
    setError("");
  };

  const onFile = async (event) => {
    const file = event.target.files[0];
    if (file) loadCsv(await file.text(), file.name);
  };

  const loadSample = async () => {
    const res = await fetch("/sample.csv");
    loadCsv(await res.text(), "sample.csv");
  };

  const askAi = async (event) => {
    event.preventDefault();
    if (!question.trim() || !columns.length) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          columns,
          rowCount: rows.length,
          sample: rows.slice(0, 15),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Never trust the AI blindly: only accept columns that really exist
      const names = columns.map((c) => c.name);
      const agg = ["sum", "avg", "count"].includes(data.agg) ? data.agg : "sum";
      if (
        !["bar", "line", "scatter"].includes(data.chart) ||
        !names.includes(data.x) ||
        (agg !== "count" || data.chart === "scatter" ? !names.includes(data.y) : false)
      ) {
        throw new Error("The AI suggested a chart that doesn't fit this data. Try rephrasing.");
      }
      setSpec({ chart: data.chart, x: data.x, y: data.y || "", agg });
      setReason(data.reason || "");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const updateSpec = (field) => (e) => {
    const next = { ...spec, [field]: e.target.value };
    // Scatter needs numbers on both axes: swap in numeric columns if needed
    if (next.chart === "scatter") {
      const num = columns.filter((c) => c.type === "number").map((c) => c.name);
      if (!num.includes(next.x)) next.x = num.find((n) => n !== next.y) || num[0] || "";
      if (!num.includes(next.y)) next.y = num.find((n) => n !== next.x) || num[0] || "";
    }
    setSpec(next);
    setReason("");
  };

  const { points, total } = useMemo(
    () => (spec ? buildPoints(rows, columns, spec) : { points: [], total: 0 }),
    [rows, columns, spec]
  );

  const numericCols = columns.filter((c) => c.type === "number");
  const measure = spec && (spec.agg === "count" ? AGG_LABEL.count : `${AGG_LABEL[spec.agg]} ${spec.y}`);
  const title =
    spec &&
    (spec.chart === "scatter" ? `${spec.y} vs ${spec.x}` : `${measure} by ${spec.x}`);

  return (
    <div className={styles.page}>
      <Head>
        <title>Data Visualizer | {AUTHOR}</title>
        <style>{"body { margin: 0; }"}</style>
      </Head>

      <header className={styles.header}>
        <h1 className={styles.heading1}>Data Visualizer</h1>
        <p className={styles.byline}>
          Created by <strong>{AUTHOR}</strong> · upload a CSV, then chart it yourself or ask AI
        </p>
      </header>

      <main className={styles.main}>
        <section className={styles.card}>
          <h2 className={styles.h2}>1. Upload your data</h2>
          <div className={styles.row}>
            <label className={styles.fileButton}>
              Choose CSV file
              <input type="file" accept=".csv,text/csv" onChange={onFile} hidden />
            </label>
            <button className={styles.ghostButton} type="button" onClick={loadSample}>
              Use sample data
            </button>
            {fileName && (
              <span className={styles.meta}>
                {fileName} · {rows.length.toLocaleString()} rows · {columns.length} columns
              </span>
            )}
          </div>
        </section>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        {spec && (
          <>
            <section className={styles.card}>
              <h2 className={styles.h2}>2. Ask AI for a chart</h2>
              <form className={styles.row} onSubmit={askAi}>
                <input
                  className={styles.textInput}
                  placeholder='e.g. "average revenue per region" or "how did units change over time?"'
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                />
                <button className={styles.primaryButton} type="submit" disabled={loading}>
                  {loading ? "Thinking..." : "Ask AI"}
                </button>
              </form>
              {reason && <p className={styles.reason}>AI: {reason}</p>}
            </section>

            <section className={styles.card}>
              <h2 className={styles.h2}>3. Chart</h2>
              <div className={styles.controls}>
                <label>
                  Chart
                  <select value={spec.chart} onChange={updateSpec("chart")}>
                    <option value="bar">Bar</option>
                    <option value="line">Line</option>
                    <option value="scatter">Scatter</option>
                  </select>
                </label>
                <label>
                  X axis
                  <select value={spec.x} onChange={updateSpec("x")}>
                    {(spec.chart === "scatter" ? numericCols : columns).map((c) => (
                      <option key={c.name}>{c.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Y axis
                  <select value={spec.y} onChange={updateSpec("y")} disabled={spec.agg === "count" && spec.chart !== "scatter"}>
                    <option value="">-</option>
                    {numericCols.map((c) => (
                      <option key={c.name}>{c.name}</option>
                    ))}
                  </select>
                </label>
                {spec.chart !== "scatter" && (
                  <label>
                    Combine
                    <select value={spec.agg} onChange={updateSpec("agg")}>
                      <option value="sum">Sum</option>
                      <option value="avg">Average</option>
                      <option value="count">Count rows</option>
                    </select>
                  </label>
                )}
              </div>

              <h3 className={styles.chartTitle}>{title}</h3>
              {points.length === 0 ? (
                <p className={styles.meta}>
                  Nothing to draw - pick a numeric Y column
                  {spec.chart === "scatter" ? " and a numeric X column" : " or switch to Count rows"}.
                </p>
              ) : (
                <div className={styles.chart}>
                  <ResponsiveContainer width="100%" height={380}>
                    {spec.chart === "scatter" ? (
                      <ScatterChart margin={{ top: 8, right: 32, bottom: 8, left: 8 }}>
                        <CartesianGrid stroke="var(--grid)" />
                        <XAxis {...axisProps} type="number" dataKey="x" name={spec.x} tickFormatter={fmt} domain={["auto", "auto"]} />
                        <YAxis {...axisProps} type="number" dataKey="y" name={spec.y} tickFormatter={fmt} domain={["auto", "auto"]} />
                        <Tooltip {...tooltipProps} formatter={fmt} cursor={{ strokeDasharray: "3 3" }} />
                        <Scatter data={points} fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={2} />
                      </ScatterChart>
                    ) : spec.chart === "line" ? (
                      <LineChart data={points} margin={{ top: 8, right: 32, bottom: 8, left: 8 }}>
                        <CartesianGrid stroke="var(--grid)" vertical={false} />
                        <XAxis {...axisProps} dataKey="key" />
                        <YAxis {...axisProps} tickFormatter={fmt} />
                        <Tooltip {...tooltipProps} formatter={(v) => [fmt(v), measure]} cursor={{ stroke: "var(--baseline)" }} />
                        <Line type="linear" dataKey="value" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 4, fill: "var(--series-1)", stroke: "var(--surface-1)", strokeWidth: 2 }} activeDot={{ r: 6 }} />
                      </LineChart>
                    ) : (
                      <BarChart data={points} margin={{ top: 8, right: 32, bottom: 8, left: 8 }}>
                        <CartesianGrid stroke="var(--grid)" vertical={false} />
                        <XAxis {...axisProps} dataKey="key" />
                        <YAxis {...axisProps} tickFormatter={fmt} />
                        <Tooltip {...tooltipProps} formatter={(v) => [fmt(v), measure]} cursor={{ fill: "var(--hover)" }} />
                        <Bar dataKey="value" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={48} />
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
              )}
              {total > points.length && (
                <p className={styles.meta}>
                  Showing {spec.chart === "bar" ? `top ${points.length}` : points.length.toLocaleString()} of{" "}
                  {total.toLocaleString()} {spec.chart === "bar" ? "categories" : "points"}.
                </p>
              )}
            </section>

            <section className={styles.card}>
              <h2 className={styles.h2}>4. Data preview</h2>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      {columns.map((c) => (
                        <th key={c.name} className={c.type === "number" ? styles.num : ""}>
                          {c.name}
                          <span className={styles.type}>{c.type}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 100).map((r, i) => (
                      <tr key={i}>
                        {columns.map((c) => (
                          <td key={c.name} className={c.type === "number" ? styles.num : ""}>
                            {fmt(r[c.name])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 100 && <p className={styles.meta}>First 100 of {rows.length.toLocaleString()} rows.</p>}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
