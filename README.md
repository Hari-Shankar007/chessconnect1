# EduChess Chat

A production-ready, responsive web app for 1-to-1 messaging between **chess coaches** and **students** at a chess academy. Built with React + Vite + Tailwind CSS, backed by Supabase (Postgres, Auth, Storage, and Realtime).

## Features

- **Email/password authentication** with two roles: `student` and `coach`.
- **No public signup** — only coaches can create new student and coach accounts from the in-app Admin panel.
- **First-run bootstrap** — the very first coach account is created through a secure, one-time "Set up the academy" flow on the login screen.
- **Role-based dashboards** — students land on their chat with their assigned coach; coaches see a WhatsApp-style sidebar listing all their students with last-message previews.
- **Realtime messaging** — new messages appear instantly on both sides via Supabase Realtime (no refresh).
- **File attachments** — PDF, JPG, and PNG up to 10 MB, with optional captions. Images show inline thumbnails; PDFs show a clickable card that opens in a new tab.
- **Private storage** — attachments live in a private Supabase Storage bucket; downloads use signed URLs so only chat participants can view files.
- **Strict Row Level Security** — students and coaches can only read/write the chats and messages they are part of; profile reads are scoped to self (plus coaches can list all profiles for account management).
- **Fully responsive** — mobile shows a single panel at a time with a back button; desktop shows the sidebar + chat side by side.

## Tech Stack

| Layer      | Technology                                   |
| ---------- | -------------------------------------------- |
| Frontend   | React 18, Vite, TypeScript, Tailwind CSS     |
| Icons      | lucide-react                                 |
| Backend    | Supabase (Postgres, Auth, Storage, Realtime) |
| Edge Fns   | Deno functions for account creation          |

## Getting Started

### Prerequisites

- Node.js 18+
- A Supabase project (one is already provisioned in this environment — credentials are in `.env`).

### Install & Run

```bash
npm install
npm run dev      # start the dev server
npm run build    # production build
npm run typecheck
```

The Supabase URL and anon key are read from `.env` via `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. They are pre-populated — no manual setup is needed in this environment.

### First-run setup

1. Open the app in your browser.
2. On the login screen, click **"Set up the academy (first coach)"**.
3. Fill in the name, email, and password for the first coach (this becomes the admin coach).
4. Sign in with those credentials.
5. Click **"Manage"** in the top bar to create more coaches and students.

> The bootstrap button only appears when no coaches exist yet. After the first coach is created, account creation is handled entirely through the Admin panel inside the coach dashboard.

## Database Schema

All schema and RLS policies are applied automatically via the Supabase migration (`educhess_schema`). The tables are:

### `profiles`
| Column       | Type         | Notes                              |
| ------------ | ------------ | ---------------------------------- |
| id           | uuid (PK)    | Matches `auth.users.id`            |
| email        | text, unique |                                    |
| name         | text         | Display name                       |
| role         | text         | `'student'` or `'coach'`           |
| created_at   | timestamptz  | Default `now()`                    |

### `chats`
| Column     | Type | Notes                          |
| ---------- | ---- | ------------------------------ |
| id         | uuid (PK) |                          |
| student_id | uuid FK → profiles.id |                |
| coach_id   | uuid FK → profiles.id |                |
| created_at | timestamptz | Unique (student_id, coach_id) |

### `messages`
| Column     | Type | Notes                                        |
| ---------- | ---- | -------------------------------------------- |
| id         | uuid (PK) |                                            |
| chat_id    | uuid FK → chats.id (cascade) |                |
| sender_id  | uuid FK → profiles.id |                      |
| content    | text, nullable | Optional caption / message body       |
| file_url   | text, nullable | Storage object path                   |
| file_type | text, nullable | `'pdf'` or `'image'`                  |
| file_name  | text, nullable | Original filename for display         |
| created_at | timestamptz | Indexed on (chat_id, created_at)       |

### Helper function
`get_chat_partners(p_coach uuid)` — returns each student a coach chats with, plus the last message snippet and timestamp for the sidebar. `SECURITY DEFINER` so it can join across profiles.

## Row Level Security (RLS)

RLS is enabled on all three tables. Authorization uses `auth.jwt() ->> 'role'` (user-immutable app metadata set at signup), not the mutable `profiles` row.

| Table    | Who can read                                   | Who can write                                                        |
| -------- | --------------------------------------------- | ------------------------------------------------------------------- |
| profiles | Self; coaches can read all (for account mgmt) | Self only (update)                                                  |
| chats    | Participants (student or coach of the chat)   | Participants (insert/update)                                        |
| messages | Participants of the chat                      | Sender inserts into chats they belong to; sender deletes own msg   |

## Storage

- **Bucket:** `chat-attachments` (private).
- **Allowed types:** `application/pdf`, `image/jpeg`, `image/png`.
- **Max size:** 10 MB (enforced in the frontend via `validateFile`).
- **Path layout:** `{user_id}/{timestamp}-{random}.{ext}` — storage policies allow each authenticated user to upload/read/delete only objects under their own id folder.
- **Cross-participant download:** because the bucket is private, the recipient gets access through signed URLs generated by the app (`createSignedUrls`). Only chat participants can read the message row that holds the path, so only legitimate participants ever receive a signed URL.

## Edge Functions

Two Deno edge functions handle account creation (the frontend anon key cannot create auth users directly):

1. **`bootstrap-admin`** — creates the first coach account. Only works when zero coaches exist. No auth required (one-time).
2. **`create-user`** — creates a student or coach account. Requires a valid coach session token; verifies the caller's role is `coach` before proceeding. For students, it also creates the `chats` row linking them to the assigned coach.

Both are deployed automatically in this environment. Source lives in `supabase/functions/`.

## Project Structure

```
src/
  lib/
    supabase.ts      # Supabase client singleton (reads .env)
    types.ts         # Profile, Chat, Message, ChatPartner types
    utils.ts         # time formatting, file validation, helpers
    auth.tsx         # AuthProvider + useAuth hook
  components/
    Login.tsx              # Sign-in + first-coach bootstrap
    StudentDashboard.tsx   # Student chat view
    CoachDashboard.tsx     # Coach sidebar + chat view
    ChatWindow.tsx         # Shared chat UI (messages, input, uploads)
    AdminPanel.tsx         # Create student/coach accounts (coaches only)
  App.tsx           # Role-based routing
  index.css          # Tailwind + shared component classes
supabase/functions/
  bootstrap-admin/index.ts
  create-user/index.ts
```

## Security Notes

- The `role` field is stored in `raw_app_meta_data` (JWT claim), which users **cannot** edit themselves — it is only set by the edge functions using the service role key.
- The service role key is never exposed to the browser; all privileged operations go through the edge functions.
- Email confirmation is disabled so new accounts can sign in immediately after creation.
