"use client";

import { oneGigabyte } from "@/lib/types";
import { withTimeout } from "@/lib/async";
import type {
  Attachment,
  AttachmentKind,
  Conversation,
  ConversationMember,
  ConversationSummary,
  Message,
  Profile
} from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import clsx from "clsx";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  FileText,
  Image as ImageIcon,
  Loader2,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
  Send,
  UserPlus,
  Users,
  Video,
  WifiOff,
  X
} from "lucide-react";
import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

const attachmentBucket = "chat-attachments";

type Notice = {
  type: "error" | "info" | "success";
  text: string;
} | null;

type LoadOptions = {
  markRead?: boolean;
  refreshConversations?: boolean;
  silent?: boolean;
};

type RealtimeStatus = "connecting" | "connected" | "reconnecting";

type ChatShellProps = {
  profile: Profile;
  supabase: SupabaseClient;
  onProfileUpdated?: (profile: Profile) => void;
};

function single<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function profileName(profile?: Profile | null) {
  if (!profile) {
    return "Unknown person";
  }

  return (
    profile.full_name ||
    [profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
    profile.email
  );
}

function initialsFor(profile?: Profile | null) {
  const name = profileName(profile);
  const parts = name.split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "LC";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function normalizeMember(row: Record<string, unknown>): ConversationMember {
  return {
    conversation_id: String(row.conversation_id),
    profile_id: String(row.profile_id),
    role: row.role as ConversationMember["role"],
    joined_at: String(row.joined_at),
    last_read_at: row.last_read_at ? String(row.last_read_at) : null,
    profile: single(row.profile as Profile | Profile[] | null) ?? undefined
  };
}

function normalizeMessage(row: Record<string, unknown>): Message {
  return {
    id: String(row.id),
    conversation_id: String(row.conversation_id),
    sender_id: String(row.sender_id),
    body: row.body ? String(row.body) : null,
    message_type: row.message_type as Message["message_type"],
    attachment_id: row.attachment_id ? String(row.attachment_id) : null,
    created_at: String(row.created_at),
    updated_at: row.updated_at ? String(row.updated_at) : null,
    deleted_at: row.deleted_at ? String(row.deleted_at) : null,
    attachment: single(row.attachment as Attachment | Attachment[] | null),
    reads: Array.isArray(row.reads) ? (row.reads as Message["reads"]) : []
  };
}

function safeSearchTerm(value: string) {
  return value
    .replace(/[^a-zA-Z0-9@._+\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeFileName(value: string) {
  const clean = value.replace(/[^\w.\-]+/g, "_").replace(/^_+|_+$/g, "");
  return clean.slice(0, 140) || "attachment";
}

function attachmentKindFor(file: File): AttachmentKind {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();

  if (type === "image/gif" || name.endsWith(".gif")) {
    return "gif";
  }

  if (type.startsWith("image/")) {
    return "image";
  }

  if (type.startsWith("video/")) {
    return "video";
  }

  return "file";
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${bytes} B`;
}

function formatMessageTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatConversationTime(value?: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();

  return new Intl.DateTimeFormat("en-US", {
    month: isToday ? undefined : "short",
    day: isToday ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function formatAttachmentExpiry(value?: string | null) {
  if (!value) {
    return "Deletes after 7 days";
  }

  return `Deletes ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value))}`;
}

function isAttachmentExpired(attachment: Attachment) {
  return Date.parse(attachment.expires_at) <= Date.now();
}

function conversationTitle(summary: ConversationSummary, currentUserId: string) {
  if (summary.conversation.type === "group") {
    return summary.conversation.title || "Untitled group";
  }

  const otherMember = summary.members.find(
    (member) => member.profile_id !== currentUserId
  );

  return profileName(otherMember?.profile);
}

function conversationSubtitle(summary: ConversationSummary, currentUserId: string) {
  if (summary.conversation.type === "group") {
    const otherCount = summary.members.filter(
      (member) => member.profile_id !== currentUserId
    ).length;
    return `${summary.members.length} member${summary.members.length === 1 ? "" : "s"}${
      otherCount ? "" : ""
    }`;
  }

  const otherMember = summary.members.find(
    (member) => member.profile_id !== currentUserId
  );

  return otherMember?.profile?.email ?? "Direct message";
}

function Avatar({
  profile,
  label,
  size = "md"
}: {
  profile?: Profile | null;
  label?: string;
  size?: "sm" | "md" | "lg";
}) {
  const dimensions = {
    sm: "h-8 w-8 text-[11px]",
    md: "h-10 w-10 text-xs",
    lg: "h-12 w-12 text-sm"
  };

  if (profile?.avatar_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={label ?? profileName(profile)}
        className={clsx("shrink-0 rounded-[8px] object-cover", dimensions[size])}
        src={profile.avatar_url}
      />
    );
  }

  return (
    <div
      aria-label={label ?? profileName(profile)}
      className={clsx(
        "flex shrink-0 items-center justify-center rounded-[8px] bg-moss text-center font-bold text-white",
        dimensions[size]
      )}
    >
      {initialsFor(profile)}
    </div>
  );
}

function ConversationAvatar({
  summary,
  currentUserId
}: {
  summary: ConversationSummary;
  currentUserId: string;
}) {
  if (summary.conversation.type === "direct") {
    const otherMember = summary.members.find(
      (member) => member.profile_id !== currentUserId
    );
    return <Avatar profile={otherMember?.profile} />;
  }

  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-ink text-white">
      <Users aria-hidden="true" size={19} />
    </div>
  );
}

function AttachmentIcon({ kind }: { kind: AttachmentKind }) {
  if (kind === "image" || kind === "gif") {
    return <ImageIcon aria-hidden="true" size={18} />;
  }

  if (kind === "video") {
    return <Video aria-hidden="true" size={18} />;
  }

  return <FileText aria-hidden="true" size={18} />;
}

export function ChatShell({ profile, supabase }: ChatShellProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<string, string>>({});
  const [profileSearch, setProfileSearch] = useState("");
  const [profileResults, setProfileResults] = useState<Profile[]>([]);
  const [isSearchingProfiles, setIsSearchingProfiles] = useState(false);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [isGroupComposerOpen, setIsGroupComposerOpen] = useState(false);
  const [typingProfiles, setTypingProfiles] = useState<Profile[]>([]);
  const [isOffline, setIsOffline] = useState(false);
  const [realtimeStatus, setRealtimeStatus] =
    useState<RealtimeStatus>("connecting");
  const [realtimeRetryKey, setRealtimeRetryKey] = useState(0);
  const activeMessageIdsRef = useRef(new Set<string>());
  const conversationRefreshTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastTypingAtRef = useRef(0);
  const lastReadAtByConversationRef = useRef(new Map<string, string | null>());
  const messageRefreshTimerRef = useRef<number | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const realtimeReconnectTimerRef = useRef<number | null>(null);

  const activeSummary = useMemo(
    () =>
      conversations.find(
        (summary) => summary.conversation.id === activeConversationId
      ) ?? null,
    [activeConversationId, conversations]
  );

  const memberProfiles = useMemo(() => {
    const map = new Map<string, Profile>();
    activeSummary?.members.forEach((member) => {
      if (member.profile) {
        map.set(member.profile_id, member.profile);
      }
    });
    return map;
  }, [activeSummary]);

  const loadConversations = useCallback(async (options: LoadOptions = {}) => {
    if (!options.silent) {
      setIsLoadingConversations(true);
      setNotice(null);
    }

    try {
      const { data: membershipRows, error: membershipError } = await withTimeout(
        supabase
          .from("conversation_members")
          .select("conversation_id, role, joined_at, last_read_at, conversation:conversations(*)")
          .eq("profile_id", profile.id),
        12000,
        "The server did not answer while loading chats."
      );

      if (membershipError) {
        throw membershipError;
      }

      const memberships = (membershipRows ?? []) as Array<
        Record<string, unknown> & { conversation?: Conversation | Conversation[] }
      >;
      const conversationIds = memberships.map((row) => String(row.conversation_id));
      lastReadAtByConversationRef.current = new Map(
        memberships.map((row) => [
          String(row.conversation_id),
          row.last_read_at ? String(row.last_read_at) : null
        ])
      );

      if (conversationIds.length === 0) {
        setConversations([]);
        setActiveConversationId(null);
        return;
      }

      const [{ data: memberRows, error: membersError }, { data: messageRows, error: messagesError }] =
        await withTimeout(
          Promise.all([
            supabase
              .from("conversation_members")
              .select("conversation_id, profile_id, role, joined_at, last_read_at, profile:profiles(*)")
              .in("conversation_id", conversationIds),
            supabase
              .from("messages")
              .select("*, attachment:attachments(*)")
              .in("conversation_id", conversationIds)
              .is("deleted_at", null)
              .order("created_at", { ascending: false })
              .limit(400)
          ]),
          12000,
          "The server did not answer while refreshing chats."
        );

      if (membersError) {
        throw membersError;
      }

      if (messagesError) {
        throw messagesError;
      }

      const membersByConversation = new Map<string, ConversationMember[]>();
      (memberRows ?? []).forEach((row) => {
        const member = normalizeMember(row as Record<string, unknown>);
        const list = membersByConversation.get(member.conversation_id) ?? [];
        list.push(member);
        membersByConversation.set(member.conversation_id, list);
      });

      const messagesByConversation = new Map<string, Message[]>();
      (messageRows ?? []).forEach((row) => {
        const message = normalizeMessage(row as Record<string, unknown>);
        const list = messagesByConversation.get(message.conversation_id) ?? [];
        list.push(message);
        messagesByConversation.set(message.conversation_id, list);
      });

      const mappedSummaries: Array<ConversationSummary | null> = memberships
        .map((row) => {
          const conversation = single(row.conversation) as Conversation | null;
          if (!conversation) {
            return null;
          }

          const conversationMessages =
            messagesByConversation.get(conversation.id)?.sort((a, b) => {
              return Date.parse(b.created_at) - Date.parse(a.created_at);
            }) ?? [];
          const currentMembership = row;
          const lastRead = currentMembership.last_read_at
            ? Date.parse(String(currentMembership.last_read_at))
            : 0;
          const latestMessage: Message | null = conversationMessages[0] ?? null;

          return {
            conversation,
            members: membersByConversation.get(conversation.id) ?? [],
            latestMessage,
            unreadCount: conversationMessages.filter(
              (message) =>
                message.sender_id !== profile.id &&
                Date.parse(message.created_at) > lastRead
            ).length
          } satisfies ConversationSummary;
        });

      const nextSummaries = mappedSummaries
        .filter((summary): summary is ConversationSummary => summary !== null)
        .sort((a, b) => {
          const aTime =
            a.latestMessage?.created_at ??
            a.conversation.last_message_at ??
            a.conversation.created_at;
          const bTime =
            b.latestMessage?.created_at ??
            b.conversation.last_message_at ??
            b.conversation.created_at;
          return Date.parse(bTime) - Date.parse(aTime);
        });

      setConversations(nextSummaries);
      setActiveConversationId((current) => {
        if (current && nextSummaries.some((summary) => summary.conversation.id === current)) {
          return current;
        }

        return nextSummaries[0]?.conversation.id ?? null;
      });
    } catch (caughtError) {
      if (options.silent) {
        setRealtimeStatus("reconnecting");
      } else {
        setNotice({
          type: "error",
          text:
            caughtError instanceof Error
              ? caughtError.message
              : "Conversations could not be loaded."
        });
      }
    } finally {
      if (!options.silent) {
        setIsLoadingConversations(false);
      }
    }
  }, [profile.id, supabase]);

  const signAttachmentUrls = useCallback(
    async (nextMessages: Message[]) => {
      const attachments = nextMessages
        .map((message) => message.attachment)
        .filter((attachment): attachment is Attachment => {
          if (!attachment) {
            return false;
          }

          return !isAttachmentExpired(attachment);
        });

      if (attachments.length === 0) {
        return;
      }

      const entries = await Promise.all(
        attachments.map(async (attachment) => {
          const { data } = await withTimeout(
            supabase.storage
              .from(attachmentBucket)
              .createSignedUrl(attachment.storage_path, 60 * 60),
            8000,
            "The private file link could not be prepared."
          ).catch(() => ({ data: null }));

          return [attachment.id, data?.signedUrl ?? ""] as const;
        })
      );

      setAttachmentUrls((current) => ({
        ...current,
        ...Object.fromEntries(entries.filter(([, url]) => Boolean(url)))
      }));
    },
    [supabase]
  );

  const markRead = useCallback(
    async (conversationId: string, nextMessages: Message[]) => {
      const lastReadAt = lastReadAtByConversationRef.current.get(conversationId);
      const lastReadMs = lastReadAt ? Date.parse(lastReadAt) : 0;
      const unreadMessages = nextMessages.filter(
        (message) =>
          message.sender_id !== profile.id && Date.parse(message.created_at) > lastReadMs
      );
      const now = new Date().toISOString();
      const missingReadRows = unreadMessages
        .filter(
          (message) =>
            !message.reads?.some((read) => read.profile_id === profile.id)
        )
        .map((message) => ({
          message_id: message.id,
          profile_id: profile.id,
          read_at: now
        }));

      if (unreadMessages.length === 0 && missingReadRows.length === 0) {
        return;
      }

      if (unreadMessages.length > 0) {
        await withTimeout(
          supabase
            .from("conversation_members")
            .update({ last_read_at: now })
            .eq("conversation_id", conversationId)
            .eq("profile_id", profile.id),
          8000,
          "Read status could not be saved."
        );

        lastReadAtByConversationRef.current.set(conversationId, now);
      }

      if (missingReadRows.length > 0) {
        await withTimeout(
          supabase
            .from("message_reads")
            .upsert(missingReadRows, { onConflict: "message_id,profile_id" }),
          8000,
          "Read receipts could not be saved."
        );
      }
    },
    [profile.id, supabase]
  );

  const loadMessages = useCallback(
    async (conversationId: string, options: LoadOptions = {}) => {
      if (!options.silent) {
        setIsLoadingMessages(true);
        setMessageError(null);
      }

      try {
        const { data, error } = await withTimeout(
          supabase
            .from("messages")
            .select("*, attachment:attachments(*), reads:message_reads(*)")
            .eq("conversation_id", conversationId)
            .is("deleted_at", null)
            .order("created_at", { ascending: true })
            .limit(300),
          12000,
          "The server did not answer while opening this chat."
        );

        if (error) {
          throw error;
        }

        const nextMessages = (data ?? []).map((row) =>
          normalizeMessage(row as Record<string, unknown>)
        );

        activeMessageIdsRef.current = new Set(
          nextMessages.map((message) => message.id)
        );
        setMessages(nextMessages);
        void signAttachmentUrls(nextMessages);
        if (options.markRead !== false) {
          void markRead(conversationId, nextMessages).catch(() => undefined);
        }
        if (options.refreshConversations !== false) {
          void loadConversations({ silent: true });
        }
      } catch (caughtError) {
        if (options.silent) {
          setRealtimeStatus("reconnecting");
        } else {
          setMessageError(
            caughtError instanceof Error
              ? caughtError.message
              : "Messages could not be opened."
          );
        }
      } finally {
        if (!options.silent) {
          setIsLoadingMessages(false);
        }
      }
    },
    [loadConversations, markRead, signAttachmentUrls, supabase]
  );

  const loadTyping = useCallback(
    async (conversationId: string) => {
      const { data } = await withTimeout(
        supabase
          .from("typing_indicators")
          .select("profile:profiles(*)")
          .eq("conversation_id", conversationId)
          .neq("profile_id", profile.id)
          .gt("expires_at", new Date().toISOString()),
        5000,
        "Typing indicators could not be loaded."
      ).catch(() => ({ data: null }));

      const nextTypingProfiles = (data ?? [])
        .map((row) => single((row as Record<string, unknown>).profile as Profile | Profile[] | null))
        .filter((typingProfile): typingProfile is Profile => Boolean(typingProfile));

      setTypingProfiles(nextTypingProfiles);
    },
    [profile.id, supabase]
  );

  const queueConversationsRefresh = useCallback(() => {
    if (conversationRefreshTimerRef.current !== null) {
      return;
    }

    conversationRefreshTimerRef.current = window.setTimeout(() => {
      conversationRefreshTimerRef.current = null;
      void loadConversations({ silent: true });
    }, 350);
  }, [loadConversations]);

  const queueMessagesRefresh = useCallback(
    (conversationId: string, options: LoadOptions = {}) => {
      if (messageRefreshTimerRef.current !== null) {
        return;
      }

      messageRefreshTimerRef.current = window.setTimeout(() => {
        messageRefreshTimerRef.current = null;
        void loadMessages(conversationId, { silent: true, ...options });
      }, 350);
    },
    [loadMessages]
  );

  const scheduleRealtimeReconnect = useCallback(() => {
    setRealtimeStatus("reconnecting");

    if (realtimeReconnectTimerRef.current !== null) {
      return;
    }

    realtimeReconnectTimerRef.current = window.setTimeout(() => {
      realtimeReconnectTimerRef.current = null;
      setRealtimeRetryKey((key) => key + 1);
    }, 1500);
  }, []);

  const handleRealtimeStatus = useCallback(
    (status: string) => {
      if (status === "SUBSCRIBED") {
        setRealtimeStatus("connected");
        return;
      }

      if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT"
      ) {
        scheduleRealtimeReconnect();
      }
    },
    [scheduleRealtimeReconnect]
  );

  const retryRealtimeConnection = useCallback(() => {
    if (realtimeReconnectTimerRef.current !== null) {
      window.clearTimeout(realtimeReconnectTimerRef.current);
      realtimeReconnectTimerRef.current = null;
    }

    setRealtimeStatus("connecting");
    setRealtimeRetryKey((key) => key + 1);
    void loadConversations({ silent: true });

    if (activeConversationId) {
      void loadMessages(activeConversationId, { silent: true });
    }
  }, [activeConversationId, loadConversations, loadMessages]);

  const announceTyping = useCallback(async () => {
    if (!activeConversationId) {
      return;
    }

    const now = Date.now();
    if (now - lastTypingAtRef.current < 1500) {
      return;
    }

    lastTypingAtRef.current = now;
    try {
      await withTimeout(
        supabase.from("typing_indicators").upsert(
          {
            conversation_id: activeConversationId,
            profile_id: profile.id,
            updated_at: new Date().toISOString(),
            expires_at: new Date(now + 6000).toISOString()
          },
          { onConflict: "conversation_id,profile_id" }
        ),
        5000,
        "Typing status could not be saved."
      );
    } catch {
      // Typing indicators are best-effort and should never interrupt chatting.
    }
  }, [activeConversationId, profile.id, supabase]);

  useEffect(() => {
    setIsOffline(!window.navigator.onLine);

    function onOnline() {
      setIsOffline(false);
      retryRealtimeConnection();
    }

    function onOffline() {
      setIsOffline(true);
      setRealtimeStatus("reconnecting");
    }

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [retryRealtimeConnection]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    return () => {
      if (conversationRefreshTimerRef.current !== null) {
        window.clearTimeout(conversationRefreshTimerRef.current);
      }

      if (messageRefreshTimerRef.current !== null) {
        window.clearTimeout(messageRefreshTimerRef.current);
      }

      if (realtimeReconnectTimerRef.current !== null) {
        window.clearTimeout(realtimeReconnectTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const term = safeSearchTerm(profileSearch);

    if (term.length < 2) {
      setProfileResults([]);
      setIsSearchingProfiles(false);
      return;
    }

    setIsSearchingProfiles(true);
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      try {
        const { data, error } = await withTimeout(
          supabase
            .from("profiles")
            .select("*")
            .neq("id", profile.id)
            .eq("onboarding_complete", true)
            .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`)
            .limit(8),
          10000,
          "People search took too long."
        );

        if (cancelled) {
          return;
        }

        if (error) {
          setNotice({ type: "error", text: error.message });
          setProfileResults([]);
        } else {
          setProfileResults((data ?? []) as Profile[]);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setNotice({
            type: "error",
            text:
              caughtError instanceof Error
                ? caughtError.message
                : "People search failed."
          });
          setProfileResults([]);
        }
      } finally {
        if (!cancelled) {
          setIsSearchingProfiles(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [profile.id, profileSearch, supabase]);

  useEffect(() => {
    setRealtimeStatus("connecting");
    const subscriptionTimeout = window.setTimeout(
      scheduleRealtimeReconnect,
      10000
    );
    const channel = supabase
      .channel(`conversation-list-${profile.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversation_members" },
        () => queueConversationsRefresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        () => queueConversationsRefresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages" },
        () => queueConversationsRefresh()
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          window.clearTimeout(subscriptionTimeout);
        }

        handleRealtimeStatus(status);
      });

    return () => {
      window.clearTimeout(subscriptionTimeout);
      void supabase.removeChannel(channel);
    };
  }, [
    handleRealtimeStatus,
    profile.id,
    queueConversationsRefresh,
    realtimeRetryKey,
    scheduleRealtimeReconnect,
    supabase
  ]);

  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      setTypingProfiles([]);
      activeMessageIdsRef.current = new Set();
      return;
    }

    void loadMessages(activeConversationId);
    void loadTyping(activeConversationId);

    const typingInterval = window.setInterval(() => {
      void loadTyping(activeConversationId);
    }, 3500);
    const subscriptionTimeout = window.setTimeout(
      scheduleRealtimeReconnect,
      10000
    );

    const channel = supabase
      .channel(`conversation-room-${activeConversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${activeConversationId}`
        },
        () => {
          queueMessagesRefresh(activeConversationId);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "attachments",
          filter: `conversation_id=eq.${activeConversationId}`
        },
        () => queueMessagesRefresh(activeConversationId, { markRead: false })
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "typing_indicators",
          filter: `conversation_id=eq.${activeConversationId}`
        },
        () => void loadTyping(activeConversationId)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reads" },
        (payload) => {
          const row = (payload.new ?? payload.old) as
            | Record<string, unknown>
            | undefined;
          const messageId = row?.message_id;

          if (
            typeof messageId === "string" &&
            activeMessageIdsRef.current.has(messageId)
          ) {
            queueMessagesRefresh(activeConversationId, {
              markRead: false,
              refreshConversations: false
            });
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          window.clearTimeout(subscriptionTimeout);
        }

        handleRealtimeStatus(status);
      });

    return () => {
      window.clearInterval(typingInterval);
      window.clearTimeout(subscriptionTimeout);
      if (messageRefreshTimerRef.current !== null) {
        window.clearTimeout(messageRefreshTimerRef.current);
        messageRefreshTimerRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [
    activeConversationId,
    handleRealtimeStatus,
    loadMessages,
    loadTyping,
    queueMessagesRefresh,
    realtimeRetryKey,
    scheduleRealtimeReconnect,
    supabase
  ]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, activeConversationId]);

  async function startDirectConversation(target: Profile) {
    setNotice(null);

    try {
      const { data, error } = await withTimeout(
        supabase.rpc("create_direct_conversation", {
          target_profile_id: target.id
        }),
        12000,
        "The server did not answer while starting that chat."
      );

      if (error) {
        throw error;
      }

      setProfileSearch("");
      setProfileResults([]);
      setActiveConversationId(String(data));
      queueConversationsRefresh();
    } catch (caughtError) {
      setNotice({
        type: "error",
        text:
          caughtError instanceof Error
            ? caughtError.message
            : "That chat could not be started."
      });
    }
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setNotice(null);

    if (!file) {
      setSelectedFile(null);
      return;
    }

    if (file.size > oneGigabyte) {
      setSelectedFile(null);
      event.target.value = "";
      setNotice({
        type: "error",
        text: "That file is larger than the 1 GB limit."
      });
      return;
    }

    setSelectedFile(file);
  }

  function clearSelectedFile() {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function uploadAttachment(conversationId: string, file: File) {
    const attachmentId = crypto.randomUUID();
    const cleanName = sanitizeFileName(file.name);
    const storagePath = `${conversationId}/${attachmentId}/${cleanName}`;
    const kind = attachmentKindFor(file);

    const { error: uploadError } = await supabase.storage
      .from(attachmentBucket)
      .upload(storagePath, file, {
        cacheControl: "3600",
        contentType: file.type || "application/octet-stream",
        upsert: false
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data, error } = await withTimeout(
      supabase
        .from("attachments")
        .insert({
          id: attachmentId,
          conversation_id: conversationId,
          uploader_id: profile.id,
          storage_path: storagePath,
          file_name: file.name,
          file_type: file.type || "application/octet-stream",
          file_size: file.size,
          kind,
          expires_at: new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000
          ).toISOString()
        })
        .select("*")
        .single(),
      12000,
      "The server did not answer while saving file details."
    );

    if (error) {
      void supabase.storage.from(attachmentBucket).remove([storagePath]);
      throw error;
    }

    return data as Attachment;
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!activeConversationId || isSending || isOffline) {
      return;
    }

    const cleanBody = messageText.trim();

    if (!cleanBody && !selectedFile) {
      return;
    }

    setIsSending(true);
    setNotice(null);

    try {
      const attachment = selectedFile
        ? await uploadAttachment(activeConversationId, selectedFile)
        : null;

      const { data, error } = await withTimeout(
        supabase
          .from("messages")
          .insert({
            conversation_id: activeConversationId,
            sender_id: profile.id,
            body: cleanBody || null,
            message_type: attachment ? "attachment" : "text",
            attachment_id: attachment?.id ?? null
          })
          .select("*, attachment:attachments(*), reads:message_reads(*)")
          .single(),
        12000,
        "The server did not answer while sending."
      );

      if (error) {
        throw error;
      }

      const sentMessage = normalizeMessage(data as Record<string, unknown>);
      activeMessageIdsRef.current.add(sentMessage.id);
      setMessages((current) =>
        current.some((message) => message.id === sentMessage.id)
          ? current
          : [...current, sentMessage]
      );
      void signAttachmentUrls([sentMessage]);
      setMessageText("");
      clearSelectedFile();
      void withTimeout(
        supabase
          .from("typing_indicators")
          .delete()
          .eq("conversation_id", activeConversationId)
          .eq("profile_id", profile.id),
        8000,
        "Typing status could not be cleared."
      ).catch(() => undefined);
      queueMessagesRefresh(activeConversationId, {
        markRead: false,
        refreshConversations: false
      });
      queueConversationsRefresh();
    } catch (caughtError) {
      setNotice({
        type: "error",
        text:
          caughtError instanceof Error
            ? caughtError.message
            : "The message could not be sent."
      });
    } finally {
      setIsSending(false);
    }
  }

  const activeMembers = activeSummary?.members ?? [];
  const activeTitle = activeSummary
    ? conversationTitle(activeSummary, profile.id)
    : "Select a conversation";

  return (
    <main className="h-[100dvh] overflow-hidden px-3 py-3 sm:px-4 sm:py-4">
      <div className="glass-panel mx-auto flex h-full max-w-7xl overflow-hidden rounded-[8px] shadow-soft">
        <aside
          className={clsx(
            "flex w-full min-w-0 flex-col border-ink/10 bg-white/70 lg:w-[23rem] lg:border-r",
            activeConversationId ? "hidden lg:flex" : "flex"
          )}
        >
          <div className="border-b border-ink/10 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-[8px] bg-ink text-white">
                  <MessageCircle aria-hidden="true" size={22} />
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-xl font-semibold tracking-normal text-ink">
                    Lumen
                  </h1>
                  <p className="truncate text-xs text-ink/60">
                    Signed in as {profileName(profile)}
                  </p>
                </div>
              </div>
              <button
                aria-label="Sign out"
                className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-ink/10 bg-white text-ink transition hover:border-coral hover:text-coral"
                onClick={() => void supabase.auth.signOut()}
                title="Sign out"
                type="button"
              >
                <LogOut size={18} aria-hidden="true" />
              </button>
            </div>

            {isOffline ? (
              <div className="mt-4 flex items-start gap-2 rounded-[8px] border border-coral/25 bg-coral/10 px-3 py-2 text-xs leading-5 text-coral">
                <WifiOff className="mt-0.5 shrink-0" size={15} aria-hidden="true" />
                You are offline. Existing messages stay visible, but sending is paused.
              </div>
            ) : null}

            {!isOffline && realtimeStatus !== "connected" ? (
              <div className="mt-4 flex items-center gap-2 rounded-[8px] border border-sun/35 bg-sun/15 px-3 py-2 text-xs leading-5 text-ink/70">
                <Loader2
                  className="shrink-0 animate-spin text-moss"
                  size={15}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  {realtimeStatus === "reconnecting"
                    ? "Live updates are reconnecting."
                    : "Connecting live updates."}
                </span>
                {realtimeStatus === "reconnecting" ? (
                  <button
                    className="shrink-0 rounded-[8px] border border-ink/10 bg-white px-2 py-1 font-semibold text-ink transition hover:border-moss hover:text-moss"
                    onClick={retryRealtimeConnection}
                    type="button"
                  >
                    Retry
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="mt-4 flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40"
                  size={17}
                />
                <input
                  aria-label="Find people by name or email"
                  className="h-11 w-full rounded-[8px] border border-ink/10 bg-white pl-9 pr-3 text-sm text-ink shadow-sm"
                  onChange={(event) => setProfileSearch(event.target.value)}
                  placeholder="Find by name or email"
                  value={profileSearch}
                />
              </div>
              <button
                aria-label="Create group chat"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] bg-moss text-white transition hover:bg-ink"
                onClick={() => setIsGroupComposerOpen(true)}
                title="Create group chat"
                type="button"
              >
                <Plus size={20} aria-hidden="true" />
              </button>
            </div>
          </div>

          {notice ? (
            <div
              className={clsx(
                "mx-4 mt-4 rounded-[8px] border px-3 py-2 text-sm",
                notice.type === "error" &&
                  "border-coral/30 bg-coral/10 text-coral",
                notice.type === "success" &&
                  "border-jade/30 bg-jade/10 text-moss",
                notice.type === "info" && "border-ink/10 bg-white text-ink/70"
              )}
            >
              {notice.text}
            </div>
          ) : null}

          {profileSearch.trim().length >= 2 ? (
            <div className="border-b border-ink/10 p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase text-ink/50">People</p>
                {isSearchingProfiles ? (
                  <Loader2
                    className="animate-spin text-moss"
                    size={15}
                    aria-hidden="true"
                  />
                ) : null}
              </div>

              <div className="space-y-2">
                {profileResults.map((result) => (
                  <button
                    className="flex w-full items-center gap-3 rounded-[8px] border border-ink/10 bg-white px-3 py-2 text-left transition hover:border-moss"
                    key={result.id}
                    onClick={() => void startDirectConversation(result)}
                    type="button"
                  >
                    <Avatar profile={result} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {profileName(result)}
                      </span>
                      <span className="block truncate text-xs text-ink/55">
                        {result.email}
                      </span>
                    </span>
                  </button>
                ))}

                {!isSearchingProfiles && profileResults.length === 0 ? (
                  <p className="rounded-[8px] border border-dashed border-ink/15 px-3 py-4 text-center text-sm text-ink/55">
                    No matching real-name profiles yet.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto p-3">
            {isLoadingConversations ? (
              <div className="flex items-center justify-center py-12 text-sm text-ink/60">
                <Loader2
                  className="mr-2 animate-spin text-moss"
                  size={17}
                  aria-hidden="true"
                />
                Loading conversations
              </div>
            ) : null}

            {!isLoadingConversations && conversations.length === 0 ? (
              <div className="rounded-[8px] border border-dashed border-ink/15 bg-white/55 p-5 text-center">
                <Users className="mx-auto text-moss" size={26} aria-hidden="true" />
                <h2 className="mt-3 text-sm font-semibold text-ink">
                  No chats yet
                </h2>
                <p className="mt-1 text-xs leading-5 text-ink/55">
                  Search for a person or create a group to start the first
                  conversation.
                </p>
              </div>
            ) : null}

            <div className="space-y-2">
              {conversations.map((summary) => (
                <button
                  className={clsx(
                    "flex w-full items-center gap-3 rounded-[8px] border px-3 py-3 text-left transition",
                    summary.conversation.id === activeConversationId
                      ? "border-moss bg-jade/10"
                      : "border-transparent bg-white/60 hover:border-ink/10 hover:bg-white"
                  )}
                  key={summary.conversation.id}
                  onClick={() => setActiveConversationId(summary.conversation.id)}
                  type="button"
                >
                  <ConversationAvatar summary={summary} currentUserId={profile.id} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-ink">
                        {conversationTitle(summary, profile.id)}
                      </span>
                      {summary.conversation.type === "group" ? (
                        <Users
                          className="shrink-0 text-ink/40"
                          size={14}
                          aria-hidden="true"
                        />
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink/55">
                      {summary.latestMessage?.attachment
                        ? summary.latestMessage.attachment.file_name
                        : summary.latestMessage?.body || conversationSubtitle(summary, profile.id)}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-[11px] text-ink/45">
                      {formatConversationTime(
                        summary.latestMessage?.created_at ??
                          summary.conversation.last_message_at
                      )}
                    </span>
                    {summary.unreadCount > 0 ? (
                      <span className="min-w-6 rounded-full bg-coral px-2 py-0.5 text-center text-[11px] font-bold text-white">
                        {summary.unreadCount}
                      </span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section
          className={clsx(
            "min-w-0 flex-1 flex-col bg-cloud/65",
            activeConversationId ? "flex" : "hidden lg:flex"
          )}
        >
          {activeSummary ? (
            <>
              <header className="flex min-h-[5rem] items-center gap-3 border-b border-ink/10 bg-white/70 px-4">
                <button
                  aria-label="Back to conversations"
                  className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-ink/10 bg-white text-ink lg:hidden"
                  onClick={() => setActiveConversationId(null)}
                  title="Back to conversations"
                  type="button"
                >
                  <ArrowLeft size={19} aria-hidden="true" />
                </button>
                <ConversationAvatar summary={activeSummary} currentUserId={profile.id} />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-base font-semibold text-ink">
                    {activeTitle}
                  </h2>
                  <p className="truncate text-xs text-ink/55">
                    {activeMembers.map((member) => profileName(member.profile)).join(", ")}
                  </p>
                </div>
                <button
                  aria-label="Conversation details"
                  className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-ink/10 bg-white text-ink"
                  title="Conversation details"
                  type="button"
                >
                  <MoreHorizontal size={19} aria-hidden="true" />
                </button>
              </header>

              {messageError ? (
                <div className="m-4 rounded-[8px] border border-coral/30 bg-coral/10 px-4 py-3 text-sm text-coral">
                  {messageError.includes("permission")
                    ? "You do not have access to this conversation."
                    : messageError}
                </div>
              ) : null}

              <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto px-4 py-5">
                {isLoadingMessages ? (
                  <div className="flex items-center justify-center py-12 text-sm text-ink/60">
                    <Loader2
                      className="mr-2 animate-spin text-moss"
                      size={17}
                      aria-hidden="true"
                    />
                    Loading messages
                  </div>
                ) : null}

                {!isLoadingMessages && messages.length === 0 ? (
                  <div className="mx-auto mt-12 max-w-sm rounded-[8px] border border-dashed border-ink/15 bg-white/65 p-5 text-center">
                    <MessageCircle
                      className="mx-auto text-moss"
                      size={28}
                      aria-hidden="true"
                    />
                    <h3 className="mt-3 text-sm font-semibold text-ink">
                      Start the conversation
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-ink/55">
                      Messages, files, images, GIFs, and videos will update here
                      instantly.
                    </p>
                  </div>
                ) : null}

                <div className="space-y-5">
                  {messages.map((message) => {
                    const sender = memberProfiles.get(message.sender_id);
                    const isMine = message.sender_id === profile.id;
                    const readCount =
                      message.reads?.filter((read) => read.profile_id !== profile.id)
                        .length ?? 0;

                    return (
                      <article
                        className={clsx(
                          "grid gap-3",
                          isMine ? "grid-cols-[minmax(0,1fr)_2.5rem]" : "message-grid"
                        )}
                        key={message.id}
                      >
                        {!isMine ? <Avatar profile={sender} /> : null}
                        <div
                          className={clsx(
                            "min-w-0",
                            isMine ? "order-first text-right" : "text-left"
                          )}
                        >
                          <div
                            className={clsx(
                              "inline-block max-w-[min(42rem,100%)] rounded-[8px] border px-4 py-3 text-left shadow-sm",
                              isMine
                                ? "border-moss/20 bg-moss text-white"
                                : "border-ink/10 bg-white text-ink"
                            )}
                          >
                            {!isMine ? (
                              <p className="mb-1 text-xs font-semibold text-moss">
                                {profileName(sender)}
                              </p>
                            ) : null}
                            {message.body ? (
                              <p className="whitespace-pre-wrap break-words text-sm leading-6">
                                {message.body}
                              </p>
                            ) : null}
                            {message.attachment ? (
                              <AttachmentPreview
                                attachment={message.attachment}
                                isMine={isMine}
                                signedUrl={attachmentUrls[message.attachment.id]}
                              />
                            ) : null}
                          </div>
                          <div
                            className={clsx(
                              "mt-1 flex items-center gap-2 text-[11px] text-ink/45",
                              isMine ? "justify-end" : "justify-start"
                            )}
                          >
                            <span>{formatMessageTime(message.created_at)}</span>
                            {isMine ? (
                              <span className="inline-flex items-center gap-1">
                                {readCount > 0 ? (
                                  <CheckCheck size={13} aria-hidden="true" />
                                ) : (
                                  <Check size={13} aria-hidden="true" />
                                )}
                                {readCount > 0
                                  ? activeSummary.conversation.type === "direct"
                                    ? "Read"
                                    : `Read by ${readCount}`
                                  : "Sent"}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        {isMine ? <Avatar profile={profile} /> : null}
                      </article>
                    );
                  })}
                  <div ref={messageEndRef} />
                </div>
              </div>

              <footer className="border-t border-ink/10 bg-white/80 p-3 sm:p-4">
                {typingProfiles.length > 0 ? (
                  <p className="mb-2 text-xs text-moss">
                    {typingProfiles.map(profileName).join(", ")}{" "}
                    {typingProfiles.length === 1 ? "is" : "are"} typing
                  </p>
                ) : null}

                {selectedFile ? (
                  <div className="mb-3 flex items-center gap-3 rounded-[8px] border border-ink/10 bg-white p-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-jade/15 text-moss">
                      <AttachmentIcon kind={attachmentKindFor(selectedFile)} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">
                        {selectedFile.name}
                      </p>
                      <p className="text-xs text-ink/55">
                        {formatFileSize(selectedFile.size)} of 1 GB max, deletes
                        after 7 days
                      </p>
                    </div>
                    <button
                      aria-label="Remove selected file"
                      className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-ink/10 text-ink transition hover:border-coral hover:text-coral"
                      onClick={clearSelectedFile}
                      title="Remove selected file"
                      type="button"
                    >
                      <X size={17} aria-hidden="true" />
                    </button>
                  </div>
                ) : null}

                <form className="flex items-end gap-2" onSubmit={sendMessage}>
                  <input
                    className="hidden"
                    onChange={selectFile}
                    ref={fileInputRef}
                    type="file"
                  />
                  <button
                    aria-label="Attach file"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] border border-ink/10 bg-white text-ink transition hover:border-moss hover:text-moss"
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach file"
                    type="button"
                  >
                    <Paperclip size={19} aria-hidden="true" />
                  </button>
                  <textarea
                    aria-label="Message"
                    className="max-h-32 min-h-11 flex-1 resize-none rounded-[8px] border border-ink/10 bg-white px-3 py-3 text-sm leading-5 text-ink shadow-sm"
                    disabled={isOffline}
                    onChange={(event) => {
                      setMessageText(event.target.value);
                      if (event.target.value.trim()) {
                        void announceTyping();
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    placeholder={isOffline ? "Sending is paused offline" : "Message"}
                    value={messageText}
                  />
                  <button
                    aria-label="Send message"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] bg-ink text-white transition hover:bg-moss disabled:cursor-not-allowed disabled:bg-ink/45"
                    disabled={
                      isSending ||
                      isOffline ||
                      (!messageText.trim() && selectedFile === null)
                    }
                    title="Send message"
                    type="submit"
                  >
                    {isSending ? (
                      <Loader2 className="animate-spin" size={19} aria-hidden="true" />
                    ) : (
                      <Send size={19} aria-hidden="true" />
                    )}
                  </button>
                </form>
              </footer>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center px-6 text-center">
              <div className="max-w-sm">
                <MessageCircle
                  className="mx-auto text-moss"
                  size={36}
                  aria-hidden="true"
                />
                <h2 className="mt-4 text-lg font-semibold text-ink">
                  Choose a chat
                </h2>
                <p className="mt-2 text-sm leading-6 text-ink/60">
                  Select a direct message, start a group, or search for someone by
                  real name or email.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      {isGroupComposerOpen ? (
        <GroupComposer
          currentProfile={profile}
          onClose={() => setIsGroupComposerOpen(false)}
          onCreated={(conversationId) => {
            setIsGroupComposerOpen(false);
            setActiveConversationId(conversationId);
            queueConversationsRefresh();
          }}
          supabase={supabase}
        />
      ) : null}
    </main>
  );
}

function AttachmentPreview({
  attachment,
  signedUrl,
  isMine
}: {
  attachment: Attachment;
  signedUrl?: string;
  isMine: boolean;
}) {
  const expiryText = formatAttachmentExpiry(attachment.expires_at);
  const meta = `${formatFileSize(attachment.file_size)}${
    attachment.file_type ? `, ${attachment.file_type}` : ""
  }`;
  const expired = isAttachmentExpired(attachment);

  if (expired) {
    return (
      <div
        className={clsx(
          "mt-3 flex items-center gap-3 rounded-[8px] border px-3 py-3 text-sm",
          isMine
            ? "border-white/20 bg-white/10 text-white"
            : "border-ink/10 bg-cloud text-ink"
        )}
      >
        <span
          className={clsx(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px]",
            isMine ? "bg-white/15" : "bg-jade/15 text-moss"
          )}
        >
          <AttachmentIcon kind={attachment.kind} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">
            {attachment.file_name}
          </span>
          <span className={clsx("block text-xs", isMine ? "text-white/75" : "text-ink/55")}>
            Expired after 7 days
          </span>
        </span>
      </div>
    );
  }

  if (!signedUrl) {
    return (
      <div
        className={clsx(
          "mt-3 flex items-center gap-3 rounded-[8px] border px-3 py-3 text-sm",
          isMine
            ? "border-white/20 bg-white/10 text-white"
            : "border-ink/10 bg-cloud text-ink"
        )}
      >
        <Loader2 className="animate-spin" size={17} aria-hidden="true" />
        Preparing private file link
      </div>
    );
  }

  if (attachment.kind === "image" || attachment.kind === "gif") {
    return (
      <div className="mt-3">
        <a
          className="block overflow-hidden rounded-[8px] border border-black/10"
          href={signedUrl}
          rel="noreferrer"
          target="_blank"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={attachment.file_name}
            className="max-h-80 w-full bg-black/5 object-contain"
            src={signedUrl}
          />
        </a>
        <p className={clsx("mt-1 text-xs", isMine ? "text-white/75" : "text-ink/55")}>
          {expiryText}
        </p>
      </div>
    );
  }

  if (attachment.kind === "video") {
    return (
      <div className="mt-3">
        <div className="overflow-hidden rounded-[8px] border border-black/10 bg-black">
          <video className="max-h-80 w-full" controls src={signedUrl}>
            <a href={signedUrl}>Open video</a>
          </video>
        </div>
        <p className={clsx("mt-1 text-xs", isMine ? "text-white/75" : "text-ink/55")}>
          {expiryText}
        </p>
      </div>
    );
  }

  return (
    <a
      className={clsx(
        "mt-3 flex items-center gap-3 rounded-[8px] border px-3 py-3 text-sm transition",
        isMine
          ? "border-white/20 bg-white/10 text-white hover:bg-white/15"
          : "border-ink/10 bg-cloud text-ink hover:border-moss"
      )}
      href={signedUrl}
      rel="noreferrer"
      target="_blank"
    >
      <span
        className={clsx(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px]",
          isMine ? "bg-white/15" : "bg-jade/15 text-moss"
        )}
      >
        <AttachmentIcon kind={attachment.kind} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{attachment.file_name}</span>
        <span className={clsx("block text-xs", isMine ? "text-white/75" : "text-ink/55")}>
          {meta} - {expiryText}
        </span>
      </span>
    </a>
  );
}

function GroupComposer({
  currentProfile,
  supabase,
  onClose,
  onCreated
}: {
  currentProfile: Profile;
  supabase: SupabaseClient;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<Profile[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = safeSearchTerm(query);

    if (term.length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      try {
        const { data, error: searchError } = await withTimeout(
          supabase
            .from("profiles")
            .select("*")
            .neq("id", currentProfile.id)
            .eq("onboarding_complete", true)
            .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`)
            .limit(10),
          10000,
          "People search took too long."
        );

        if (cancelled) {
          return;
        }

        if (searchError) {
          setError(searchError.message);
          setResults([]);
        } else {
          const selectedIds = new Set(selected.map((profile) => profile.id));
          setResults(
            ((data ?? []) as Profile[]).filter(
              (profile) => !selectedIds.has(profile.id)
            )
          );
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "People search failed."
          );
          setResults([]);
        }
      } finally {
        if (!cancelled) {
          setIsSearching(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [currentProfile.id, query, selected, supabase]);

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanTitle = title.trim();

    if (!cleanTitle) {
      setError("Give the group a name.");
      return;
    }

    if (selected.length === 0) {
      setError("Add at least one other person.");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const { data, error: createError } = await withTimeout(
        supabase.rpc("create_group_conversation", {
          group_title: cleanTitle,
          member_ids: selected.map((profile) => profile.id)
        }),
        12000,
        "The server did not answer while creating the group."
      );

      if (createError) {
        throw createError;
      }

      onCreated(String(data));
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The group could not be created."
      );
      setIsCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 px-4 py-4 sm:py-8">
      <section className="scrollbar-soft max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-[8px] border border-ink/10 bg-cloud p-5 shadow-soft sm:max-h-[calc(100dvh-4rem)] sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-ink">Create group chat</h2>
            <p className="mt-1 text-sm text-ink/60">
              Add people by real name or email.
            </p>
          </div>
          <button
            aria-label="Close group composer"
            className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-ink/10 bg-white text-ink"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <form className="mt-5 space-y-4" onSubmit={createGroup}>
          <label className="block">
            <span className="text-xs font-semibold uppercase text-ink/60">
              Group name
            </span>
            <input
              className="mt-2 h-11 w-full rounded-[8px] border border-ink/10 bg-white px-3 text-sm text-ink shadow-sm"
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Project room"
              value={title}
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase text-ink/60">
              Add members
            </span>
            <div className="relative mt-2">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40"
                size={17}
              />
              <input
                className="h-11 w-full rounded-[8px] border border-ink/10 bg-white pl-9 pr-3 text-sm text-ink shadow-sm"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name or email"
                value={query}
              />
            </div>
          </label>

          {selected.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selected.map((selectedProfile) => (
                <button
                  className="flex items-center gap-2 rounded-[8px] border border-moss/20 bg-white px-2 py-1 text-xs font-semibold text-ink"
                  key={selectedProfile.id}
                  onClick={() =>
                    setSelected((current) =>
                      current.filter((profile) => profile.id !== selectedProfile.id)
                    )
                  }
                  type="button"
                >
                  <Avatar profile={selectedProfile} size="sm" />
                  {profileName(selectedProfile)}
                  <X size={14} aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : null}

          <div className="max-h-52 overflow-y-auto rounded-[8px] border border-ink/10 bg-white p-2">
            {isSearching ? (
              <div className="flex items-center justify-center py-5 text-sm text-ink/60">
                <Loader2
                  className="mr-2 animate-spin text-moss"
                  size={16}
                  aria-hidden="true"
                />
                Searching
              </div>
            ) : null}

            {!isSearching && query.trim().length >= 2 && results.length === 0 ? (
              <p className="px-3 py-5 text-center text-sm text-ink/55">
                No matching profiles.
              </p>
            ) : null}

            <div className="space-y-2">
              {results.map((result) => (
                <button
                  className="flex w-full items-center gap-3 rounded-[8px] px-2 py-2 text-left transition hover:bg-jade/10"
                  key={result.id}
                  onClick={() => {
                    setSelected((current) => [...current, result]);
                    setQuery("");
                    setResults([]);
                  }}
                  type="button"
                >
                  <Avatar profile={result} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {profileName(result)}
                    </span>
                    <span className="block truncate text-xs text-ink/55">
                      {result.email}
                    </span>
                  </span>
                  <UserPlus className="text-moss" size={17} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <p className="rounded-[8px] border border-coral/30 bg-coral/10 px-3 py-2 text-sm text-coral">
              {error}
            </p>
          ) : null}

          <button
            className="flex w-full items-center justify-center gap-2 rounded-[8px] bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-moss disabled:cursor-not-allowed disabled:bg-ink/50"
            disabled={isCreating}
            type="submit"
          >
            {isCreating ? (
              <Loader2 className="animate-spin" size={18} aria-hidden="true" />
            ) : (
              <Users size={18} aria-hidden="true" />
            )}
            Create group
          </button>
        </form>
      </section>
    </div>
  );
}
