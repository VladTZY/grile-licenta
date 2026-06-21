"use client";

export default function HardToggle({
  hard,
  onToggle,
}: {
  hard: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title="Mod greu: amestecă și variantele de răspuns"
      className={`flex flex-none items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition ${
        hard
          ? "border-amber-500 bg-amber-50 text-amber-700"
          : "border-slate-300 text-slate-600 hover:bg-slate-100"
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${hard ? "bg-amber-500" : "bg-slate-300"}`} />
      Mod greu
    </button>
  );
}
