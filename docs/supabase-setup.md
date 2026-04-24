# DietLens — Supabase Setup Guide

**Estimated time:** 10–15 minutes  
**Who this is for:** Akash or any team member setting up a fresh Supabase project for DietLens.  
**Prerequisites:** A browser, access to `https://supabase.com`, and the DietLens repo checked out locally.

---

## Why Anonymous Sign-In?

> **Callout — Zero-friction auth**
>
> DietLens uses Supabase Anonymous Sign-In (`supabase.auth.signInAnonymously()`).
> When the app loads for the first time on a device, it silently calls this API and receives
> a real JWT with a unique `auth.uid()` — no email, no password, no login screen.
> Every photo the user logs is owned by that UID.
>
> **Trade-off to understand:** If the user clears their browser's local storage (or switches
> devices), their anonymous session is gone. There is no way to recover data because there is
> no email on file. A future "Link email to rescue data" flow can upgrade the anonymous account
> to a permanent one via `supabase.auth.updateUser({ email })` — but that is out of scope for
> the initial launch.

---

## Step 1 — Create a Supabase Project

1. Open [https://supabase.com/dashboard](https://supabase.com/dashboard) in your browser.
2. Sign in. We recommend using `saishwarya.1008@gmail.com` to keep everything in one place,
   or whatever account the team prefers — it does not matter as long as you save the keys.
3. Click the green **"New project"** button (top-right of the dashboard).
4. Fill in:
   - **Organization:** your org (or personal if prompted)
   - **Project name:** `dietlens`
   - **Database password:** click "Generate a password", then **copy it and save it somewhere
     safe** (1Password, Notion, etc.) — Supabase will not show it again.
   - **Region:** choose **Southeast Asia (Singapore)** (`ap-southeast-1`) if your users are
     primarily in India — lowest latency. Other option: `ap-south-1` (Mumbai) if available.
   - **Pricing plan:** Free tier is fine for development.
5. Click **"Create new project"**.
6. Wait approximately **2 minutes** for the project to provision. You will see a loading
   spinner — do not navigate away.

---

## Step 2 — Run the SQL Migration

1. In the left sidebar, click **SQL Editor** (the `</>` icon).
2. Click **"New query"** (top-left of the editor pane).
3. Open the file `supabase/migrations/0001_init.sql` from the DietLens repo.
4. Select all its contents (Cmd+A / Ctrl+A) and copy.
5. Paste into the Supabase SQL editor.
6. Click **"Run"** (green button, or press Cmd+Enter / Ctrl+Enter).
7. You should see **"Success. No rows returned."** in the output panel at the bottom.

   > **If you see an error:** The most common cause is running this on a project that already
   > has these tables. The migration uses `create table if not exists`, so re-running is safe
   > for tables. If you see a policy-already-exists error, that means you ran it twice — run
   > `drop policy if exists ...` for the conflicting policy name, then re-run.

---

## Step 3 — Create the Storage Bucket

The migration SQL creates the storage *policies* but not the bucket itself (bucket creation
requires service-role access). You must create it manually:

1. In the left sidebar, click **Storage** (the bucket icon).
2. Click **"New bucket"**.
3. Fill in:
   - **Name:** `meal-photos` (must match exactly — the SQL policies reference this name)
   - **Public bucket:** **OFF** (leave the toggle disabled — all access is gated by RLS)
   - **File size limit:** `5` MB
   - **Allowed MIME types:** `image/jpeg, image/png, image/webp`
     (type each one and press Enter / comma to add)
4. Click **"Save"**.

   > **Verify:** After saving, you should see `meal-photos` listed under Storage.
   > If you named it differently by mistake, delete it and re-create with the exact name
   > `meal-photos` — changing the name later would require updating the SQL policies too.

---

## Step 4 — Enable Anonymous Sign-In

Anonymous sign-in is **disabled by default** in new Supabase projects. You must enable it:

1. In the left sidebar, click **Authentication** (the person icon).
2. Click **"Providers"** in the sub-menu (or it may open directly to the providers list).
3. Scroll down to find **"Anonymous Sign Ins"** — it appears near the bottom of the providers
   list, below the social OAuth providers.
4. Click on it to expand the row.
5. Toggle **"Enable Anonymous Sign Ins"** to **ON** (it turns green).
6. Click **"Save"**.

   > **Where exactly:** Authentication → Providers → scroll to "Anonymous Sign Ins" → toggle
   > "Enable Anonymous Sign Ins" → Save.
   >
   > If you skip this step, `supabase.auth.signInAnonymously()` will return a
   > `"Anonymous sign-ins are disabled"` error and the app will be broken for all users.

---

## Step 5 — Copy Your API Keys

1. In the left sidebar, click **Project Settings** (the gear icon at the bottom).
2. Click **"API"** in the settings sub-menu.
3. You will see two sections:
   - **Project URL** — looks like `https://abcdefghijkl.supabase.co`
   - **Project API Keys** — two keys listed:
     - `anon` / `public` — safe to expose in the browser
     - `service_role` — **keep secret, never expose client-side**
4. Copy all three values.
5. Open (or create) `.env.local` at the root of the DietLens repo and paste:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

   > **Security rule:** `NEXT_PUBLIC_*` vars are embedded in the browser bundle — only put
   > the `anon` key there. The `service_role` key goes into Vercel environment variables
   > (Settings → Environment Variables) and is only used in server-side API routes
   > (Vercel Cron jobs, `/api/*` handlers).

---

## Step 6 — Configure Site URL

1. Still in **Project Settings → API**, scroll down to **"URL Configuration"**.
2. Set **Site URL** to:
   - For local development: `http://localhost:3000`
   - After deploying to Vercel: update this to `https://dietlens.vercel.app`
   (or your custom domain if you have one)
3. Click **"Save"**.

   > **Why this matters:** Supabase uses the Site URL for OAuth redirects and magic-link emails.
   > Even with anonymous sign-in only, setting it correctly prevents CORS issues in the future.

---

## Step 7 — Add Keys to Vercel

When you deploy to Vercel (account `saishwarya.1008@gmail.com`), add the three env vars:

1. Open your Vercel project dashboard → **Settings → Environment Variables**.
2. Add each of the three keys from Step 5 above.
3. Make sure `SUPABASE_SERVICE_ROLE_KEY` is set for **Production** and **Preview** but is
   **not** prefixed with `NEXT_PUBLIC_` — this keeps it server-side only.
4. Redeploy after adding env vars (or trigger a new deploy).

---

## Step 8 — Verify Everything Works

Run these queries in the **SQL Editor** (create a new query for each):

**Tables exist and RLS is on:**
```sql
select tablename, rowsecurity
  from pg_tables
 where schemaname = 'public';
```
Expected: two rows — `meals` (rowsecurity = true) and `push_subs` (rowsecurity = true).

**Meals table is empty (no error):**
```sql
select * from public.meals;
```
Expected: 0 rows returned, no error.

**Push subs table is empty (no error):**
```sql
select * from public.push_subs;
```
Expected: 0 rows returned, no error.

**Storage bucket was created:**
```sql
select id, name, public
  from storage.buckets
 where id = 'meal-photos';
```
Expected: 1 row, `public = false`.

**Indexes exist:**
```sql
select indexname, tablename
  from pg_indexes
 where schemaname = 'public'
   and tablename = 'meals';
```
Expected: 3 indexes — the primary key plus `meals_user_created_idx` and
`meals_user_category_created_idx`.

**RLS policies exist:**
```sql
select tablename, policyname, cmd
  from pg_policies
 where schemaname = 'public';
```
Expected: 2 rows — `meals_owner` (ALL) and `push_subs_owner` (ALL).

**Storage policies exist:**
```sql
select name, action
  from storage.policies
 where bucket_id = 'meal-photos';
```
Expected: 3 rows — `meal_photos_select_owner` (SELECT), `meal_photos_insert_owner` (INSERT),
`meal_photos_delete_owner` (DELETE).

If all 7 checks pass, the database is ready.

---

## Troubleshooting

### "Anonymous sign-ins are disabled"
- You skipped Step 4. Go to Authentication → Providers → Anonymous Sign Ins → enable it.

### "new row violates row-level security policy"
- Happens when code tries to insert a row where `user_id` does not match the authenticated
  `auth.uid()`. Most common cause: the user is not signed in yet when the insert fires.
  Make sure `supabase.auth.signInAnonymously()` resolves before any table writes.
- Also check that `user_id` is being set to `(await supabase.auth.getUser()).data.user.id`,
  not a hardcoded value.

### "Storage object violates row-level security"
- The uploaded file path must start with `{auth.uid()}/`. If your upload code uses a path
  like `photos/filename.jpg` instead of `{uid}/filename.jpg`, the policy will reject it.
  Fix: prefix every storage upload with `${session.user.id}/`.

### "JWT expired"
- Anonymous sessions expire after 1 hour by default (configurable in Authentication →
  Settings → JWT Expiry). The client SDK auto-refreshes if the app is open; it can fail
  if the device was offline. Call `supabase.auth.getSession()` on app boot — if the session
  is null, call `supabase.auth.signInAnonymously()` again. Anonymous sign-in is idempotent
  only if the existing session token is in `localStorage`; if storage was cleared, a new
  anonymous user is created.

### Storage bucket policy error: "bucket not found"
- The policies reference `bucket_id = 'meal-photos'`. If you named the bucket differently
  (e.g., `meal_photos` with an underscore), the policies will not fire. Delete the bucket,
  re-create it with the exact name `meal-photos`, and re-run the storage policy section of
  the migration SQL.

### "extension uuid-ossp already exists"
- Harmless — the migration uses `create extension if not exists`, so this warning is safe
  to ignore.

### SQL Editor shows "permission denied for schema storage"
- The storage policies in the migration require elevated privileges. If you run the migration
  as a restricted role, storage policy creation may fail. Run from the **SQL Editor** while
  logged into the Supabase dashboard (it uses the `postgres` role by default) — this should
  not be an issue.

---

## Quick Reference — Keys Checklist

| Variable | Where to find it | Used in |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → Project URL | Browser + server |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API → anon/public | Browser only |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → service_role | Server only (Vercel env vars) |

---

*Last updated: April 2026. Supabase dashboard UI may change — if a step looks different,
the underlying action is the same; look for equivalent controls.*
