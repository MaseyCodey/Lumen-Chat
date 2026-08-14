"use client";

import { withTimeout } from "@/lib/async";
import { oneGigabyte } from "@/lib/types";
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
  Bell,
  BellOff,
  Check,
  CheckCheck,
  Crown,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Palette,
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
  ClipboardEvent,
  DragEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

const attachmentBucket = "chat-attachments";
const adminEmails = new Set([
  "hellerud.mason@gmail.com",
  "mase.hellerud@unbound.school"
]);
const groupImageLimit = 5 * 1024 * 1024;

const themeOptions = [
  {
    id: "lumen",
    name: "Lumen",
    note: "Clean green and warm coral.",
    swatches: ["#1f6f56", "#2fb789", "#ee6f57"]
  },
  {
    id: "midnight-arena",
    name: "Midnight Arena",
    note: "Competitive shooter lobby energy.",
    swatches: ["#2563eb", "#22d3ee", "#f43f5e"]
  },
  {
    id: "block-builder",
    name: "Block Builder",
    note: "Sandbox crafting and grass blocks.",
    swatches: ["#2f7d32", "#8bc34a", "#795548"]
  },
  {
    id: "battle-royale",
    name: "Battle Royale",
    note: "Stormy drop-zone colors.",
    swatches: ["#6d28d9", "#06b6d4", "#f97316"]
  },
  {
    id: "tactical-neon",
    name: "Tactical Neon",
    note: "Sharp neon team-match feel.",
    swatches: ["#0f766e", "#fb7185", "#facc15"]
  },
  {
    id: "rocket-pitch",
    name: "Rocket Pitch",
    note: "Cars, stadium lights, and boosts.",
    swatches: ["#0369a1", "#f97316", "#84cc16"]
  },
  {
    id: "cozy-valley",
    name: "Cozy Valley",
    note: "Soft farming-sim comfort.",
    swatches: ["#7c3f16", "#65a30d", "#f59e0b"]
  },
  {
    id: "space-crew",
    name: "Space Crew",
    note: "Clean starship console vibe.",
    swatches: ["#334155", "#38bdf8", "#ef4444"]
  },
  {
    id: "pixel-arcade",
    name: "Pixel Arcade",
    note: "Retro cabinet color pop.",
    swatches: ["#7c3aed", "#f59e0b", "#10b981"]
  },
  {
    id: "fantasy-quest",
    name: "Fantasy Quest",
    note: "Guild hall, maps, and magic.",
    swatches: ["#365314", "#a16207", "#8b5cf6"]
  },
  {
    id: "stealth-mode",
    name: "Stealth Mode",
    note: "Quiet dark-school notebook feel.",
    swatches: ["#1f2937", "#14b8a6", "#64748b"]
  },
  {
    id: "candy-pop",
    name: "Candy Pop",
    note: "Bright, sweet, and playful.",
    swatches: ["#db2777", "#06b6d4", "#fbbf24"]
  },
  {
    id: "ocean-ops",
    name: "Ocean Ops",
    note: "Blue, teal, and focused.",
    swatches: ["#0f766e", "#0284c7", "#f59e0b"]
  },
  {
    id: "sports-night",
    name: "Sports Night",
    note: "Scoreboard contrast and turf.",
    swatches: ["#166534", "#facc15", "#dc2626"]
  },
  {
    id: "lava-core",
    name: "Lava Core",
    note: "Hot, bold dungeon glow.",
    swatches: ["#991b1b", "#f97316", "#facc15"]
  }
] as const;

type ThemeId = (typeof themeOptions)[number]["id"];
type NotificationState = NotificationPermission | "unsupported";

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

function draftStorageKey(profileId: string, conversationId: string) {
  return `lumen-draft:${profileId}:${conversationId}`;
}

function readMessageDraft(profileId: string, conversationId: string) {
  try {
    return window.localStorage.getItem(draftStorageKey(profileId, conversationId)) ?? "";
  } catch {
    return "";
  }
}

function writeMessageDraft(profileId: string, conversationId: string, value: string) {
  try {
    const key = draftStorageKey(profileId, conversationId);
    if (value.trim()) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Drafts are a local convenience, so blocked browser storage is harmless.
  }
}

function isThemeId(value: string | null): value is ThemeId {
  return themeOptions.some((theme) => theme.id === value);
}

function isAppAdmin(profile?: Profile | null) {
  return Boolean(profile?.email && adminEmails.has(profile.email.toLowerCase()));
}

function canManageSummary(summary: ConversationSummary | null, profile: Profile) {
  if (!summary || summary.conversation.type !== "group") {
    return false;
  }

  const membership = summary.members.find((member) => member.profile_id === profile.id);
  return Boolean(
    membership &&
      (membership.role === "owner" ||
        membership.role === "admin" ||
        isAppAdmin(profile))
  );
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

function getAudioContext() {
  const AudioContextConstructor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextConstructor) {
    return null;
  }

  return new AudioContextConstructor();
}

function playLumenChime(context: AudioContext) {
  const now = context.currentTime;
  const master = context.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.18, now + 0.015);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
  master.connect(context.destination);

  [740, 988].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const noteGain = context.createGain();
    const start = now + index * 0.13;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    noteGain.gain.setValueAtTime(0.0001, start);
    noteGain.gain.exponentialRampToValueAtTime(0.9, start + 0.02);
    noteGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
    oscillator.connect(noteGain);
    noteGain.connect(master);
    oscillator.start(start);
    oscillator.stop(start + 0.36);
  });
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

