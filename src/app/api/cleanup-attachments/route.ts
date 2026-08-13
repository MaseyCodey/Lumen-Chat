import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const attachmentBucket = "chat-attachments";
const cleanupBatchSize = 1000;

type ExpiredAttachmentRow = {
  id: string;
  storage_path: string;
};

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Attachment cleanup is missing Supabase server credentials.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getAdminClient();
    const now = new Date().toISOString();

    const { data: expiredAttachments, error: selectError } = await supabase
      .from("attachments")
      .select("id, storage_path")
      .lte("expires_at", now)
      .order("expires_at", { ascending: true })
      .limit(cleanupBatchSize);

    if (selectError) {
      throw selectError;
    }

    const expired = (expiredAttachments ?? []) as ExpiredAttachmentRow[];

    if (expired.length === 0) {
      return NextResponse.json({ deleted: 0 });
    }

    const paths = expired.map((attachment) => attachment.storage_path);
    const ids = expired.map((attachment) => attachment.id);

    const { error: removeError } = await supabase.storage
      .from(attachmentBucket)
      .remove(paths);

    if (removeError) {
      throw removeError;
    }

    const { data: finalizedCount, error: finalizeError } = await supabase.rpc(
      "finalize_expired_attachments",
      {
        expired_attachment_ids: ids
      }
    );

    if (finalizeError) {
      throw finalizeError;
    }

    return NextResponse.json({
      deleted: finalizedCount ?? expired.length,
      checkedAt: now
    });
  } catch (caughtError) {
    return NextResponse.json(
      {
        error:
          caughtError instanceof Error
            ? caughtError.message
            : "Attachment cleanup failed."
      },
      { status: 500 }
    );
  }
}
