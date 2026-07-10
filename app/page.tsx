"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type {
  ResolvedEntity,
  SignalResult,
  Timeseries,
  Synthesis,
  ThesisCard,
  LockedInfo,
} from "@/lib/ui-types";

const CATEGORY_ICON: Record<string, string> = {
  identity: "🏷️",
  filings: "📄",
  oss: "🐙",
  "dev-chatter": "💬",
  patents: "⚗️",
  hiring: "🧑‍💼",
  web: "🌐",
  apps: "📱",
  supply: "🚢",
  geo: "🛰️",
};

const TIER_LABEL: Record<string, string> = { free: "Free", premium: "Premium", roadmap: "Roadmap" };

function Sparkline({ series, w = 140, h = 36 }: { series: Timeseries; w?: number; h?: number }) {
  const points = series?.points ?? [];
  if (points.length < 2) return null;
  const pad = 3;
  const vals = points.map((p) => p.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const step = (w - 2 * pad) / (points.length - 1);
  const coords = points.map((p, i) => [pad + i * step, h - pad - ((p.v - min) / range) * (h - 2 * pad)] as const);
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${h - pad} L${coords[0][0].toFixed(1)},${h - pad} Z`;
  const rising = points[points.length - 1].v >= points[0].v;
  const color = rising ? "var(--bull)" : "var(--bear)";
  return (
    <svg width={w} height={h} className="overflow-visible" aria-hidden>
      <path d={area} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

function TrendArrow({ trend }: { trend?: "up" | "down" | "flat" }) {
  if (!trend) return null;
  const map = { up: ["▲", "text-bull"], down: ["▼", "text-bear"], flat: ["▬", "text-muted"] } as const;
  const [glyph, cls] = map[trend];
  return <span className={`ml-1 text-[10px] ${cls}`}>{glyph}</span>;
}

function StatusPill({ status }: { status: SignalResult["status"] }) {
  const map: Record<SignalResult["status"], [string, string]> = {
    ok: ["live", "bg-bull/15 text-bull"],
    "no-data": ["no data", "bg-neutral/15 text-neutral"],
    "not-applicable": ["n/a", "bg-muted/15 text-muted"],
    error: ["error", "bg-bear/15 text-bear"],
  };
  const [label, cls] = map[status] ?? ["", "bg-surface-2 text-muted"];
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>{label}</span>;
}

function LinkButton({ link }: { link?: { label: string; url: string } }) {
  if (!link) return null;
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/20"
    >
      {link.label} ↗
    </a>
  );
}

/** Compact tile for the overview (highlights) grid. */
function StatTile({ signal, onOpen }: { signal: SignalResult; onOpen: () => void }) {
  const primary = signal.metrics?.[0];
  return (
    <button
      onClick={onOpen}
      className="flex flex-col rounded-xl border border-border bg-surface p-4 text-left transition hover:border-accent/60"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">{CATEGORY_ICON[signal.category] ?? "•"}</span>
          <span className="text-sm font-medium">{signal.label}</span>
        </div>
        <StatusPill status={signal.status} />
      </div>
      {signal.status === "ok" ? (
        <>
          {primary && (
            <div className="mt-2 text-lg font-semibold">
              {typeof primary.value === "number" ? primary.value.toLocaleString() : primary.value}
              {primary.unit ? <span className="text-sm text-muted"> {primary.unit}</span> : null}
              <TrendArrow trend={primary.trend} />
              <span className="ml-2 text-[11px] font-normal text-muted">{primary.name}</span>
            </div>
          )}
          {signal.timeseries?.[0] && <div className="mt-1"><Sparkline series={signal.timeseries[0]} w={160} h={30} /></div>}
          {signal.headline && <p className="mt-1 line-clamp-2 text-xs text-muted">{signal.headline}</p>}
        </>
      ) : (
        <p className="mt-2 text-xs text-muted">{signal.note ?? signal.error ?? "—"}</p>
      )}
      <span className="mt-2 text-[11px] text-accent">Details →</span>
    </button>
  );
}

/** Full detail card (sources view). */
function SignalCardView({ signal }: { signal: SignalResult }) {
  const [open, setOpen] = useState(true);
  const dim = signal.status !== "ok";
  return (
    <div id={`src-${signal.connectorId}`} className={`scroll-mt-16 rounded-xl border border-border bg-surface p-4 ${dim ? "opacity-80" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{CATEGORY_ICON[signal.category] ?? "•"}</span>
          <h3 className="font-medium">{signal.label}</h3>
        </div>
        <StatusPill status={signal.status} />
      </div>

      {signal.headline && <p className="mt-2 text-sm text-foreground/90">{signal.headline}</p>}
      {signal.note && signal.status !== "ok" && <p className="mt-2 text-xs text-muted">{signal.note}</p>}
      {signal.error && <p className="mt-2 text-xs text-bear">{signal.error}</p>}

      {signal.status === "ok" && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {signal.metrics.map((m) => (
            <div key={m.name} className="rounded-lg bg-surface-2 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-muted">{m.name}</div>
              <div className="text-sm font-semibold">
                {typeof m.value === "number" ? m.value.toLocaleString() : m.value}
                {m.unit ? <span className="text-muted"> {m.unit}</span> : null}
                <TrendArrow trend={m.trend} />
                {m.changePct !== undefined && (
                  <span className={`ml-1 text-[10px] ${m.changePct >= 0 ? "text-bull" : "text-bear"}`}>
                    {m.changePct >= 0 ? "+" : ""}
                    {m.changePct.toFixed(0)}%
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {signal.timeseries?.[0] && (
        <div className="mt-3">
          <Sparkline series={signal.timeseries[0]} w={280} h={48} />
          <div className="text-[10px] text-muted">{signal.timeseries[0].name}</div>
        </div>
      )}

      {(signal.primaryLink || signal.evidence.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <LinkButton link={signal.primaryLink} />
          {signal.evidence.length > 0 && (
            <button onClick={() => setOpen((v) => !v)} className="text-xs text-accent hover:underline">
              {open ? "Hide" : "Show"} evidence ({signal.evidence.length})
            </button>
          )}
        </div>
      )}
      {open && signal.evidence.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {signal.evidence.map((e, i) => (
            <li key={i} className="text-xs text-foreground/80">
              {e.url ? (
                <a href={e.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  {e.summary}
                </a>
              ) : (
                e.summary
              )}
              {e.sourceDate && <span className="text-muted"> · {e.sourceDate.slice(0, 10)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LockedCardView({ info }: { info: LockedInfo }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-muted">
          <span className="text-lg grayscale">{CATEGORY_ICON[info.category] ?? "•"}</span>
          <h3 className="font-medium">{info.label}</h3>
        </div>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-muted">🔒 {TIER_LABEL[info.tier]}</span>
      </div>
      <p className="mt-2 text-xs text-muted">{info.description}</p>
    </div>
  );
}

function directionCls(d: ThesisCard["direction"]) {
  return d === "bull" ? "text-bull" : d === "bear" ? "text-bear" : "text-neutral";
}

function ThesisCardView({ card }: { card: ThesisCard }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{card.signal}</span>
        <span className={`text-xs font-semibold uppercase ${directionCls(card.direction)}`}>{card.direction}</span>
      </div>
      <p className="mt-1.5 text-sm text-foreground/90">{card.implication}</p>
      <div className="mt-2 text-[10px] text-muted">confidence: {card.confidence}</div>
      {card.evidence?.length > 0 && (
        <ul className="mt-2 list-disc pl-4 text-[11px] text-muted">
          {card.evidence.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
    </div>
  );
}

function ThesisPanel({ synthesis, loading }: { synthesis: Synthesis | null; loading: boolean }) {
  if (loading) {
    return <div className="rounded-xl border border-border bg-surface p-5 text-sm text-muted">Synthesizing an investment thesis from the signals…</div>;
  }
  if (!synthesis) return null;
  const shortTerm = synthesis.cards.filter((c) => c.horizon === "short-term");
  const longTerm = synthesis.cards.filter((c) => c.horizon === "long-term");
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold">Investment Thesis</h2>
      <p className="mt-2 text-sm text-foreground/90">{synthesis.summary}</p>

      {(synthesis.strongestSupport || synthesis.strongestContradiction) && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {synthesis.strongestSupport && (
            <div className="rounded-lg border border-bull/30 bg-bull/5 p-3">
              <div className="text-xs font-semibold text-bull">Strongest support</div>
              <p className="mt-1 text-xs text-foreground/85">{synthesis.strongestSupport}</p>
            </div>
          )}
          {synthesis.strongestContradiction && (
            <div className="rounded-lg border border-bear/30 bg-bear/5 p-3">
              <div className="text-xs font-semibold text-bear">Strongest contradiction</div>
              <p className="mt-1 text-xs text-foreground/85">{synthesis.strongestContradiction}</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-neutral">⚡ Short-term signals</h3>
          <div className="space-y-2">
            {shortTerm.length ? shortTerm.map((c, i) => <ThesisCardView key={i} card={c} />) : <p className="text-xs text-muted">None identified.</p>}
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-accent">📈 Long-term signals</h3>
          <div className="space-y-2">
            {longTerm.length ? longTerm.map((c, i) => <ThesisCardView key={i} card={c} />) : <p className="text-xs text-muted">None identified.</p>}
          </div>
        </div>
      </div>

      {(synthesis.bullCase.length > 0 || synthesis.bearCase.length > 0) && (
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-bull">Bull case</h3>
            <ul className="list-disc space-y-1 pl-4 text-xs text-foreground/85">{synthesis.bullCase.map((b, i) => <li key={i}>{b}</li>)}</ul>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-bear">Bear case</h3>
            <ul className="list-disc space-y-1 pl-4 text-xs text-foreground/85">{synthesis.bearCase.map((b, i) => <li key={i}>{b}</li>)}</ul>
          </div>
        </div>
      )}

      {synthesis.dataGaps.length > 0 && (
        <p className="mt-4 text-xs text-muted"><span className="font-medium">Data gaps:</span> {synthesis.dataGaps.join(", ")}.</p>
      )}
      <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-muted">{synthesis.disclaimer}</p>
    </div>
  );
}

function CompanyHeader({ entity }: { entity: ResolvedEntity }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">{entity.companyName} <span className="text-muted">· {entity.ticker}</span></h2>
          <p className="text-xs text-muted">
            {entity.sector ?? "Sector n/a"}
            {entity.marketCap ? ` · ~$${(entity.marketCap / 1e9).toFixed(1)}B mkt cap` : ""}
          </p>
        </div>
        <div className="flex gap-1.5 text-[10px] text-muted">
          <span className={`rounded px-1.5 py-0.5 ${entity.source.edgar ? "bg-bull/15 text-bull" : "bg-surface-2"}`}>EDGAR</span>
          <span className={`rounded px-1.5 py-0.5 ${entity.source.polygon ? "bg-bull/15 text-bull" : "bg-surface-2"}`}>Polygon</span>
          <span className={`rounded px-1.5 py-0.5 ${entity.source.llm ? "bg-bull/15 text-bull" : "bg-surface-2"}`}>AI-resolved</span>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const [ticker, setTicker] = useState("");
  const [entity, setEntity] = useState<ResolvedEntity | null>(null);
  const [signals, setSignals] = useState<SignalResult[]>([]);
  const [pending, setPending] = useState<{ id: string; label: string; category: string }[]>([]);
  const [locked, setLocked] = useState<LockedInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [synthesis, setSynthesis] = useState<Synthesis | null>(null);
  const [synthLoading, setSynthLoading] = useState(false);
  const [view, setView] = useState<"overview" | "sources">("overview");
  const runId = useRef(0);

  const runSynthesis = useCallback(async (tk: string, sigs: SignalResult[]) => {
    setSynthLoading(true);
    try {
      const res = await fetch("/api/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: tk, signals: sigs }),
      });
      const json = await res.json();
      if (res.ok) setSynthesis(json.synthesis);
    } catch {
      /* best-effort */
    } finally {
      setSynthLoading(false);
    }
  }, []);

  const search = useCallback(async () => {
    const tk = ticker.trim().toUpperCase();
    if (!tk) return;
    const id = ++runId.current;
    setLoading(true);
    setError(null);
    setEntity(null);
    setSignals([]);
    setPending([]);
    setLocked([]);
    setSynthesis(null);
    setView("overview");

    const collected: SignalResult[] = [];
    try {
      const res = await fetch("/api/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: tk }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (id !== runId.current) return;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const dataLine = part.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          let evt: Record<string, unknown>;
          try {
            evt = JSON.parse(dataLine.slice(5).trim());
          } catch {
            continue;
          }
          switch (evt.type) {
            case "entity": setEntity(evt.entity as ResolvedEntity); break;
            case "pending": setPending(evt.ids as typeof pending); break;
            case "locked": setLocked(evt.locked as LockedInfo[]); break;
            case "signal":
              collected.push(evt.signal as SignalResult);
              setSignals((prev) => [...prev, evt.signal as SignalResult]);
              break;
            case "error": setError(evt.message as string); break;
          }
        }
      }
      if (id === runId.current && collected.some((s) => s.status === "ok")) {
        void runSynthesis(tk, collected);
      }
    } catch (e) {
      if (id === runId.current) setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      if (id === runId.current) setLoading(false);
    }
  }, [ticker, runSynthesis]);

  const openSource = useCallback((connectorId: string) => {
    setView("sources");
    setTimeout(() => document.getElementById(`src-${connectorId}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, []);

  const pendingWaiting = pending.filter((p) => !signals.some((s) => s.connectorId === p.id));
  const okCount = useMemo(() => signals.filter((s) => s.status === "ok").length, [signals]);
  // Tiles: live signals first, then the rest.
  const orderedSignals = useMemo(
    () => [...signals].sort((a, b) => (a.status === "ok" ? 0 : 1) - (b.status === "ok" ? 0 : 1)),
    [signals]
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">
          AltEdge <span className="text-accent">·</span>{" "}
          <span className="text-base font-normal text-muted">Alternative Data Terminal</span>
        </h1>
        <p className="mt-1 text-sm text-muted">Search a ticker for live alternative-data signals and an evidence-backed investment thesis.</p>
      </header>

      <div className="flex gap-2">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Enter ticker (e.g. NVDA, KO, SHOP)"
          className="flex-1 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-accent"
          maxLength={10}
        />
        <button onClick={search} disabled={loading} className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
          {loading ? "Scanning…" : "Analyze"}
        </button>
      </div>

      {error && <div className="mt-4 rounded-lg border border-bear/40 bg-bear/10 px-4 py-3 text-sm text-bear">{error}</div>}

      {entity && (
        <>
          <div className="mt-6 flex items-center justify-between gap-3">
            <div className="flex gap-2">
              <button
                onClick={() => setView("overview")}
                className={`rounded-lg px-3 py-1.5 text-sm ${view === "overview" ? "bg-accent text-white" : "border border-border text-muted"}`}
              >
                Overview
              </button>
              <button
                onClick={() => setView("sources")}
                className={`rounded-lg px-3 py-1.5 text-sm ${view === "sources" ? "bg-accent text-white" : "border border-border text-muted"}`}
              >
                All sources & data{okCount ? ` (${okCount})` : ""}
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-6">
            <CompanyHeader entity={entity} />

            {view === "overview" ? (
              <>
                {(synthLoading || synthesis) && <ThesisPanel synthesis={synthesis} loading={synthLoading} />}

                {(orderedSignals.length > 0 || pendingWaiting.length > 0) && (
                  <section>
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Signal highlights</h2>
                      {okCount > 0 && (
                        <button onClick={() => setView("sources")} className="text-xs text-accent hover:underline">
                          View all sources & data →
                        </button>
                      )}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {orderedSignals.map((s) => (
                        <StatTile key={s.connectorId} signal={s} onOpen={() => openSource(s.connectorId)} />
                      ))}
                      {pendingWaiting.map((p) => (
                        <div key={p.id} className="rounded-xl border border-border bg-surface p-4">
                          <div className="flex items-center gap-2 text-muted">
                            <span className="text-base">{CATEGORY_ICON[p.category] ?? "•"}</span>
                            <span className="text-sm font-medium">{p.label}</span>
                          </div>
                          <div className="mt-3 h-2 w-1/2 animate-pulse rounded bg-surface-2" />
                          <div className="mt-2 h-2 w-2/3 animate-pulse rounded bg-surface-2" />
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            ) : (
              <>
                <section>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">All sources & data</h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {orderedSignals.map((s) => <SignalCardView key={s.connectorId} signal={s} />)}
                  </div>
                </section>

                {locked.length > 0 && (
                  <section>
                    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
                      Coming soon <span className="font-normal normal-case">— premium & roadmap connectors</span>
                    </h2>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {locked.map((l) => <LockedCardView key={l.id} info={l} />)}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </>
      )}

      {!entity && !loading && !error && (
        <div className="mt-16 text-center text-sm text-muted">
          Try <button className="text-accent" onClick={() => setTicker("NVDA")}>NVDA</button>,{" "}
          <button className="text-accent" onClick={() => setTicker("SHOP")}>SHOP</button>, or{" "}
          <button className="text-accent" onClick={() => setTicker("KO")}>KO</button>.
        </div>
      )}
    </main>
  );
}