async function saveGroupImage(
  supabase: SupabaseClient,
  conversationId: string,
  file: File
) {
  const storagePath = `${conversationId}/group-image/${crypto.randomUUID()}_${sanitizeFileName(file.name)}`;

  const { error: uploadError } = await withTimeout(
    supabase.storage.from(attachmentBucket).upload(storagePath, file, {
      cacheControl: "3600",
      contentType: file.type || "image/jpeg",
      upsert: false
    }),
    30000,
    "The group picture upload took too long."
  );

  if (uploadError) {
    throw uploadError;
  }

  const { error: updateError } = await withTimeout(
    supabase.rpc("update_group_image", {
      group_conversation_id: conversationId,
      image_storage_path: storagePath
    }),
    12000,
    "The server did not answer while saving the group picture."
  );

  if (updateError) {
    void supabase.storage.from(attachmentBucket).remove([storagePath]);
    throw updateError;
  }

  return storagePath;
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

function conversationSearchText(summary: ConversationSummary, currentUserId: string) {
  const memberText = summary.members
    .map((member) =>
      [
        profileName(member.profile),
        member.profile?.email,
        member.role,
        member.profile_id === currentUserId ? "me" : ""
      ]
        .filter(Boolean)
        .join(" ")
    )
    .join(" ");

  return [
    conversationTitle(summary, currentUserId),
    conversationSubtitle(summary, currentUserId),
    summary.latestMessage?.body,
    summary.latestMessage?.attachment?.file_name,
    memberText
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
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
  currentUserId,
  imageUrl
}: {
  summary: ConversationSummary;
  currentUserId: string;
  imageUrl?: string;
}) {
  if (summary.conversation.type === "direct") {
    const otherMember = summary.members.find(
      (member) => member.profile_id !== currentUserId
    );
    return <Avatar profile={otherMember?.profile} />;
  }

  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt={conversationTitle(summary, currentUserId)}
        className="h-10 w-10 shrink-0 rounded-[8px] object-cover"
        src={imageUrl}
      />
    );
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
  const [draftPreviews, setDraftPreviews] = useState<Record<string, string>>({});
  const [groupImageUrls, setGroupImageUrls] = useState<Record<string, string>>({});
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
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isGroupComposerOpen, setIsGroupComposerOpen] = useState(false);
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] =
    useState(false);
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationState>("default");
  const [themeId, setThemeId] = useState<ThemeId>("lumen");
  const [typingProfiles, setTypingProfiles] = useState<Profile[]>([]);
  const [isOffline, setIsOffline] = useState(false);
  const [realtimeStatus, setRealtimeStatus] =
    useState<RealtimeStatus>("connecting");
  const [realtimeRetryKey, setRealtimeRetryKey] = useState(0);
  const activeMessageIdsRef = useRef(new Set<string>());
  const audioContextRef = useRef<AudioContext | null>(null);
  const conversationRefreshTimerRef = useRef<number | null>(null);
  const draftConversationRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastSoundMessageIdRef = useRef<string | null>(null);
  const lastTypingAtRef = useRef(0);
  const lastReadAtByConversationRef = useRef(new Map<string, string | null>());
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const messageRefreshTimerRef = useRef<number | null>(null);
  const messageTextRef = useRef("");
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

  const activeGroupImageUrl = activeSummary
    ? groupImageUrls[activeSummary.conversation.id]
    : undefined;
  const activeCanManageGroup = canManageSummary(activeSummary, profile);
  const totalUnreadCount = useMemo(
    () =>
      conversations.reduce(
        (total, summary) => total + Math.max(summary.unreadCount, 0),
        0
      ),
    [conversations]
  );
  const cleanProfileSearch = safeSearchTerm(profileSearch);

  const matchingChatResults = useMemo(() => {
    if (cleanProfileSearch.length < 2) {
      return [];
    }

    const lowerTerm = cleanProfileSearch.toLowerCase();
    return conversations
      .filter((summary) =>
        conversationSearchText(summary, profile.id).includes(lowerTerm)
      )
      .slice(0, 6);
  }, [cleanProfileSearch, conversations, profile.id]);

  const refreshDraftPreviews = useCallback(
    (summaries: ConversationSummary[]) => {
      setDraftPreviews(
        Object.fromEntries(
          summaries
            .map((summary) => [
              summary.conversation.id,
              readMessageDraft(profile.id, summary.conversation.id).trim()
            ])
            .filter(([, draft]) => Boolean(draft))
        )
      );
    },
    [profile.id]
  );

  const signGroupImageUrls = useCallback(
    async (summaries: ConversationSummary[]) => {
      const groupsWithImages = summaries.filter(
        (summary) =>
          summary.conversation.type === "group" &&
          Boolean(summary.conversation.image_path)
      );

      if (groupsWithImages.length === 0) {
        setGroupImageUrls({});
        return;
      }

      const entries = await Promise.all(
        groupsWithImages.map(async (summary) => {
          const imagePath = summary.conversation.image_path;

          if (!imagePath) {
            return [summary.conversation.id, ""] as const;
          }

          const { data } = await withTimeout(
            supabase.storage
              .from(attachmentBucket)
              .createSignedUrl(imagePath, 60 * 60),
            8000,
            "The group picture could not be loaded."
          ).catch(() => ({ data: null }));

          return [summary.conversation.id, data?.signedUrl ?? ""] as const;
        })
      );

      setGroupImageUrls(
        Object.fromEntries(entries.filter(([, url]) => Boolean(url)))
      );
    },
    [supabase]
  );

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
        setDraftPreviews({});
        setGroupImageUrls({});
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
      refreshDraftPreviews(nextSummaries);
      void signGroupImageUrls(nextSummaries);
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
  }, [profile.id, refreshDraftPreviews, signGroupImageUrls, supabase]);

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

  const applyTheme = useCallback((nextTheme: ThemeId) => {
    document.documentElement.dataset.theme = nextTheme;
    setThemeId(nextTheme);

    try {
      window.localStorage.setItem("lumen-theme", nextTheme);
    } catch {
      // Theme choice is local polish only.
    }
  }, []);

  const playNotificationSound = useCallback(() => {
    if (!soundEnabled) {
      return;
    }

    let context = audioContextRef.current;
    if (!context) {
      context = getAudioContext();
      audioContextRef.current = context;
    }

    if (!context) {
      return;
    }

    void context.resume().then(() => playLumenChime(context)).catch(() => undefined);
  }, [soundEnabled]);

  const showBrowserNotification = useCallback(
    (row: Record<string, unknown> | null | undefined) => {
      if (
        !browserNotificationsEnabled ||
        notificationPermission !== "granted" ||
        typeof window.Notification === "undefined"
      ) {
        return;
      }

      const conversationId = row?.conversation_id ? String(row.conversation_id) : "";
      const isActiveVisible =
        conversationId === activeConversationId && document.visibilityState === "visible";

      if (isActiveVisible) {
        return;
      }

      try {
        const body =
          typeof row?.body === "string" && row.body.trim()
            ? row.body.trim()
            : "New message or file";
        const notification = new window.Notification("Lumen Chat", {
          body,
          tag: row?.id ? String(row.id) : undefined
        });

        notification.onclick = () => {
          window.focus();
          if (conversationId) {
            setActiveConversationId(conversationId);
          }
          notification.close();
        };
      } catch {
        // Some browsers deny notification display even after permission.
      }
    },
    [activeConversationId, browserNotificationsEnabled, notificationPermission]
  );

  const playIncomingMessageSound = useCallback(
    (row: Record<string, unknown> | null | undefined) => {
      const messageId = row?.id ? String(row.id) : null;

      if (!messageId || lastSoundMessageIdRef.current === messageId) {
        return;
      }

      if (row?.sender_id && String(row.sender_id) !== profile.id) {
        lastSoundMessageIdRef.current = messageId;
        playNotificationSound();
        showBrowserNotification(row);
      }
    },
    [playNotificationSound, profile.id, showBrowserNotification]
  );

  const toggleNotificationSound = useCallback(() => {
    setSoundEnabled((current) => {
      const next = !current;

      try {
        window.localStorage.setItem(
          "lumen-notification-sound",
          next ? "enabled" : "disabled"
        );
      } catch {
        // Browser storage can be blocked; the in-memory toggle still works.
      }

      if (next) {
        let context = audioContextRef.current;
        if (!context) {
          context = getAudioContext();
          audioContextRef.current = context;
        }

        if (context) {
          void context.resume().then(() => playLumenChime(context)).catch(() => undefined);
        }
      }

      return next;
    });
  }, []);

  const requestBrowserNotifications = useCallback(async () => {
    if (typeof window.Notification === "undefined") {
      setNotificationPermission("unsupported");
      setBrowserNotificationsEnabled(false);
      setSetupMessage("This browser does not support website notifications.");
      return;
    }

    try {
      const permission = await window.Notification.requestPermission();
      setNotificationPermission(permission);
      const enabled = permission === "granted";
      setBrowserNotificationsEnabled(enabled);

      window.localStorage.setItem(
        "lumen-browser-notifications",
        enabled ? "enabled" : "disabled"
      );

      setSetupMessage(
        enabled
          ? "Notifications are on. Lumen can alert you when a message comes in."
          : "Notifications were not allowed. You can change that later in browser site settings."
      );
    } catch {
      setSetupMessage("Notification permission could not be requested.");
    }
  }, []);

  const toggleBrowserNotifications = useCallback(() => {
    if (browserNotificationsEnabled) {
      setBrowserNotificationsEnabled(false);
      try {
        window.localStorage.setItem("lumen-browser-notifications", "disabled");
      } catch {
        // Local notification preference only.
      }
      setSetupMessage("Browser notifications are off for Lumen.");
      return;
    }

    void requestBrowserNotifications();
  }, [browserNotificationsEnabled, requestBrowserNotifications]);

  const prepareChromeAutoOpen = useCallback(async () => {
    const siteUrl = window.location.origin;

    try {
      await window.navigator.clipboard.writeText(siteUrl);
    } catch {
      // The message still shows the URL if clipboard access is blocked.
    }

    window.open("chrome://settings/onStartup", "_blank");
    setSetupMessage(
      `Copied ${siteUrl}. In Chrome, choose "Open a specific page" and add that URL so Lumen opens when Chrome opens.`
    );
  }, []);

  const finishQuickSetup = useCallback(() => {
    try {
      window.localStorage.setItem("lumen-first-chat-setup-complete", "yes");
    } catch {
      // The pop-up can still be closed for this session.
    }

    setIsSetupOpen(false);
  }, []);

  const openLumenWindow = useCallback(() => {
    window.open(window.location.origin, "lumen-chat", "popup,width=1200,height=820");
    setNotice({
      type: "info",
      text: "Lumen opened in its own window. Add this site in Chrome startup settings if you want it to open with Chrome."
    });
  }, []);

  const updateMessageText = useCallback(
    (value: string) => {
      messageTextRef.current = value;
      setMessageText(value);

      if (activeConversationId) {
        writeMessageDraft(profile.id, activeConversationId, value);
        setDraftPreviews((current) => {
          const next = { ...current };

          if (value.trim()) {
            next[activeConversationId] = value.trim();
          } else {
            delete next[activeConversationId];
          }

          return next;
        });
      }
    },
    [activeConversationId, profile.id]
  );

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
    const storedTheme = (() => {
      try {
        return window.localStorage.getItem("lumen-theme");
      } catch {
        return null;
      }
    })();

    applyTheme(isThemeId(storedTheme) ? storedTheme : "lumen");

    try {
      setIsSetupOpen(
        window.localStorage.getItem("lumen-first-chat-setup-complete") !== "yes"
      );
      setSoundEnabled(
        window.localStorage.getItem("lumen-notification-sound") === "enabled"
      );
    } catch {
      setIsSetupOpen(true);
      setSoundEnabled(false);
    }

    if (typeof window.Notification === "undefined") {
      setNotificationPermission("unsupported");
      setBrowserNotificationsEnabled(false);
      return;
    }

    const permission = window.Notification.permission;
    setNotificationPermission(permission);

    try {
      setBrowserNotificationsEnabled(
        permission === "granted" &&
          window.localStorage.getItem("lumen-browser-notifications") === "enabled"
      );
    } catch {
      setBrowserNotificationsEnabled(permission === "granted");
    }
  }, [applyTheme]);

  useEffect(() => {
    document.title =
      totalUnreadCount > 0 ? `(${totalUnreadCount}) Lumen Chat` : "Lumen Chat";

    return () => {
      document.title = "Lumen Chat";
    };
  }, [totalUnreadCount]);

  useEffect(() => {
    const previousConversationId = draftConversationRef.current;

    if (previousConversationId && previousConversationId !== activeConversationId) {
      writeMessageDraft(profile.id, previousConversationId, messageTextRef.current);
    }

    draftConversationRef.current = activeConversationId;

    const nextDraft = activeConversationId
      ? readMessageDraft(profile.id, activeConversationId)
      : "";

    messageTextRef.current = nextDraft;
    setMessageText(nextDraft);
    setDraftPreviews((current) => {
      if (!activeConversationId) {
        return current;
      }

      const next = { ...current };
      if (nextDraft.trim()) {
        next[activeConversationId] = nextDraft.trim();
      } else {
        delete next[activeConversationId];
      }

      return next;
    });
    setSelectedFile(null);
    setIsDraggingFile(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [activeConversationId, profile.id]);

  useEffect(() => {
    return () => {
      if (draftConversationRef.current) {
        writeMessageDraft(
          profile.id,
          draftConversationRef.current,
          messageTextRef.current
        );
      }
    };
  }, [profile.id]);

  useEffect(() => {
    const input = messageInputRef.current;

    if (!input) {
      return;
    }

    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 128)}px`;
  }, [activeConversationId, messageText]);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      if (isDetailsOpen) {
        setIsDetailsOpen(false);
        return;
      }

      if (isGroupComposerOpen) {
        setIsGroupComposerOpen(false);
        return;
      }

      if (profileSearch) {
        setProfileSearch("");
        setProfileResults([]);
        return;
      }

      if (selectedFile) {
        setSelectedFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isDetailsOpen, isGroupComposerOpen, profileSearch, selectedFile]);

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
        (payload) => {
          playIncomingMessageSound(payload.new as Record<string, unknown>);
          queueConversationsRefresh();
        }
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
    playIncomingMessageSound,
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
        (payload) => {
          playIncomingMessageSound(payload.new as Record<string, unknown>);
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
    playIncomingMessageSound,
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

  function attachFile(file: File | null) {
    setNotice(null);

    if (!file) {
      setSelectedFile(null);
      return true;
    }

    if (file.size > oneGigabyte) {
      setSelectedFile(null);
      setNotice({
        type: "error",
        text: "That file is larger than the 1 GB limit."
      });
      return false;
    }

    setSelectedFile(file);
    return true;
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    const accepted = attachFile(file);

    if (!accepted || !file) {
      event.target.value = "";
    }
  }

  function clearSelectedFile() {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleMessagePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const file = Array.from(event.clipboardData.files)[0] ?? null;

    if (!file) {
      return;
    }

    if (attachFile(file)) {
      event.preventDefault();
    }
  }

  function handleConversationDragOver(event: DragEvent<HTMLElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) {
      return;
    }

    event.preventDefault();
    setIsDraggingFile(true);
  }

  function handleConversationDragLeave(event: DragEvent<HTMLElement>) {
    const nextTarget = event.relatedTarget;

    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    setIsDraggingFile(false);
  }

  function handleConversationDrop(event: DragEvent<HTMLElement>) {
    if (!Array.from(event.dataTransfer.types).includes("Files")) {
      return;
    }

    event.preventDefault();
    setIsDraggingFile(false);
    attachFile(Array.from(event.dataTransfer.files)[0] ?? null);
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
      messageTextRef.current = "";
      setMessageText("");
      writeMessageDraft(profile.id, activeConversationId, "");
      setDraftPreviews((current) => {
        const next = { ...current };
        delete next[activeConversationId];
        return next;
      });
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
              <div className="flex shrink-0 items-center gap-2">
                <button
                  aria-label={
                    soundEnabled
                      ? "Turn notification sound off"
                      : "Turn notification sound on"
                  }
                  className={clsx(
                    "flex h-10 w-10 items-center justify-center rounded-[8px] border bg-white text-ink transition",
                    soundEnabled
                      ? "border-moss text-moss"
                      : "border-ink/10 hover:border-moss hover:text-moss"
                  )}
                  onClick={toggleNotificationSound}
                  title={soundEnabled ? "Sound on" : "Sound off"}
                  type="button"
                >
                  {soundEnabled ? (
                    <Bell size={18} aria-hidden="true" />
                  ) : (
                    <BellOff size={18} aria-hidden="true" />
                  )}
                </button>
                <button
                  aria-label="Open Lumen in its own window"
                  className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-ink/10 bg-white text-ink transition hover:border-moss hover:text-moss"
                  onClick={openLumenWindow}
                  title="Open Lumen window"
                  type="button"
                >
                  <ExternalLink size={18} aria-hidden="true" />
                </button>
                <button
                  aria-label="Open setup and themes"
                  className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-ink/10 bg-white text-ink transition hover:border-moss hover:text-moss"
                  onClick={() => {
                    setSetupMessage(null);
                    setIsSetupOpen(true);
                  }}
                  title="Setup and themes"
                  type="button"
                >
                  <Palette size={18} aria-hidden="true" />
                </button>
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
                  className="h-11 w-full rounded-[8px] border border-ink/10 bg-white pl-9 pr-9 text-sm text-ink shadow-sm"
                  onChange={(event) => setProfileSearch(event.target.value)}
                  placeholder="Find by name or email"
                  value={profileSearch}
                />
                {profileSearch ? (
                  <button
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[8px] text-ink/45 transition hover:bg-ink/5 hover:text-ink"
                    onClick={() => {
                      setProfileSearch("");
                      setProfileResults([]);
                    }}
                    title="Clear search"
                    type="button"
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                ) : null}
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

          {cleanProfileSearch.length >= 2 ? (
            <div className="border-b border-ink/10 p-4">
              {matchingChatResults.length > 0 ? (
                <div className="mb-4">
                  <p className="mb-2 text-xs font-semibold uppercase text-ink/50">
                    Chats
                  </p>
                  <div className="space-y-2">
                    {matchingChatResults.map((summary) => (
                      <button
                        className="flex w-full items-center gap-3 rounded-[8px] border border-ink/10 bg-white px-3 py-2 text-left transition hover:border-moss"
                        key={summary.conversation.id}
                        onClick={() => {
                          setActiveConversationId(summary.conversation.id);
                          setProfileSearch("");
                          setProfileResults([]);
                        }}
                        type="button"
                      >
                        <ConversationAvatar
                          currentUserId={profile.id}
                          imageUrl={groupImageUrls[summary.conversation.id]}
                          summary={summary}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">
                            {conversationTitle(summary, profile.id)}
                          </span>
                          <span className="block truncate text-xs text-ink/55">
                            {draftPreviews[summary.conversation.id] ? (
                              <>
                                <span className="font-semibold text-coral">
                                  Draft:
                                </span>{" "}
                                {draftPreviews[summary.conversation.id]}
                              </>
                            ) : summary.latestMessage?.attachment ? (
                              summary.latestMessage.attachment.file_name
                            ) : (
                              summary.latestMessage?.body ||
                              conversationSubtitle(summary, profile.id)
                            )}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

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
                  <ConversationAvatar
                    currentUserId={profile.id}
                    imageUrl={groupImageUrls[summary.conversation.id]}
                    summary={summary}
                  />
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
                      {draftPreviews[summary.conversation.id] ? (
                        <>
                          <span className="font-semibold text-coral">Draft:</span>{" "}
                          {draftPreviews[summary.conversation.id]}
                        </>
                      ) : summary.latestMessage?.attachment ? (
                        summary.latestMessage.attachment.file_name
                      ) : (
                        summary.latestMessage?.body ||
                        conversationSubtitle(summary, profile.id)
                      )}
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
          onDragLeave={handleConversationDragLeave}
          onDragOver={handleConversationDragOver}
          onDrop={handleConversationDrop}
          className={clsx(
            "relative min-w-0 flex-1 flex-col bg-cloud/65",
            activeConversationId ? "flex" : "hidden lg:flex"
          )}
        >
          {isDraggingFile && activeConversationId ? (
            <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-[8px] border-2 border-dashed border-moss bg-cloud/85 text-sm font-semibold text-ink shadow-soft backdrop-blur">
              <span className="inline-flex items-center gap-2 rounded-[8px] bg-white px-3 py-2">
                <Paperclip size={17} aria-hidden="true" />
                Drop to attach
              </span>
            </div>
          ) : null}
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
                <ConversationAvatar
                  currentUserId={profile.id}
                  imageUrl={activeGroupImageUrl}
                  summary={activeSummary}
                />
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
                  className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-ink/10 bg-white text-ink transition hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:text-ink/35"
                  disabled={activeSummary.conversation.type !== "group"}
                  onClick={() => setIsDetailsOpen(true)}
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
                      updateMessageText(event.target.value);
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
                    onPaste={handleMessagePaste}
                    placeholder={isOffline ? "Sending is paused offline" : "Message"}
                    ref={messageInputRef}
                    rows={1}
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
          onCreated={(conversationId, warning) => {
            setIsGroupComposerOpen(false);
            setActiveConversationId(conversationId);
            if (warning) {
              setNotice({ type: "info", text: warning });
            }
            queueConversationsRefresh();
          }}
          supabase={supabase}
        />
      ) : null}

      {isDetailsOpen && activeSummary?.conversation.type === "group" ? (
        <GroupDetailsModal
          canManage={activeCanManageGroup}
          currentProfile={profile}
          imageUrl={activeGroupImageUrl}
          onChanged={() => {
            void loadConversations({ silent: true });
          }}
          onClose={() => setIsDetailsOpen(false)}
          summary={activeSummary}
          supabase={supabase}
        />
      ) : null}

      {isSetupOpen ? (
        <FirstChatSetupModal
          browserNotificationsEnabled={browserNotificationsEnabled}
          notificationPermission={notificationPermission}
          onClose={finishQuickSetup}
          onPrepareAutoOpen={prepareChromeAutoOpen}
          onSelectTheme={applyTheme}
          onToggleBrowserNotifications={toggleBrowserNotifications}
          onToggleSound={toggleNotificationSound}
          setupMessage={setupMessage}
          soundEnabled={soundEnabled}
          themeId={themeId}
        />
      ) : null}
    </main>
  );
}

function FirstChatSetupModal({
  browserNotificationsEnabled,
  notificationPermission,
  onClose,
  onPrepareAutoOpen,
  onSelectTheme,
  onToggleBrowserNotifications,
  onToggleSound,
  setupMessage,
  soundEnabled,
  themeId
}: {
  browserNotificationsEnabled: boolean;
  notificationPermission: NotificationState;
  onClose: () => void;
  onPrepareAutoOpen: () => void;
  onSelectTheme: (theme: ThemeId) => void;
  onToggleBrowserNotifications: () => void;
  onToggleSound: () => void;
  setupMessage: string | null;
  soundEnabled: boolean;
  themeId: ThemeId;
}) {
  const notificationLabel = browserNotificationsEnabled
    ? "Notifications on"
    : notificationPermission === "denied"
      ? "Notifications blocked"
      : notificationPermission === "unsupported"
        ? "Notifications unavailable"
        : "Turn on notifications";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 px-4 py-4 sm:py-8">
      <section className="scrollbar-soft max-h-[calc(100dvh-2rem)] w-full max-w-4xl overflow-y-auto rounded-[8px] border border-ink/10 bg-cloud p-5 shadow-soft sm:max-h-[calc(100dvh-4rem)] sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-moss">
              Before your first chat
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-normal text-ink">
              Set up Lumen your way
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/65">
              Pick a theme, choose alerts, and copy the link Chrome needs if you
              want Lumen to open whenever Chrome starts.
            </p>
          </div>
          <button
            aria-label="Close setup"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-ink/10 bg-white text-ink"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <button
            className={clsx(
              "flex items-center gap-3 rounded-[8px] border bg-white px-3 py-3 text-left transition hover:border-moss disabled:cursor-not-allowed disabled:opacity-60",
              browserNotificationsEnabled ? "border-moss" : "border-ink/10"
            )}
            disabled={notificationPermission === "unsupported"}
            onClick={onToggleBrowserNotifications}
            type="button"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-jade/15 text-moss">
              <Bell size={18} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink">
                {notificationLabel}
              </span>
              <span className="block text-xs leading-5 text-ink/55">
                Browser popups for new messages.
              </span>
            </span>
          </button>

          <button
            className={clsx(
              "flex items-center gap-3 rounded-[8px] border bg-white px-3 py-3 text-left transition hover:border-moss",
              soundEnabled ? "border-moss" : "border-ink/10"
            )}
            onClick={onToggleSound}
            type="button"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-jade/15 text-moss">
              {soundEnabled ? (
                <Bell size={18} aria-hidden="true" />
              ) : (
                <BellOff size={18} aria-hidden="true" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink">
                {soundEnabled ? "Sound on" : "Sound off"}
              </span>
              <span className="block text-xs leading-5 text-ink/55">
                Original Lumen chime.
              </span>
            </span>
          </button>

          <button
            className="flex items-center gap-3 rounded-[8px] border border-ink/10 bg-white px-3 py-3 text-left transition hover:border-moss"
            onClick={onPrepareAutoOpen}
            type="button"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-jade/15 text-moss">
              <ExternalLink size={18} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink">
                Set Chrome auto-open
              </span>
              <span className="block text-xs leading-5 text-ink/55">
                Copies the URL and opens the setting.
              </span>
            </span>
          </button>
        </div>

        {setupMessage ? (
          <p className="mt-4 rounded-[8px] border border-ink/10 bg-white px-3 py-2 text-sm leading-6 text-ink/70">
            {setupMessage}
          </p>
        ) : null}

        <div className="mt-6">
          <div className="flex items-center gap-2">
            <Palette className="text-moss" size={18} aria-hidden="true" />
            <h3 className="text-sm font-semibold uppercase text-ink/65">
              Themes
            </h3>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {themeOptions.map((theme) => (
              <button
                className={clsx(
                  "rounded-[8px] border bg-white p-3 text-left transition hover:border-moss",
                  theme.id === themeId ? "border-moss shadow-sm" : "border-ink/10"
                )}
                key={theme.id}
                onClick={() => onSelectTheme(theme.id)}
                type="button"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {theme.name}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink/55">
                      {theme.note}
                    </span>
                  </span>
                  {theme.id === themeId ? (
                    <Check className="shrink-0 text-moss" size={17} aria-hidden="true" />
                  ) : null}
                </span>
                <span className="mt-3 flex gap-1.5">
                  {theme.swatches.map((swatch) => (
                    <span
                      aria-hidden="true"
                      className="h-5 flex-1 rounded-[6px] border border-black/10"
                      key={swatch}
                      style={{ backgroundColor: swatch }}
                    />
                  ))}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-ink/55">
            Chrome startup still has to be approved in Chrome settings; websites
            are not allowed to secretly change that.
          </p>
          <button
            className="rounded-[8px] bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-moss"
            onClick={onClose}
            type="button"
          >
            Continue to chat
          </button>
        </div>
      </section>
    </div>
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

function GroupDetailsModal({
  canManage,
  currentProfile,
  imageUrl,
  onChanged,
  onClose,
  summary,
  supabase
}: {
  canManage: boolean;
  currentProfile: Profile;
  imageUrl?: string;
  onChanged: () => void;
  onClose: () => void;
  summary: ConversationSummary;
  supabase: SupabaseClient;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSavingImage, setIsSavingImage] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const memberIds = useMemo(
    () => new Set(summary.members.map((member) => member.profile_id)),
    [summary.members]
  );

  useEffect(() => {
    const term = safeSearchTerm(query);

    if (term.length < 2 || !canManage) {
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
          throw searchError;
        }

        setResults(
          ((data ?? []) as Profile[]).filter((profile) => !memberIds.has(profile.id))
        );
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
  }, [canManage, currentProfile.id, memberIds, query, supabase]);

  async function addMember(profile: Profile) {
    if (!canManage) {
      return;
    }

    setBusyMemberId(profile.id);
    setError(null);

    try {
      const { error: addError } = await withTimeout(
        supabase.rpc("add_group_members", {
          group_conversation_id: summary.conversation.id,
          member_ids: [profile.id]
        }),
        12000,
        "The server did not answer while adding that person."
      );

      if (addError) {
        throw addError;
      }

      setQuery("");
      setResults([]);
      onChanged();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "That person could not be added."
      );
    } finally {
      setBusyMemberId(null);
    }
  }

  async function changeRole(member: ConversationMember, role: "admin" | "member") {
    if (!canManage || member.role === "owner") {
      return;
    }

    setBusyMemberId(member.profile_id);
    setError(null);

    try {
      const { error: roleError } = await withTimeout(
        supabase.rpc("set_group_member_role", {
          group_conversation_id: summary.conversation.id,
          target_profile_id: member.profile_id,
          new_role: role
        }),
        12000,
        "The server did not answer while changing that role."
      );

      if (roleError) {
        throw roleError;
      }

      onChanged();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "That role could not be changed."
      );
    } finally {
      setBusyMemberId(null);
    }
  }

  async function updateGroupImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file || !canManage) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setError("Choose an image file for the group picture.");
      return;
    }

    if (file.size > groupImageLimit) {
      setError("Group pictures must be 5 MB or smaller.");
      return;
    }

    setIsSavingImage(true);
    setError(null);

    try {
      await saveGroupImage(supabase, summary.conversation.id, file);
      if (summary.conversation.image_path) {
        void supabase.storage
          .from(attachmentBucket)
          .remove([summary.conversation.image_path]);
      }

      onChanged();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The group picture could not be saved."
      );
    } finally {
      setIsSavingImage(false);
    }
  }

  async function removeGroupImage() {
    if (!canManage) {
      return;
    }

    setIsSavingImage(true);
    setError(null);

    try {
      const previousPath = summary.conversation.image_path;
      const { error: updateError } = await withTimeout(
        supabase.rpc("update_group_image", {
          group_conversation_id: summary.conversation.id,
          image_storage_path: null
        }),
        12000,
        "The server did not answer while removing the group picture."
      );

      if (updateError) {
        throw updateError;
      }

      if (previousPath) {
        void supabase.storage.from(attachmentBucket).remove([previousPath]);
      }

      onChanged();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The group picture could not be removed."
      );
    } finally {
      setIsSavingImage(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 px-4 py-4 sm:py-8">
      <section className="scrollbar-soft max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-[8px] border border-ink/10 bg-cloud p-5 shadow-soft sm:max-h-[calc(100dvh-4rem)] sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold text-ink">
              {summary.conversation.title}
            </h2>
            <p className="mt-1 text-sm text-ink/60">
              {summary.members.length} member{summary.members.length === 1 ? "" : "s"}
            </p>
          </div>
          <button
            aria-label="Close group details"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-ink/10 bg-white text-ink"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <div className="aspect-square overflow-hidden rounded-[8px] border border-ink/10 bg-white">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className="h-full w-full object-cover"
                  src={imageUrl}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-ink text-white">
                  <Users aria-hidden="true" size={42} />
                </div>
              )}
            </div>
            {canManage ? (
              <>
                <input
                  accept="image/*"
                  className="hidden"
                  onChange={updateGroupImage}
                  ref={imageInputRef}
                  type="file"
                />
                <button
                  className="flex items-center justify-center gap-2 rounded-[8px] bg-ink px-3 py-2 text-sm font-semibold text-white transition hover:bg-moss disabled:cursor-not-allowed disabled:bg-ink/50"
                  disabled={isSavingImage}
                  onClick={() => imageInputRef.current?.click()}
                  type="button"
                >
                  {isSavingImage ? (
                    <Loader2 className="animate-spin" size={17} aria-hidden="true" />
                  ) : (
                    <ImagePlus size={17} aria-hidden="true" />
                  )}
                  Change photo
                </button>
                {summary.conversation.image_path ? (
                  <button
                    className="rounded-[8px] border border-ink/10 bg-white px-3 py-2 text-sm font-semibold text-ink transition hover:border-coral hover:text-coral"
                    disabled={isSavingImage}
                    onClick={() => void removeGroupImage()}
                    type="button"
                  >
                    Remove photo
                  </button>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="min-w-0 space-y-4">
            {canManage ? (
              <div>
                <label className="block">
                  <span className="text-xs font-semibold uppercase text-ink/60">
                    Add people
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

                {query.trim().length >= 2 ? (
                  <div className="scrollbar-soft mt-3 max-h-44 overflow-y-auto rounded-[8px] border border-ink/10 bg-white p-2">
                    {isSearching ? (
                      <div className="flex items-center justify-center py-4 text-sm text-ink/60">
                        <Loader2
                          className="mr-2 animate-spin text-moss"
                          size={16}
                          aria-hidden="true"
                        />
                        Searching
                      </div>
                    ) : null}

                    {!isSearching && results.length === 0 ? (
                      <p className="px-3 py-4 text-center text-sm text-ink/55">
                        No matching profiles.
                      </p>
                    ) : null}

                    <div className="space-y-2">
                      {results.map((result) => (
                        <button
                          className="flex w-full items-center gap-3 rounded-[8px] px-2 py-2 text-left transition hover:bg-jade/10 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={busyMemberId === result.id}
                          key={result.id}
                          onClick={() => void addMember(result)}
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
                          {busyMemberId === result.id ? (
                            <Loader2
                              className="animate-spin text-moss"
                              size={17}
                              aria-hidden="true"
                            />
                          ) : (
                            <UserPlus className="text-moss" size={17} aria-hidden="true" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="rounded-[8px] border border-ink/10 bg-white/70 px-3 py-2 text-sm text-ink/60">
                Only group admins can change the photo or add people.
              </p>
            )}

            <div>
              <p className="text-xs font-semibold uppercase text-ink/60">Members</p>
              <div className="mt-2 space-y-2">
                {summary.members.map((member) => {
                  const memberIsAppAdmin = isAppAdmin(member.profile);
                  const canChangeRole =
                    canManage &&
                    member.role !== "owner" &&
                    member.profile_id !== currentProfile.id;

                  return (
                    <div
                      className="flex items-center gap-3 rounded-[8px] border border-ink/10 bg-white px-3 py-2"
                      key={member.profile_id}
                    >
                      <Avatar profile={member.profile} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">
                          {profileName(member.profile)}
                        </p>
                        <p className="truncate text-xs text-ink/55">
                          {member.profile?.email}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className={clsx(
                            "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold uppercase",
                            member.role === "owner" || member.role === "admin"
                              ? "bg-sun/20 text-ink"
                              : "bg-ink/5 text-ink/55"
                          )}
                        >
                          {member.role === "owner" ? (
                            <Crown size={12} aria-hidden="true" />
                          ) : null}
                          {memberIsAppAdmin ? "app admin" : member.role}
                        </span>
                        {canChangeRole ? (
                          <button
                            className="rounded-[8px] border border-ink/10 px-2 py-1 text-xs font-semibold text-ink transition hover:border-moss hover:text-moss disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={busyMemberId === member.profile_id}
                            onClick={() =>
                              void changeRole(
                                member,
                                member.role === "admin" ? "member" : "admin"
                              )
                            }
                            type="button"
                          >
                            {member.role === "admin" ? "Make member" : "Make admin"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {error ? (
              <p className="rounded-[8px] border border-coral/30 bg-coral/10 px-3 py-2 text-sm text-coral">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
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
  onCreated: (conversationId: string, warning?: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<Profile[]>([]);
  const [groupImageFile, setGroupImageFile] = useState<File | null>(null);
  const [groupImagePreviewUrl, setGroupImagePreviewUrl] = useState<string | null>(
    null
  );
  const [isCreating, setIsCreating] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!groupImageFile) {
      setGroupImagePreviewUrl(null);
      return;
    }

    const previewUrl = URL.createObjectURL(groupImageFile);
    setGroupImagePreviewUrl(previewUrl);

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [groupImageFile]);

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

  function chooseGroupImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setError("Choose an image file for the group picture.");
      return;
    }

    if (file.size > groupImageLimit) {
      setError("Group pictures must be 5 MB or smaller.");
      return;
    }

    setError(null);
    setGroupImageFile(file);
  }

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

      const conversationId = String(data);
      let warning: string | undefined;

      if (groupImageFile) {
        try {
          await saveGroupImage(supabase, conversationId, groupImageFile);
        } catch {
          warning =
            "Group was created, but the picture could not be saved. Open group details to add it.";
        }
      }

      onCreated(conversationId, warning);
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
          <div className="flex items-center gap-3 rounded-[8px] border border-ink/10 bg-white/70 p-3">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-ink text-white">
              {groupImagePreviewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt=""
                  className="h-full w-full object-cover"
                  src={groupImagePreviewUrl}
                />
              ) : (
                <Users size={26} aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">
                Group picture
              </p>
              <p className="mt-0.5 truncate text-xs text-ink/55">
                {groupImageFile ? groupImageFile.name : "Optional image, 5 MB max"}
              </p>
            </div>
            <input
              accept="image/*"
              className="hidden"
              onChange={chooseGroupImage}
              ref={imageInputRef}
              type="file"
            />
            {groupImageFile ? (
              <button
                aria-label="Remove group picture"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-ink/10 text-ink transition hover:border-coral hover:text-coral"
                onClick={() => setGroupImageFile(null)}
                title="Remove picture"
                type="button"
              >
                <X size={17} aria-hidden="true" />
              </button>
            ) : null}
            <button
              aria-label="Choose group picture"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] border border-ink/10 text-ink transition hover:border-moss hover:text-moss"
              onClick={() => imageInputRef.current?.click()}
              title="Choose picture"
              type="button"
            >
              <ImagePlus size={17} aria-hidden="true" />
            </button>
          </div>

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
