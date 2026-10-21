import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, ChevronDown, Lightbulb, ListChecks, Sparkles } from "lucide-react";
import { DatasetGate, DatasetSwitcher, type Loaded } from "../components/DatasetGate";
import { Alert, PageHeader } from "../components/ui";
import { FilterBar } from "../components/FilterBar";
import { EMPTY_FILTERS, useView } from "../state/view";
import { buildFacts } from "../engine/insights";
import { getSetting, setSetting } from "../storage/db";
import type { Filters } from "../engine/types";

interface AiAnswer {
  summary: string;
  observations: string[];
  recommendations: string[];
  model: string;
}

export default function InsightsPage() {
  return (
    <DatasetGate base="/insights" title="AI insights">
      {(d) => <Insights key={d.record.id} {...d} />}
    </DatasetGate>
  );
}

function Insights({ record, analysis }: Loaded) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const { rows, kpiValues, insights } = useView(record, analysis, filters);
  const [open, setOpen] = useState<string | null>(null);
  const [ai, setAi] = useState<{ available: boolean; provider: string | null } | null>(null);
  const [consent, setConsent] = useState(false);
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showFacts, setShowFacts] = useState(false);

  useEffect(() => {
    fetch("/api/ai/status")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setAi)
      .catch(() => setAi({ available: false, provider: null }));
    getSetting("aiConsent", false).then(setConsent).catch(() => undefined);
  }, []);

  const facts = buildFacts(record.name, analysis.table, rows, analysis.domain, record.dashboard.kpis, kpiValues, insights, analysis.quality);

  const askAi = async () => {
    setBusy(true);
    setAiError(null);
    setAnswer(null);
    try {
      const res = await fetch("/api/ai/insights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ datasetName: record.name, facts, consent: true }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `AI request failed (${res.status}).`);
      setAnswer(body as AiAnswer);
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={<DatasetSwitcher base="/insights" currentId={record.id} />}
        title="Insights"
        description={`${record.name} — observations calculated from the data, kept separate from recommendations. Every number can be traced to its source.`}
        actions={
          <Link to={`/report/${record.id}`} className="btn-secondary">
            Add to MIS report
          </Link>
        }
      />
      <FilterBar table={analysis.table} profiles={analysis.profiles} filters={filters} onChange={setFilters} shown={rows.length} total={analysis.table.rows.length} />

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <Lightbulb className="h-4 w-4 text-accent" /> Observations <span className="text-xs font-normal text-ink-faint">facts from the data</span>
          </h2>
          {insights.observations.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">Not enough data for automatic observations.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {insights.observations.map((o) => (
                <li key={o.id} className="py-3">
                  <p className="text-sm leading-relaxed">{o.text}</p>
                  <button className="mt-1 inline-flex items-center gap-1 text-xs text-ink-soft hover:text-ink" aria-expanded={open === o.id} onClick={() => setOpen(open === o.id ? null : o.id)}>
                    Evidence <ChevronDown className={`h-3 w-3 transition-transform ${open === o.id ? "rotate-180" : ""}`} />
                  </button>
                  {open === o.id && (
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-sunken p-2.5 text-xs">
                      {o.evidence.map((e) => (
                        <div key={e.label} className="contents">
                          <dt className="text-ink-soft">{e.label}</dt>
                          <dd className="font-medium">{e.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <ListChecks className="h-4 w-4 text-accent" /> Recommendations <span className="text-xs font-normal text-ink-faint">only where the evidence supports one</span>
            </h2>
            {insights.recommendations.length === 0 ? (
              <p className="mt-3 text-sm text-ink-soft">No evidence-based recommendations for this data.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {insights.recommendations.map((r) => (
                  <li key={r.id} className="border-l-2 border-accent/40 pl-3 text-sm leading-relaxed">
                    {r.text}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <Sparkles className="h-4 w-4 text-accent" /> AI narrative <span className="text-xs font-normal text-ink-faint">optional</span>
            </h2>
            {ai === null ? (
              <p className="mt-3 text-sm text-ink-soft">Checking whether AI is set up…</p>
            ) : !ai.available ? (
              <p className="mt-3 text-sm text-ink-soft">
                AI isn't configured on this server, which is fine — everything above is computed without it. To enable it, add a free Groq API key to the server's <code className="rounded bg-sunken px-1">.env</code> (see README).
              </p>
            ) : (
              <div className="mt-3 space-y-3 text-sm">
                <p className="text-ink-soft">
                  The AI receives only the summary below (KPI values, column names and the observations) — never your rows. Any number it writes that isn't in this summary is rejected.
                </p>
                <button className="text-xs text-accent hover:underline" onClick={() => setShowFacts(!showFacts)}>
                  {showFacts ? "Hide" : "Show"} exactly what would be sent
                </button>
                {showFacts && <pre className="max-h-56 overflow-auto rounded-lg bg-sunken p-3 text-xs">{JSON.stringify(facts, null, 2)}</pre>}
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={consent}
                    onChange={(e) => {
                      setConsent(e.target.checked);
                      void setSetting("aiConsent", e.target.checked);
                    }}
                  />
                  <span>I agree to send this summary to the AI provider ({ai.provider}).</span>
                </label>
                <button className="btn-primary" disabled={!consent || busy} onClick={askAi}>
                  <Sparkles className="h-4 w-4" /> {busy ? "Writing…" : "Write AI narrative"}
                </button>
                {aiError && <Alert kind="error">{aiError}</Alert>}
                {answer && (
                  <div className="space-y-3 rounded-lg border border-line p-4">
                    <p className="flex items-center gap-1.5 text-xs text-good">
                      <BadgeCheck className="h-4 w-4" /> Every number was checked against the computed summary · {answer.model}
                    </p>
                    <p className="leading-relaxed">{answer.summary}</p>
                    {answer.observations.length > 0 && (
                      <div>
                        <p className="font-medium">Observations</p>
                        <ul className="mt-1 list-disc space-y-1 pl-5">
                          {answer.observations.map((o, i) => (
                            <li key={i}>{o}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {answer.recommendations.length > 0 && (
                      <div>
                        <p className="font-medium">Recommendations</p>
                        <ul className="mt-1 list-disc space-y-1 pl-5">
                          {answer.recommendations.map((o, i) => (
                            <li key={i}>{o}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="text-xs text-ink-faint">AI text can still be wrong in wording. Treat it as a draft.</p>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
