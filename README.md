# Lumen Chat

Lumen Chat is a GitHub-ready real-time chat app built with Next.js, TypeScript,
Tailwind CSS, and Supabase. It supports Google OAuth sign-in, real-name
onboarding, direct messages, group chats, read receipts, typing indicators,
private attachments up to 1 GB, and responsive desktop/mobile layouts.

The design is original and does not use Google Chat branding. Google is used
only as the OAuth provider and profile-photo source.

## Features

- Google OAuth sign-in with Supabase Auth
- Google profile picture shown as the user's chat avatar
- Onboarding that requires first and last name and states that users must use a real name
- Profile search by full name or email
- Secure one-to-one direct messages
- Group chats with named rooms, multiple members, and optional group pictures
- Group admins can add people after creation and promote members to group admin
- Built-in app admins: `hellerud.mason@gmail.com` and `mase.hellerud@unbound.school`
- Supabase Realtime updates for conversations, messages, read receipts, attachments, and typing
- Typing indicators
- Unread badges
- Read receipts
- Timestamps
- Optional original notification chime for incoming messages
- Optional browser notifications for incoming messages while Lumen is open
- First-chat setup popup for notifications, sound, Chrome startup help, and themes
- 15 saved themes, including several popular-game-inspired visual vibes
- Chat search that finds existing conversations and people
- Local draft saving per conversation
- Paste and drag-and-drop file attachment support
- Browser tab unread count
- Escape key closes popups, clears search, or removes a selected file
- Private image, GIF, video, and general file attachments up to 1 GB
- Attachments expire after 7 days and are cleaned up by a secure daily job
- Responsive mobile and desktop UI
- Loading, error, offline, empty, and unauthorized states
- Rules popup on every fresh website open
- School-hours warning lock from 9:00-10:30 AM and 12:00-2:00 PM Mountain Time
- SQL migration with schema, indexes, triggers, storage bucket, RLS policies, and helper RPCs

## Tech Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase Auth, Database, Realtime, and Storage
- Vercel-ready deployment

## 1. Create a Supabase Project

Create a project at Supabase, then copy:

- Project URL
- Anon public key

Add them to a local `.env.local` file:

```bash
cp .env.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-private-service-role-key
CRON_SECRET=make-a-random-secret-at-least-16-characters
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

## 2. Configure Google OAuth

In Supabase:

1. Go to **Authentication -> Providers -> Google**.
2. Enable Google.
3. Add your Google OAuth client ID and secret.
4. In Google Cloud Console, add these authorized redirect URIs:

```text
http://localhost:3000/auth/callback
https://your-vercel-domain.vercel.app/auth/callback
https://your-project-ref.supabase.co/auth/v1/callback
```

In Supabase **Authentication -> URL Configuration**, add:

```text
http://localhost:3000
https://your-vercel-domain.vercel.app
```

## 3. Run the Database Migration

Install the Supabase CLI, link your project, then apply the migration:

```bash
supabase login
supabase link --project-ref your-project-ref
supabase db push
```

The migration creates:

- `profiles`
- `conversations`
- `conversation_members`
- `messages`
- `attachments`
- `message_reads`
- `typing_indicators`
- a private `chat-attachments` storage bucket
- RLS policies that only allow conversation members to view chat data and files
- RPC helpers for creating direct and group conversations, adding group members, assigning group admins, and saving group pictures
- attachment expiration support
- indexes and triggers for search, timestamps, and conversation ordering
- Realtime publication entries for live updates

## 4. Storage Limit Notes

The migration sets the `chat-attachments` bucket `file_size_limit` to
`1073741824` bytes, which is 1 GB. Your Supabase project and plan must also
allow uploads of that size.

Files are stored privately. The app creates short-lived signed links only for
members of the conversation. Each attachment gets an `expires_at` timestamp 7
days after upload. The app stops opening expired files, and a Vercel Cron route
deletes expired storage objects through the Supabase Storage API.

Supabase recommends deleting Storage files through the Storage API instead of
direct SQL, because deleting `storage.objects` rows directly can leave orphaned
files behind.

## 5. Attachment Cleanup

The app includes a secure cleanup route at:

```text
/api/cleanup-attachments
```

Vercel runs it once per day using `vercel.json`. Hobby/free Vercel accounts only
support daily cron jobs, which is enough for weekly file expiration.

Add these private environment variables in Vercel:

```env
SUPABASE_SERVICE_ROLE_KEY=your-private-service-role-key
CRON_SECRET=make-a-random-secret-at-least-16-characters
```

Keep `SUPABASE_SERVICE_ROLE_KEY` private. Never add `NEXT_PUBLIC_` to it.

The daily job:

1. Finds attachments older than 7 days.
2. Deletes the real files through Supabase Storage.
3. Updates old chat messages to say the attachment expired.
4. Deletes the attachment metadata.

## 6. Install and Run Locally

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

## 7. Testing and Checks

```bash
npm run lint
npm run typecheck
npm run build
```

To test realtime messaging:

1. Create two Google test users.
2. Sign in from two different browsers or browser profiles.
3. Complete onboarding for both accounts.
4. Search by name or email.
5. Start a direct message or create a group chat.
6. Send text, images, GIFs, videos, and files.
7. Confirm messages, unread badges, typing indicators, and read receipts update without refreshing.

## 8. Deploy to Vercel

1. Push this repository to GitHub.
2. Import the repository in Vercel.
3. Add these environment variables in Vercel:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
NEXT_PUBLIC_SITE_URL=https://your-vercel-domain.vercel.app
SUPABASE_SERVICE_ROLE_KEY=your-private-service-role-key
CRON_SECRET=make-a-random-secret-at-least-16-characters
```

