"use client";

import { withTimeout } from "@/lib/async";
import type { Profile } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";

export function OnboardingModal({
  profile,
  supabase,
  onComplete
}: {
  profile: Profile;
  supabase: SupabaseClient;
  onComplete: (profile: Profile) => void;
}) {
  const [firstName, setFirstName] = useState(profile.first_name ?? "");
  const [lastName, setLastName] = useState(profile.last_name ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanFirstName = firstName.trim();
    const cleanLastName = lastName.trim();

    if (!cleanFirstName || !cleanLastName) {
      setError("Enter your real first and last name to continue.");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const { data, error: updateError } = await withTimeout(
        supabase
          .from("profiles")
          .update({
            first_name: cleanFirstName,
            last_name: cleanLastName,
            onboarding_complete: true,
            real_name_confirmed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("id", profile.id)
          .select("*")
          .single(),
        12000,
        "The server did not answer while saving your name."
      );

      if (updateError) {
        throw updateError;
      }

      onComplete(data as Profile);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Your name could not be saved."
      );
      setIsSaving(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <section className="glass-panel w-full max-w-lg rounded-[8px] p-6 shadow-soft sm:p-8">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-[8px] bg-jade/15 text-moss">
          <ShieldCheck aria-hidden="true" size={24} />
        </div>
        <h1 className="text-3xl font-semibold tracking-normal text-ink">
          Use your real name
        </h1>
        <p className="mt-3 text-sm leading-6 text-ink/70">
          Lumen requires a real first and last name so classmates and teammates
          can find the right person by name or email.
        </p>

        {profile.avatar_url ? (
          <div className="mt-6 flex items-center gap-3 rounded-[8px] border border-ink/10 bg-white/70 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              className="h-12 w-12 rounded-[8px] object-cover"
              src={profile.avatar_url}
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                Google profile picture connected
              </p>
              <p className="truncate text-xs text-ink/60">{profile.email}</p>
            </div>
          </div>
        ) : null}

        <form className="mt-6 space-y-4" onSubmit={saveProfile}>
          <label className="block">
            <span className="text-xs font-semibold uppercase text-ink/60">
              First name
            </span>
            <input
              className="mt-2 w-full rounded-[8px] border border-ink/15 bg-white px-3 py-3 text-sm text-ink shadow-sm"
              onChange={(event) => setFirstName(event.target.value)}
              value={firstName}
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase text-ink/60">
              Last name
            </span>
            <input
              className="mt-2 w-full rounded-[8px] border border-ink/15 bg-white px-3 py-3 text-sm text-ink shadow-sm"
              onChange={(event) => setLastName(event.target.value)}
              value={lastName}
            />
          </label>

          {error ? (
            <p className="rounded-[8px] border border-coral/30 bg-coral/10 px-3 py-2 text-sm text-coral">
              {error}
            </p>
          ) : null}

          <button
            className="flex w-full items-center justify-center gap-2 rounded-[8px] bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-moss disabled:cursor-not-allowed disabled:bg-ink/55"
            disabled={isSaving}
            type="submit"
          >
            {isSaving ? (
              <Loader2 className="animate-spin" size={18} aria-hidden="true" />
            ) : (
              <Check size={18} aria-hidden="true" />
            )}
            Confirm real name
          </button>
        </form>
      </section>
    </main>
  );
}
