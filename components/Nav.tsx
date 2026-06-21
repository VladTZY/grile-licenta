"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Acasă" },
  { href: "/practice", label: "Pe rând" },
  { href: "/random", label: "Aleatoriu" },
  { href: "/browse", label: "Toate grilele" },
];

export default function Nav() {
  const path = usePathname();
  return (
    <header className="border-b border-slate-200 bg-white">
      <nav className="mx-auto flex max-w-3xl items-center gap-1 overflow-x-auto px-3 py-3 sm:px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Link href="/" className="mr-2 flex-none font-semibold text-slate-900 sm:mr-3">
          Grile
        </Link>
        {LINKS.slice(1).map((l) => {
          const active = path === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`flex-none whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium transition sm:px-3 ${
                active
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