4. Deploy.
5. Add the Vercel callback URL to Google Cloud Console and Supabase Auth URL settings.

## Security Model

The app relies on Supabase Row Level Security:

- Signed-in users can search completed profiles.
- Users can only update their own profile.
- Conversation rows are visible only to members.
- Messages are visible only to members of that conversation.
- Users can only send messages as themselves.
- Attachments are private and scoped to the conversation path.
- Storage object policies check membership before upload or download.
- Direct and group conversation creation happens through security-definer RPCs.
- Read receipts and typing indicators are scoped to members only.

## School-Hours Lock

The client checks Mountain Time using the `America/Denver` time zone and pauses
access during:

- 9:00 AM to 10:30 AM Mountain Time
- 12:00 PM to 2:00 PM Mountain Time

During those windows, the app shows a warning that the user could get called out
by a teacher. The user can choose **Yes, I understand** to continue for the
current lock window or **No, I care about rules** to keep the app paused until
the window ends.

## Rules Reminder

Every fresh website load opens a rules reminder before the user continues. The
rules ask users to use their real name, be respectful, protect private
information, avoid unsafe uploads, respect school rules, and tell a trusted
adult or teacher if something feels wrong.

## Notifications, Themes, and Chrome Startup

The bell button turns on an original Lumen notification chime for new incoming
messages. It is intentionally not a copied Google Chat sound.

The first-chat setup popup can also ask the browser for notification permission.
Browser notifications work while Lumen is open in a browser tab or window.

The palette button opens setup again so users can switch between 15 saved
themes. Some themes are inspired by familiar game genres and popular-game vibes,
but they do not use official names, logos, artwork, or branding.

The startup button copies the Lumen site URL and tries to open Chrome startup
settings. A website cannot safely force itself to open every time Chrome opens,
so set that part in Chrome:

1. Open Chrome settings.
2. Go to **On startup**.
3. Choose **Open a specific page or set of pages**.
4. Add your Lumen site URL, like `https://your-vercel-domain.vercel.app`.

## Project Structure

```text
src/app                 Next.js routes and global styles
src/components          Auth, onboarding, lock gate, and chat UI
src/lib                 Supabase helpers, time helpers, shared types
supabase/migrations     Database, RLS, storage, realtime, and helper RPCs
```
