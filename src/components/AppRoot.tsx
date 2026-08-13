"use client";

import { AuthPanel } from "@/components/AuthPanel";
import { ChatShell } from "@/components/ChatShell";
import { OnboardingModal } from "@/components/OnboardingModal";
import { RulesModal } from "@/components/RulesModal";
import { SchoolHoursGate } from "@/components/SchoolHoursGate";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

function getString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function splitDisplayName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" ")
  };
}

function googleAvatarFrom(user: User) {
  const metadata = user.user_metadata ?? {};
  return (
    getString(metadata.avatar_url) ||
    getString(metadata.picture) ||
    getString(metadata.photoURL) ||
    null
  );
}

async function ensureProfile(supabase: SupabaseClient, user: User) {
  const email = user.email ?? "";
  const avatarUrl = googleAvatarFrom(user);
  const metadataName =
    getString(user.user_metadata?.full_name) || getString(user.user_metadata?.name);
  const fallbackNames = splitDisplayName(metadataName);

  const { data: existing, error: existingError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existing) {
    const { data, error } = await supabase
      .from("profiles")
      .update({
        email,
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString()
      })
      .eq("id", user.id)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return data as Profile;
  }

  const { data, error } = await supabase
    .from("profiles")
    .insert({
      id: user.id,
      email,
      first_name: fallbackNames.firstName || null,
      last_name: fallbackNames.lastName || null,
      avatar_url: avatarUrl,
      onboarding_complete: false
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data as Profile;
}

function MissingConfiguration() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <section className="glass-panel w-full max-w-xl rounded-[8px] p-8 shadow-soft">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-[8px] bg-coral/15 text-coral">
          <ShieldAlert aria-hidden="true" size={24} />
        </div>
        <h1 className="text-3xl font-semibold tracking-normal text-ink">
          Supabase setup is needed
        </h1>
        <p className="mt-3 text-sm leading-6 text-ink/70">
          Add the Supabase project URL and anon key to the environment file, then
          restart the app. The README walks through each setup step.
        </p>
      </section>
    </main>
  );
}

function AppError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <section className="glass-panel w-full max-w-xl rounded-[8px] p-8 shadow-soft">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-[8px] bg-sun/20 text-ink">
          <AlertTriangle aria-hidden="true" size={24} />
        </div>
        <h1 className="text-3xl font-semibold tracking-normal text-ink">
          Something needs attention
        </h1>
        <p className="mt-3 text-sm leading-6 text-ink/70">{message}</p>
        <button
          className="mt-6 rounded-[8px] bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-moss"
          onClick={onRetry}
          type="button"
        >
          Try again
        </button>
      </section>
    </main>
  );
}

function LoadingState() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="flex items-center gap-3 rounded-[8px] bg-white/70 px-5 py-4 text-sm font-medium text-ink shadow-soft">
        <Loader2 className="animate-spin text-moss" size={18} aria-hidden="true" />
        Opening Lumen Chat
      </div>
    </main>
  );
}

function WithRules({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <RulesModal />
    </>
  );
}

export function AppRoot() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const supabase = useMemo(() => {
    if (!isSupabaseConfigured) {
      return null;
    }

    return createClient();
  }, []);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    const client = supabase;
    let isMounted = true;

    async function loadSessionProfile() {
      setIsLoading(true);
      setError(null);

      try {
        const {
          data: { session },
          error: sessionError
        } = await client.auth.getSession();

        if (sessionError) {
          throw sessionError;
        }

        if (!session?.user) {
          if (isMounted) {
            setProfile(null);
          }
          return;
        }

        const syncedProfile = await ensureProfile(client, session.user);

        if (isMounted) {
          setProfile(syncedProfile);
        }
      } catch (caughtError) {
        if (isMounted) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "The app could not connect to Supabase."
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadSessionProfile();

    const {
      data: { subscription }
    } = client.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        setProfile(null);
        setIsLoading(false);
        return;
      }

      ensureProfile(client, session.user)
        .then((syncedProfile) => setProfile(syncedProfile))
        .catch((caughtError) =>
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "The profile could not be loaded."
          )
        )
        .finally(() => setIsLoading(false));
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [refreshKey, supabase]);

  if (!supabase) {
    return (
      <WithRules>
        <MissingConfiguration />
      </WithRules>
    );
  }

  if (isLoading) {
    return (
      <WithRules>
        <LoadingState />
      </WithRules>
    );
  }

  if (error) {
    return (
      <WithRules>
        <AppError
          message={error}
          onRetry={() => {
            setRefreshKey((key) => key + 1);
          }}
        />
      </WithRules>
    );
  }

  if (!profile) {
    return (
      <WithRules>
        <AuthPanel supabase={supabase} />
      </WithRules>
    );
  }

  if (!profile.onboarding_complete) {
    return (
      <WithRules>
        <OnboardingModal
          profile={profile}
          supabase={supabase}
          onComplete={setProfile}
        />
      </WithRules>
    );
  }

  return (
    <WithRules>
      <SchoolHoursGate>
        <ChatShell
          profile={profile}
          supabase={supabase}
          onProfileUpdated={setProfile}
        />
      </SchoolHoursGate>
    </WithRules>
  );
}
