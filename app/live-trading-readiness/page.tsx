"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, CircleDashed, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ReadinessCheck, ReadinessReport } from "@/lib/live-trading-readiness";

export default function LiveTradingReadinessPage() {
  const [checks, setChecks] = useState<ReadinessCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/trading/readiness", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Readiness status could not be loaded.");
        return response.json() as Promise<ReadinessReport>;
      })
      .then((report) => { if (active) setChecks(report.checks); })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "Readiness status could not be loaded.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <main className="backtest-page">
      <div className="backtest-page-header">
        <div>
          <Link href="/" className="backtest-back-link"><ArrowLeft size={16} /> Back to dashboard</Link>
          <p className="eyebrow">PHASE 12 · SAFETY GATE</p>
          <h1>Live-Trading Readiness</h1>
          <p className="backtest-page-description">Review the engineering and operational controls required before a broker connection could ever be enabled.</p>
        </div>
      </div>

      <section className="backtest-card" role="alert">
        <div className="backtest-section-title">
          <h2><ShieldAlert size={20} /> Live execution is disabled</h2>
        </div>
        <p>This release does not connect to a broker, submit orders, or use real-money accounts. This page is a readiness checklist only. Do not treat a completed checklist as authorization to trade.</p>
      </section>

      {error && <div className="backtest-error" role="alert">{error}</div>}
      <section className="backtest-card">
        <div className="backtest-section-title">
          <h2><ShieldCheck size={20} /> Required controls</h2>
          <span>{loading ? "Checking…" : `${checks.filter((check) => check.state === "complete").length} of ${checks.length} complete`}</span>
        </div>
        {loading ? <div className="backtest-empty">Loading readiness checklist…</div> : (
          <div className="readiness-check-list">
            {checks.map((check) => (
              <article className="readiness-check" key={check.id}>
                <div className="readiness-check-icon">
                  {check.state === "complete" ? <CheckCircle2 size={20} /> : <CircleDashed size={20} />}
                </div>
                <div>
                  <h3>{check.title}</h3>
                  <p>{check.detail}</p>
                </div>
                <span className={`readiness-status ${check.state}`}>{check.state}</span>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="backtest-card">
        <div className="backtest-section-title"><h2>Required implementation sequence</h2></div>
        <ol className="readiness-sequence">
          <li>Choose a supported broker and document account, asset and jurisdiction constraints.</li>
          <li>Implement a server-only broker adapter with credentials in deployment secrets, never browser storage.</li>
          <li>Add server-enforced limits, idempotent order requests, durable order state and immutable audit events.</li>
          <li>Handle acknowledgements, partial fills, rejects, cancellations, timeouts and reconciliation safely.</li>
          <li>Implement a server-side emergency stop and test restart/recovery and broker outage scenarios.</li>
          <li>Run broker sandbox tests and extended paper trading before any separately reviewed live enablement.</li>
        </ol>
      </section>
    </main>
  );
}
