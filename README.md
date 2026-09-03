# Advantal Support

Advantal Support is a lightweight support and field-operations portal built with a FastAPI backend, PostgreSQL database, and a static React frontend served through Nginx.

The portal supports ticket management, role-based permissions, chat updates, file uploads, and signoff reports.

## Tech Stack

- Backend: FastAPI, SQLAlchemy, PostgreSQL
- Frontend: React loaded from `frontend/index.html`
- Web server: Nginx
- Database: PostgreSQL 16
- Runtime: Docker Compose

## Project Structure

```text
.
+-- backend/
|   +-- main.py             # FastAPI app and API routes
|   +-- models.py           # SQLAlchemy models and permission definitions
|   +-- database.py         # Database connection setup
|   +-- migrate.py          # Lightweight schema migration helper
|   +-- seed.py             # Default roles, users, and demo tickets
|   +-- requirements.txt    # Python dependencies
|   +-- Dockerfile
+-- frontend/
|   +-- index.html          # Single-file React frontend
|   +-- nginx.conf          # Nginx config and API proxy rules
|   +-- Dockerfile
+-- docker-compose.yml      # Full app stack
+-- env.example             # Example environment configuration
+-- .env                    # Local environment configuration
+-- rebuild.bat             # Windows helper for a clean rebuild
```

## Prerequisites

- Docker Desktop
- Docker Compose v2

Check your installation:

```powershell
docker --version
docker compose version
```

## Environment Setup

Create a local `.env` file from the example if one does not already exist:

```powershell
Copy-Item env.example .env
```

Common settings:

```env
PORT=80
SECRET_KEY=change-me-in-production-use-a-long-random-string
ALLOWED_ORIGINS=http://localhost
```

For production or shared environments, replace `SECRET_KEY` with a long random value.

## Start The Project

From the project root:

```powershell
docker compose up -d --build
```

Open the portal:

```text
http://localhost
```

Health check:

```text
http://localhost/health
```

Expected response:

```json
{"status":"ok"}
```

## Default Login

When the database is empty, the backend seeds default users and demo tickets.

```text
Admin
Email: admin@portal.com
Password: admin123
```

```text
SPOC
Email: john@spoc.com
Password: free123
```

```text
SPOC
Email: sara@spoc.com
Password: free123
```

Change these credentials before using the portal in production.

## Useful Commands

View running services:

```powershell
docker compose ps
```

View logs:

```powershell
docker compose logs -f
```

View backend logs only:

```powershell
docker compose logs -f backend
```

Stop the project:

```powershell
docker compose down
```

Rebuild and restart:

```powershell
docker compose up -d --build
```

Run the Windows rebuild helper:

```powershell
.\rebuild.bat
```

## Data And Uploads

Docker named volumes are used so data survives container rebuilds:

- `fieldops-db-data`: PostgreSQL data
- `fieldops-uploads`: uploaded files and signoff documents

Stopping containers with `docker compose down` does not delete these volumes.

To reset all app data and uploads:

```powershell
docker compose down -v
docker compose up -d --build
```

Use this carefully. It deletes the database and uploaded files.

## Clear Signoff Reports Only

To clear existing signoff reports while keeping tickets, users, and the Signoff module:

```powershell
$paths = docker exec fieldops-db psql -U fieldops -d fieldops -t -A -c "SELECT path FROM signoffs;"
$paths | Where-Object { $_.Trim() } | ForEach-Object {
  $path = $_.Trim()
  docker exec fieldops-backend sh -c "rm -f -- '/app$path'"
}
docker exec fieldops-db psql -U fieldops -d fieldops -c "DELETE FROM messages WHERE type='file' AND content LIKE 'Uploaded signoff:%'; DELETE FROM signoffs;"
```

This deletes only files currently referenced by signoff report rows, then removes the report records and their related upload messages.

## Email Notifications

Ticket activity can be emailed to the customer and to the product's SPOCs. SMTP
is configured from the portal itself under **Notifications** (Super Admin only),
not through environment variables.

Setup order matters, because sending is gated on a verified configuration:

1. Enter the SMTP host, port, security, credentials and From address, then **Save Changes**.
2. **Send Test Email**. Only a successful test marks the configuration verified.
3. Tick **Send notifications** and choose which events should notify.

Changing any connection setting clears the verification, so a verified server
cannot be silently repointed elsewhere. The password is encrypted before storage
and is never sent back to the browser.

Recipients for every event are all active users of the ticket's customer plus
every active SPOC on the product's escalation matrix. Each message goes to a
single recipient — never Cc or Bcc — so customers never see each other's
addresses. Uploaded files are named in the email but never attached; recipients
sign in to the portal to download them.

Delivery is queued rather than sent inside the request, so a slow or unreachable
mail server never delays a ticket operation. Failures retry with exponential
backoff and every attempt is recorded in the **Delivery Log** on the same page,
where a failed message can be retried by hand.

### Testing notifications locally

A Mailpit catcher is included behind a compose profile so it never starts in
production:

```powershell
docker compose --profile mail up -d
```

Configure the portal with host `mailpit`, port `1025`, security `None`, and read
the captured mail at `http://localhost:8025`.

## API Notes

The frontend reaches the backend through Nginx:

- `/api/` proxies to the FastAPI app
- `/health` proxies to the backend health endpoint

Every API route requires authentication except `POST /api/auth/login` and the
`/health` probe. Uploaded files are not served statically: they are delivered by
`GET /api/files/{file_id}`, which authenticates the caller and then authorises
them against the ticket the file belongs to. Because a browser cannot send an
`Authorization` header when it opens an image or a link, that route also accepts
the httpOnly session cookie set at login, scoped to `/api/files` so it is never
sent to a state-changing endpoint. Set `COOKIE_SECURE=true` when serving over
HTTPS.

The backend container listens on port `8000` inside the Docker network. The frontend is exposed on `${PORT:-80}`.

## Troubleshooting

If Docker commands fail with a Docker engine or named pipe error, start Docker Desktop and retry after the engine is ready.

If port `80` is already in use, edit `.env`:

```env
PORT=8080
```

Then restart:

```powershell
docker compose up -d --build
```

Open:

```text
http://localhost:8080
```

If the portal opens but API calls fail, check the backend logs:

```powershell
docker compose logs -f backend
```

If the database does not become healthy, check the database logs:

```powershell
docker compose logs -f db
```
