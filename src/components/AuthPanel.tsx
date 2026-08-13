"use client";

import { withTimeout } from "@/lib/async";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Loader2, LogIn, ShieldCheck, Sparkles, Users } from "lucide-react";
import { useState } from "react";

const authFeatures = [
  { label: "Google sign-in", Icon: ShieldCheck },
  { label: "Group spaces", Icon: Users },
  { label: "Instant updates", Icon: Sparkles }
];

export function AuthPanel({ supabase }: { supabase: SupabaseClient }) {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setIsSigningIn(true);
    setError(null);

    try {
      const { error: signInError } = await withTimeout(
        supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: `${window.location.origin}/auth/callback`,
            queryParams: {
              access_type: "offline",
              prompt: "consent"
            }
          }
        }),
        12000,
        "Google sign-in did not answer."
      );

      if (signInError) {
        throw signInError;
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Google sign-in could not start."
      );
      setIsSigningIn(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <section className="mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-6xl items-center gap-8 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-7">
          <div className="inline-flex items-center gap-2 rounded-[8px] border border-ink/10 bg-white/70 px-3 py-2 text-xs font-semibold uppercase text-moss">
            <Sparkles aria-hidden="true" size={15} />
            Real-time private messaging
          </div>
          <div>
            <h1 className="max-w-2xl text-5xl font-semibold tracking-normal text-ink sm:text-6xl">
              Lumen Chat
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-ink/70 sm:text-lg">
              Direct messages, group chats, read receipts, typing indicators, and
              private file sharing with a calm interface built for quick check-ins.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {authFeatures.map(({ label, Icon }) => (
              <div
                className="rounded-[8px] border border-ink/10 bg-white/65 p-4 text-sm font-semibold text-ink shadow-sm"
                key={label}
              >
                <Icon className="mb-3 text-moss" size={20} aria-hidden="true" />
                {label}
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel rounded-[8px] p-6 shadow-soft sm:p-8">
          <div className="rounded-[8px] border border-ink/10 bg-white p-5">
            <div className="mb-6 h-2 w-20 rounded-full bg-jade" />
            <h2 className="text-2xl font-semibold tracking-normal text-ink">
              Sign in to continue
            </h2>
            <p className="mt-3 text-sm leading-6 text-ink/70">
              Lumen uses Google OAuth for account access and your Google profile
              picture for your chat avatar. During onboarding, you will confirm
              your real first and last name.
            </p>

            <button
              className="mt-7 flex w-full items-center justify-center gap-3 rounded-[8px] bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-moss disabled:cursor-not-allowed disabled:bg-ink/55"
              disabled={isSigningIn}
              onClick={signIn}
              type="button"
            >
              {isSigningIn ? (
                <Loader2 className="animate-spin" size={18} aria-hidden="true" />
              ) : (
                <LogIn size={18} aria-hidden="true" />
              )}
              Continue with Google
            </button>

            {error ? (
              <p className="mt-4 rounded-[8px] border border-coral/30 bg-coral/10 px-3 py-2 text-sm text-coral">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
