import type { Block } from "@/lib/types";

/** Renders a question's ordered content blocks: prose, code, and figures. */
export default function QuestionContent({ content }: { content: Block[] }) {
  return (
    <div className="space-y-3">
      {content.map((b, i) => {
        if (b.type === "code") {
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded-md bg-slate-900 p-3 text-xs leading-relaxed text-slate-100"
            >
              <code>{b.value}</code>
            </pre>
          );
        }
        if (b.type === "image") {
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={b.value}
              alt="Figură"
              className="max-w-full rounded-md border border-slate-200 bg-white"
            />
          );
        }
        return (
          <p key={i} className="prompt text-[15px] leading-relaxed text-slate-900">
            {b.value}
          </p>
        );
      })}
    </div>
  );
}
