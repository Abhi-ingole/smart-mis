import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowUpRight, BarChart3, FileText, Lock, ShieldCheck, Upload } from "lucide-react";
import { useDatasets } from "../state/datasets";
import { DEMO_FILES, demoJob, useAnalyzer } from "../state/useAnalyzer";
import { AnalysisProgress } from "../components/AnalysisProgress";
import { Alert, Fingerprint, Modal, QualityRing } from "../components/ui";

export default function OverviewPage() {
  const { datasets, error } = useDatasets();
  const [params, setParams] = useSearchParams();
  const [demoOpen, setDemoOpen] = useState(params.get("demo") === "1");
  const [demoError, setDemoError] = useState<string | null>(null);
  const { run, busy, progress, label } = useAnalyzer();
  const navigate = useNavigate();

  useEffect(() => {
    if (params.get("demo") === "1") {
      setDemoOpen(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const loadDemo = async (file: string) => {
    setDemoOpen(false);
    setDemoError(null);
    try {
      const job = await demoJob(file);
      const r = await run([job]);
      if (r.datasets[0]) navigate(`/dashboard/${r.datasets[0].id}`);
      else setDemoError(r.problems[0]?.message ?? "The demo couldn't be loaded.");
    } catch (e) {
      setDemoError((e as Error).message);
    }
  };

  if (busy) return <AnalysisProgress progress={progress} fileLabel={label} />;
  const has = (datasets?.length ?? 0) > 0;

  return (
    <div className="space-y-8">
      {error && <Alert kind="error">{error}</Alert>}
      {demoError && <Alert kind="error">{demoError}</Alert>}

      <section className="card overflow-hidden">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className={`${has ? "p-6 sm:p-8" : "p-6 sm:p-10"}`}>
            <p className="section-title">Smart MIS</p>
            <h1 className={`mt-2 ${has ? "text-2xl" : "text-3xl sm:text-4xl"} font-semibold leading-tight tracking-tight text-ink`}>MIS reports from the files you already have</h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-ink-soft">
              Upload an Excel, CSV or PDF export. Smart MIS reads the columns, checks the data, and builds a dashboard and a report you can send — PDF, Excel or PowerPoint.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/upload" className="btn-primary px-5 py-2.5">
                <Upload className="h-4 w-4" /> Upload a file
              </Link>
              <button className="btn-secondary px-5 py-2.5" onClick={() => setDemoOpen(true)}>
                Try with sample data
              </button>
            </div>
            <p className="mt-6 flex items-center gap-1.5 text-sm text-ink-soft">
              <Lock className="h-4 w-4" /> Files are read in this browser. Nothing is uploaded to a server or saved.
            </p>
          </div>
          <ol className="border-t border-line bg-sunken/70 p-6 text-sm lg:border-l lg:border-t-0">
            {[
              ["Upload", "Excel, CSV, JSON, PDF tables, a ZIP or a folder"],
              ["Check columns", "Types, date formats and meaning — you confirm"],
              ["Clean", "Missing values, duplicates and inconsistencies"],
              ["Dashboard", "KPIs vs last year, monthly and quarterly views"],
              ["Ask", "Questions in plain English, answered from your rows"],
              ["Share", "PDF, Excel, PowerPoint; scheduled email drafts"],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3 py-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-side text-[11px] font-semibold text-white">{i + 1}</span>
                <span>
                  <span className="block font-medium text-ink">{t}</span>
                  <span className="text-ink-soft">{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {has ? (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Recent datasets</h2>
            <Link to="/datasets" className="text-sm text-accent hover:underline">
              All datasets
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {datasets!.slice(0, 6).map((d) => (
              <Link key={d.id} to={`/dashboard/${d.id}`} className="card group block p-5 transition-colors hover:border-accent/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{d.name}</p>
                    <p className="mt-0.5 text-xs text-ink-soft">
                      {d.rowCount.toLocaleString("en-IN")} rows · {d.colCount} columns · {d.domain.domain === "generic" ? "General data" : d.domain.label}
                    </p>
                  </div>
                  <QualityRing score={d.qualityScore} size={40} />
                </div>
                <Fingerprint types={d.schema.filter((c) => !c.excluded).map((c) => c.type)} className="mt-4" />
                <p className="mt-3 flex items-center gap-1 text-sm text-accent opacity-80 group-hover:opacity-100">
                  Open dashboard <ArrowUpRight className="h-3.5 w-3.5" />
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <section className="grid gap-4 md:grid-cols-3">
          {[
            { Icon: BarChart3, title: "Dashboards that fit your data", text: "Columns are detected as dates, amounts, categories or IDs, and the charts follow from that — sales, HR, marks or anything else." },
            { Icon: ShieldCheck, title: "Quality checks before conclusions", text: "Missing values, duplicates, odd values and unclear columns are flagged. You confirm what's ambiguous; the original file is never changed." },
            { Icon: FileText, title: "Reports people can use", text: "Executive summary, KPIs with formulas, trends, categories and insights — as PDF, Excel or PowerPoint." },
          ].map(({ Icon, title, text }) => (
            <div key={title} className="card p-5">
              <Icon className="h-5 w-5 text-accent" />
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-ink-soft">{text}</p>
            </div>
          ))}
        </section>
      )}

      <Modal open={demoOpen} title="Explore with a sample dataset" onClose={() => setDemoOpen(false)} wide>
        <p className="mb-4 text-ink-soft">These are invented example files. Each one is analysed exactly like your own uploads.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {DEMO_FILES.map((d) => (
            <button key={d.file} className="rounded-xl border border-line p-4 text-left transition-colors hover:border-accent/50 hover:bg-accent-soft/40" onClick={() => loadDemo(d.file)}>
              <p className="font-medium">{d.title}</p>
              <p className="mt-1 text-xs text-ink-soft">{d.blurb}</p>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
