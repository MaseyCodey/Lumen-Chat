"use client";

import { formatMinutes, getActiveSchoolLock } from "@/lib/time";
import { AlertTriangle, Check, Clock, ShieldCheck, X } from "lucide-react";
import { ReactNode, useEffect, useMemo, useState } from "react";

type ActiveLock = NonNullable<ReturnType<typeof getActiveSchoolLock>>;

function getAcknowledgementKey(activeLock: ActiveLock) {
  return `lumen-school-lock-${activeLock.dayKey}-${activeLock.id}`;
}

function readAcknowledgement(key: string) {
  try {
    return window.localStorage.getItem(key) === "yes-understood";
  } catch {
    return false;
  }
}

function writeAcknowledgement(key: string) {
  try {
    window.localStorage.setItem(key, "yes-understood");
  } catch {
    // If browser storage is blocked, keep the acknowledgement for this page load.
  }
}

export function SchoolHoursGate({ children }: { children: ReactNode }) {
  const [activeLock, setActiveLock] = useState<ActiveLock | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [acknowledgedKey, setAcknowledgedKey] = useState<string | null>(null);
  const [stayingLocked, setStayingLocked] = useState(false);

  useEffect(() => {
    function refresh() {
      const nextLock = getActiveSchoolLock();
      setActiveLock(nextLock);
      setIsReady(true);

      if (!nextLock) {
        setAcknowledgedKey(null);
        setStayingLocked(false);
        return;
      }

      const key = getAcknowledgementKey(nextLock);
      setAcknowledgedKey(readAcknowledgement(key) ? key : null);
    }

    refresh();
    const interval = window.setInterval(refresh, 30_000);

    return () => window.clearInterval(interval);
  }, []);

  const acknowledgementKey = useMemo(
    () => (activeLock ? getAcknowledgementKey(activeLock) : null),
    [activeLock]
  );

  if (!isReady) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="rounded-[8px] bg-white/70 px-5 py-4 text-sm font-medium text-ink shadow-soft">
          Checking access window
        </div>
      </main>
    );
  }

  if (!activeLock || (acknowledgementKey && acknowledgedKey === acknowledgementKey)) {
    return <>{children}</>;
  }

  function continueAnyway() {
    if (!acknowledgementKey) {
      return;
    }

    writeAcknowledgement(acknowledgementKey);
    setAcknowledgedKey(acknowledgementKey);
    setStayingLocked(false);
  }

  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-4 py-4 sm:py-8">
      <section className="scrollbar-soft glass-panel max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-[8px] p-6 shadow-soft sm:max-h-[calc(100dvh-4rem)] sm:p-8">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-[8px] bg-sun/20 text-ink">
          {stayingLocked ? (
            <ShieldCheck aria-hidden="true" size={24} />
          ) : (
            <Clock aria-hidden="true" size={24} />
          )}
        </div>
        <h1 className="text-3xl font-semibold tracking-normal text-ink">
          {stayingLocked ? "Lumen is paused" : "School-hours lock"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-ink/70">
          {stayingLocked
            ? "Good call. The app will unlock automatically when this window ends."
            : "You could get called out by a teacher, so you may not want to use Lumen Chat right now."}
        </p>

        <div className="mt-6 rounded-[8px] border border-ink/10 bg-white/75 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-coral"
              size={18}
            />
            <div>
              <p className="text-sm font-semibold text-ink">{activeLock.label}</p>
              <p className="mt-1 text-xs leading-5 text-ink/60">
                Unlocks in about {formatMinutes(activeLock.minutesUntilUnlock)}.
              </p>
            </div>
          </div>
        </div>

        {!stayingLocked ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              className="flex items-center justify-center gap-2 rounded-[8px] bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-moss"
              onClick={continueAnyway}
              type="button"
            >
              <Check size={18} aria-hidden="true" />
              Yes, I understand
            </button>
            <button
              className="flex items-center justify-center gap-2 rounded-[8px] border border-ink/15 bg-white px-4 py-3 text-sm font-semibold text-ink transition hover:border-moss hover:text-moss"
              onClick={() => setStayingLocked(true)}
              type="button"
            >
              <X size={18} aria-hidden="true" />
              No, I care about rules
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
