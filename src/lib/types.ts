export type Profile = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  onboarding_complete: boolean;
  created_at?: string;
  updated_at?: string;
};

export type ConversationKind = "direct" | "group";

export type Conversation = {
  id: string;
  type: ConversationKind;
  title: string | null;
  image_path: string | null;
  image_updated_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
};

export type ConversationMember = {
  conversation_id: string;
  profile_id: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
  last_read_at: string | null;
  profile?: Profile;
};

export type AttachmentKind = "image" | "gif" | "video" | "file";

export type Attachment = {
  id: string;
  conversation_id: string;
  uploader_id: string;
  storage_path: string;
  file_name: string;
  file_type: string | null;
  file_size: number;
  kind: AttachmentKind;
  created_at: string;
  expires_at: string;
};

export type MessageRead = {
  message_id: string;
  profile_id: string;
  read_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  message_type: "text" | "attachment" | "system";
  attachment_id: string | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  attachment?: Attachment | null;
  reads?: MessageRead[];
};

export type ConversationSummary = {
  conversation: Conversation;
  members: ConversationMember[];
  latestMessage: Message | null;
  unreadCount: number;
};

export const oneGigabyte = 1024 * 1024 * 1024;
