export function StatusCard({ label, title, value }) {
  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-2xl shadow-slate-950/40">
      <p className="text-sm uppercase tracking-[0.3em] text-slate-400">
        {label}
      </p>
      <h2 className="mt-3 text-xl font-semibold text-slate-100">{title}</h2>
      <p className="mt-2 text-slate-300">{value}</p>
    </article>
  );
}

