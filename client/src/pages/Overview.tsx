import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowUpRight, BarChart3, FileSpreadsheet, FileText, Lock, ShieldCheck, Sparkles, Upload } from "lucide-react";
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

      <section className={`card relative overflow-hidden ${has ? "px-6 py-8 sm:px-10" : "px-6 py-14 sm:px-12 sm:py-20"}`}>
        <HeroArt />
        <div className="relative max-w-2xl">
          <h1 className={`${has ? "text-2xl sm:text-3xl" : "text-3xl sm:text-5xl"} font-semibold leading-tight tracking-tight`}>Turn any spreadsheet into intelligent insights</h1>
          <p className="mt-4 max-w-xl text-base text-ink-soft sm:text-lg">
            Upload your Excel or CSV file and automatically generate interactive dashboards, meaningful KPIs, and professional MIS reports.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/upload" className="btn-primary px-5 py-2.5 text-base">
              <Upload className="h-4 w-4" /> Upload your data
            </Link>
            <button className="btn-secondary px-5 py-2.5 text-base" onClick={() => setDemoOpen(true)}>
              <Sparkles className="h-4 w-4 text-accent" /> Explore demo
            </button>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-soft">
            <span className="flex items-center gap-1.5">
              <FileSpreadsheet className="h-4 w-4" /> .xlsx, .xls and .csv, multiple sheets
            </span>
            <span className="flex items-center gap-1.5">
              <Lock className="h-4 w-4" /> Processed in your browser — files are not uploaded
            </span>
          </div>
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
            { Icon: FileText, title: "MIS reports in one click", text: "Executive summary, KPIs with formulas, trends, categories and insights — exported to PDF or Excel." },
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

/** Quiet decorative panel: a stylised spreadsheet turning into bars. */
function HeroArt() {
  const bars = [38, 62, 48, 80, 66, 94, 72];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 hidden w-[42%] items-center justify-center lg:flex">
      <div className="relative h-56 w-80">
        <div className="absolute left-0 top-4 grid w-44 grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line">
          {Array.from({ length: 18 }, (_, i) => (
            <span key={i} className={`h-6 ${i < 3 ? "bg-accent-soft" : "bg-white"}`} />
          ))}
        </div>
        <div className="absolute bottom-2 right-0 flex h-40 w-52 items-end gap-2 rounded-xl border border-line bg-white p-4" style={{ boxShadow: "var(--shadow-card)" }}>
          {bars.map((h, i) => (
            <span key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, background: i === 5 ? "var(--color-accent)" : "var(--color-accent-soft)" }} />
          ))}
        </div>
      </div>
    </div>
  );
}
