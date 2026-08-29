"""
Database migration script.
Runs automatically on startup BEFORE seed.py.
Safely migrates old schema (users.role string) to new schema (users.role_id FK).
Idempotent — safe to run multiple times.
"""
import time
from sqlalchemy import text
from database import engine

def run(db_conn):
    print("🔄 Running migrations...")

    # ── Migration 1: Create roles table if it doesn't exist ───────────────────
    db_conn.execute(text("""
        CREATE TABLE IF NOT EXISTS roles (
            id          VARCHAR PRIMARY KEY,
            name        VARCHAR UNIQUE NOT NULL,
            description VARCHAR DEFAULT '',
            color       VARCHAR DEFAULT '#4f6ef7',
            is_system   BOOLEAN DEFAULT FALSE,
            permissions JSON DEFAULT '[]',
            created_at  TIMESTAMP DEFAULT NOW(),
            updated_at  TIMESTAMP DEFAULT NOW()
        )
    """))
    print("  ✓ roles table ready")

    # ── Migration 2: Add role_id column to users if missing ───────────────────
    result = db_conn.execute(text("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name='users' AND column_name='role_id'
    """))
    if not result.fetchone():
        db_conn.execute(text("ALTER TABLE users ADD COLUMN role_id VARCHAR"))
        print("  ✓ Added users.role_id column")

    # ── Migration 3: Insert default system roles if not present ───────────────
    import json

    ALL_PERMISSIONS = [
        "tickets.view_all","tickets.create","tickets.edit_any","tickets.edit_assigned",
        "tickets.delete","tickets.assign","messages.view","messages.send",
        "signoffs.upload","signoffs.view_all","users.view","users.create",
        "users.edit","users.delete","roles.view","roles.manage","dashboard.view_all",
    ]

    system_roles = [
        ("role_admin",      "Admin",      "Full system access",                          "#4f6ef7", True,  ALL_PERMISSIONS),
        ("role_freelancer", "Freelancer", "Field engineer — update assigned tickets",     "#22c55e", True,  ["tickets.edit_assigned","messages.view","messages.send","signoffs.upload"]),
        ("role_supervisor", "Supervisor", "View all tickets, assign work, no delete",     "#f59e0b", False, ["tickets.view_all","tickets.edit_any","tickets.assign","messages.view","messages.send","signoffs.view_all","users.view","dashboard.view_all"]),
        ("role_viewer",     "Viewer",     "Read-only access",                            "#8b93b0", False, ["tickets.view_all","messages.view","signoffs.view_all","dashboard.view_all"]),
    ]

    for rid, name, desc, color, is_sys, perms in system_roles:
        exists = db_conn.execute(text("SELECT id FROM roles WHERE id=:id"), {"id": rid}).fetchone()
        if not exists:
            db_conn.execute(text("""
                INSERT INTO roles (id, name, description, color, is_system, permissions, created_at)
                VALUES (:id, :name, :desc, :color, :is_sys, :perms, NOW())
            """), {"id": rid, "name": name, "desc": desc, "color": color,
                   "is_sys": is_sys, "perms": json.dumps(perms)})
            print(f"  ✓ Inserted role: {name}")

    # ── Migration 4: Map old users.role string → new users.role_id FK ─────────
    # Only for rows where role_id is still NULL
    old_role_col = db_conn.execute(text("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name='users' AND column_name='role'
    """)).fetchone()

    if old_role_col:
        # Map old string values to new role IDs
        mappings = [
            ("admin",      "role_admin"),
            ("freelancer", "role_freelancer"),
            ("supervisor", "role_supervisor"),
            ("viewer",     "role_viewer"),
        ]
        for old_val, new_id in mappings:
            db_conn.execute(text("""
                UPDATE users SET role_id = :new_id
                WHERE role = :old_val AND (role_id IS NULL OR role_id = '')
            """), {"new_id": new_id, "old_val": old_val})
        print("  ✓ Migrated users.role → users.role_id")

    # ── Migration 5: Any remaining users without role_id get Admin role ────────
    db_conn.execute(text("""
        UPDATE users SET role_id = 'role_admin'
        WHERE role_id IS NULL OR role_id = ''
    """))

    # ── Migration 6: Add FK constraint if not already there ───────────────────
    fk_exists = db_conn.execute(text("""
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_name='users' AND constraint_type='FOREIGN KEY'
        AND constraint_name='users_role_id_fkey'
    """)).fetchone()
    if not fk_exists:
        try:
            db_conn.execute(text("""
                ALTER TABLE users
                ADD CONSTRAINT users_role_id_fkey
                FOREIGN KEY (role_id) REFERENCES roles(id)
            """))
            print("  ✓ Added FK constraint users.role_id → roles.id")
        except Exception as e:
            print(f"  ⚠ Could not add FK (non-fatal): {e}")

    db_conn.commit()
    print("✅ Migrations complete.")

if __name__ == "__main__":
    with engine.connect() as conn:
        run(conn)
