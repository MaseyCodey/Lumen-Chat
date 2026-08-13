"use client";

import { Check, ShieldCheck } from "lucide-react";
import { useState } from "react";

const rules = [
  "Use your real first and last name.",
  "Be respectful. No bullying, harassment, threats, hate, or drama.",
  "Do not share passwords, addresses, phone numbers, or private information.",
  "Only message people you actually know or have a real reason to contact.",
  "Do not upload unsafe, illegal, inappropriate, or embarrassing files.",
  "Respect school and teacher rules, especially during locked school-hour windows.",
  "If something feels wrong, show a trusted adult or teacher."
];

export function RulesModal() {
  const [isOpen, setIsOpen] = useState(true);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/45 px-4 py-4 sm:py-6">
      <section
        aria-labelledby="rules-title"
        aria-modal="true"
        className="scrollbar-soft max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-[8px] border border-ink/10 bg-cloud p-5 shadow-soft sm:max-h-[calc(100dvh-3rem)] sm:p-6"
        role="dialog"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] bg-jade/15 text-moss">
            <ShieldCheck aria-hidden="true" size={24} />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              className="text-2xl font-semibold tracking-normal text-ink"
              id="rules-title"
            >
              Lumen Chat rules
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink/65">
              Read these before using the app. This reminder appears every time
              the website opens.
            </p>
          </div>
        </div>

        <ol className="mt-5 space-y-2">
          {rules.map((rule, index) => (
            <li
              className="flex gap-3 rounded-[8px] border border-ink/10 bg-white/75 px-3 py-3 text-sm leading-5 text-ink"
              key={rule}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-moss text-xs font-bold text-white">
                {index + 1}
              </span>
              <span>{rule}</span>
            </li>
          ))}
        </ol>

        <button
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-[8px] bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-moss"
          onClick={() => setIsOpen(false)}
          type="button"
        >
          <Check size={18} aria-hidden="true" />
          I understand
        </button>
      </section>
    </div>
  );
}
