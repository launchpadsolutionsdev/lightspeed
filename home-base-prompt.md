# Claude Code Prompt: Home Base — Team Bulletin Board for Lightspeed

## Context

Lightspeed is an existing Express.js + PostgreSQL app with Google OAuth authentication, hosted on Render. I need you to build a new feature called **Home Base** — a team bulletin board where lottery operators can post updates, announcements, and discussions. Think of it as a simple team feed, NOT a chat app. No real-time messaging, no channels, no WebSockets. Just a clean, scrollable feed of posts with comments.

Check the existing project structure before building — match the patterns already in use for routes, middleware, migrations, database queries, and frontend views.

## What Home Base Looks Like

A single page (`/home-base`) accessible from the sidebar navigation. The page layout is:

### Top Section — Create a Post
At the top of the page, a compose box (always visible, not hidden behind a button):
- A text area with placeholder text like "Share an update with your team..."
- Below the text area, a row with:
  - **Category selector**: A row of small tag/pill buttons the user can click to tag their post — options: `Urgent`, `FYI`, `Draw Update`, `Campaign`, `General`. Only one category per post. Default to `General` if none selected. Each category should have a distinct color (red for Urgent, blue for FYI, green for Draw Update, purple for Campaign, gray for General)
  - **Post button** on the right side of the row
- Keep this compose area compact — it shouldn't dominate the page

### Main Feed — Posts
Below the compose box, a scrollable feed of posts, newest first. Each post card should show:
- **Author name and avatar/initial** (top-left — use a colored circle with the first letter of their name if there's no avatar system)
- **Timestamp** (top-right — relative time like "2 hours ago", "Yesterday", "Mar 12")
- **Category badge** next to the author name — a small colored pill/tag showing the category (e.g., a red "Urgent" badge, blue "FYI" badge)
- **Pinned indicator** — if the post is pinned, show a 📌 icon and pin it to the top of the feed above all other posts, regardless of date
- **Post body** — the text content of the post. Support basic line breaks (render newlines). No need for rich text/markdown
- **Comment count** — at the bottom of the post card, a link/button like "3 comments" or "Reply" that expands the comment thread

### Comment Thread
When the user clicks "Reply" or the comment count on a post:
- Expand a section below the post showing all comments in chronological order
- Each comment shows: commenter name, relative timestamp, and comment text
- At the bottom, a small text input + "Reply" button to add a new comment
- Keep comments visually indented or slightly differentiated from the main post (lighter background, smaller text)
- Comments are flat — no nested threading, no sub-replies

### Pinning
- Admin users can pin/unpin posts by clicking a pin icon on any post
- Pinned posts always appear at the top of the feed in a "Pinned" section, separated by a subtle divider or label
- Non-admin users can see pinned posts but can't pin/unpin
- Maximum 3 pinned posts at a time (if a 4th is pinned, prompt the admin to unpin one first)

### Filtering
At the top of the feed (below the compose box), add a row of filter pills:
- `All`, `Urgent`, `FYI`, `Draw Update`, `Campaign`, `General`
- Clicking a filter shows only posts with that category
- `All` is the default and shows everything
- This can be client-side filtering if the feed isn't huge, or server-side with a query parameter

## Database Schema

### Migration 1: `posts` table
```sql
CREATE TABLE home_base_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id INTEGER REFERENCES users(id) NOT NULL,
  body TEXT NOT NULL,
  category VARCHAR(20) DEFAULT 'general' CHECK (category IN ('urgent', 'fyi', 'draw_update', 'campaign', 'general')),
  pinned BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Migration 2: `comments` table
```sql
CREATE TABLE home_base_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID REFERENCES home_base_posts(id) ON DELETE CASCADE NOT NULL,
  author_id INTEGER REFERENCES users(id) NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

Adjust the `author_id` foreign key to match whatever the actual primary key column and type is in the existing users table.

## API Routes

All routes under `/api/home-base`, all protected by existing auth middleware.

### Posts
- `GET /api/home-base/posts?category=all` — returns posts (newest first), with pinned posts flagged. Include author name, comment count, and category. Support optional `category` query param for filtering
- `POST /api/home-base/posts` — create a new post. Body: `{ body, category }`
- `DELETE /api/home-base/posts/:id` — delete a post. Only the original author OR an admin can delete
- `PATCH /api/home-base/posts/:id/pin` — toggle pin/unpin on a post. Admin only. Enforce max 3 pinned posts

### Comments
- `GET /api/home-base/posts/:id/comments` — returns all comments for a post, chronological, with author names
- `POST /api/home-base/posts/:id/comments` — add a comment. Body: `{ body }`
- `DELETE /api/home-base/comments/:id` — delete a comment. Only the original author can delete

## Frontend

- Add "Home Base" to the sidebar navigation — place it in the MANAGE section, near Teams
- Use whatever frontend approach the rest of Lightspeed uses (EJS templates with client-side JS, etc.)
- The page should feel fast — load the initial feed on page load, then handle comment expanding and new posts/comments via fetch calls without full page reloads
- Keep styling consistent with the rest of Lightspeed — same fonts, colors, card styles, spacing

## Sidebar Icon

Use a simple home icon (🏠) or a bulletin board icon next to "Home Base" in the sidebar, matching the icon style used for other nav items.

## What NOT to Do

- No real-time updates or WebSockets — users can refresh to see new posts, that's fine for v1
- No rich text editor, no markdown rendering, no image uploads — just plain text with line breaks
- No direct messages or private posts — everything on Home Base is visible to all team members
- No email notifications for new posts (the notification system from Runway can be extended later if needed)
- Don't break any existing features
- Don't install heavy dependencies — this is a simple CRUD feed
