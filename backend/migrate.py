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
    db_conn.execute(text("""
        CREATE TABLE IF NOT EXISTS products (
            id                  VARCHAR PRIMARY KEY,
            name                VARCHAR NOT NULL,
            code                VARCHAR DEFAULT '',
            company_id          VARCHAR,
            escalation_user_ids JSON DEFAULT '[]',
            active              BOOLEAN DEFAULT TRUE,
            created_at          TIMESTAMP DEFAULT NOW(),
            updated_at          TIMESTAMP DEFAULT NOW()
        )
    """))
    print("  products table ready")
    print("🔄 Running migrations...")

    db_conn.execute(text("""
        CREATE TABLE IF NOT EXISTS companies (
            id          VARCHAR PRIMARY KEY,
            name        VARCHAR UNIQUE NOT NULL,
            code        VARCHAR UNIQUE NOT NULL,
            product_ids JSON DEFAULT '[]',
            active      BOOLEAN DEFAULT TRUE,
            created_at  TIMESTAMP DEFAULT NOW(),
            updated_at  TIMESTAMP DEFAULT NOW()
        )
    """))
    print("  ✓ companies table ready")

    result = db_conn.execute(text("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name='companies' AND column_name='product_ids'
    """))
    if not result.fetchone():
        db_conn.execute(text("ALTER TABLE companies ADD COLUMN product_ids JSON DEFAULT '[]'"))
        print("  ✓ Added companies.product_ids column")

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

    old_role_col = db_conn.execute(text("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name='users' AND column_name='role'
    """)).fetchone()
    if old_role_col:
        db_conn.execute(text("""
            UPDATE users
            SET role = COALESCE(NULLIF(role, ''), 'viewer')
            WHERE role IS NULL OR role = ''
        """))
        try:
            db_conn.execute(text("ALTER TABLE users ALTER COLUMN role DROP NOT NULL"))
            print("  ✓ Relaxed legacy users.role constraint")
        except Exception as e:
            print(f"  ⚠ Could not relax legacy users.role constraint (non-fatal): {e}")

    result = db_conn.execute(text("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name='users' AND column_name='company_id'
    """))
    if not result.fetchone():
        db_conn.execute(text("ALTER TABLE users ADD COLUMN company_id VARCHAR"))
        print("  ✓ Added users.company_id column")

    result = db_conn.execute(text("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name='tickets' AND column_name='company_id'
    """))
    if not result.fetchone():
        db_conn.execute(text("ALTER TABLE tickets ADD COLUMN company_id VARCHAR"))
        print("  ✓ Added tickets.company_id column")

    result = db_conn.execute(text("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name='tickets' AND column_name='product_id'
    """))
    if not result.fetchone():
        db_conn.execute(text("ALTER TABLE tickets ADD COLUMN product_id VARCHAR"))
        print("  Added tickets.product_id column")

    try:
        db_conn.execute(text("ALTER TABLE products ALTER COLUMN company_id DROP NOT NULL"))
        print("  products.company_id is nullable for global products")
    except Exception as e:
        print(f"  products.company_id nullable check skipped (non-fatal): {e}")

    # ── Migration 3: Insert default system roles if not present ───────────────
    import json

    ALL_PERMISSIONS = [
        "companies.manage",
        "products.view","products.manage",
        "tickets.view_all","tickets.create","tickets.edit_any","tickets.edit_assigned",
        "tickets.delete","tickets.assign","messages.view","messages.send",
        "signoffs.upload","signoffs.view_all","users.view","users.create",
        "users.edit","users.delete","roles.view","roles.manage","dashboard.view_all",
        "email.manage",
    ]

    system_roles = [
        ("role_admin",      "Super Admin","Full cross-company system access",            "#4f6ef7", True,  ALL_PERMISSIONS),
        ("role_freelancer", "SPOC",       "Software support point of contact - update assigned tickets", "#22c55e", True,  ["products.view","tickets.view_all","tickets.create","tickets.edit_assigned","tickets.assign","messages.view","messages.send","signoffs.upload","signoffs.view_all","users.view","dashboard.view_all"]),
        ("role_supervisor", "Company Member", "View company tickets, assign work, no delete", "#f59e0b", False, ["products.view","tickets.view_all","tickets.create","tickets.edit_any","tickets.assign","messages.view","messages.send","signoffs.view_all","users.view","dashboard.view_all"]),
        ("role_viewer",     "Viewer",     "Read-only access",                            "#8b93b0", False, ["products.view","tickets.view_all","messages.view","signoffs.view_all","dashboard.view_all"]),
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

    db_conn.execute(text("""
        UPDATE roles
        SET name = 'Super Admin',
            description = 'Full cross-company system access',
            permissions = :perms
        WHERE id = 'role_admin'
    """), {"perms": json.dumps(ALL_PERMISSIONS)})
    print("  ✓ Updated role_admin display name to Super Admin")

    db_conn.execute(text("""
        UPDATE roles
        SET name = 'Company Member',
            description = 'View company tickets, assign work, no delete'
        WHERE id = 'role_supervisor'
    """))
    print("  ✓ Updated role_supervisor display name to Company Member")

    db_conn.execute(text("""
        INSERT INTO companies (id, name, code, active, created_at)
        VALUES ('co_default', 'Default Company', 'DEFAULT', TRUE, NOW())
        ON CONFLICT (id) DO NOTHING
    """))
    db_conn.execute(text("""
        INSERT INTO companies (id, name, code, active, created_at)
        VALUES ('co_acme', 'Acme Corp', 'ACME', TRUE, NOW())
        ON CONFLICT (id) DO NOTHING
    """))
    db_conn.execute(text("""
        INSERT INTO companies (id, name, code, active, created_at)
        VALUES ('co_beta', 'Beta Solutions', 'BETA', TRUE, NOW())
        ON CONFLICT (id) DO NOTHING
    """))

    db_conn.execute(text("""
        UPDATE roles
        SET name = 'SPOC',
            description = 'Software support point of contact - update assigned tickets',
            permissions = :perms
        WHERE id = 'role_freelancer'
    """), {"perms": json.dumps(["products.view","tickets.view_all","tickets.create","tickets.edit_assigned","tickets.assign","messages.view","messages.send","signoffs.upload","signoffs.view_all","users.view","dashboard.view_all"])})
    print("  ✓ Updated role_freelancer display name to SPOC")

    db_conn.execute(text("""
        UPDATE roles
        SET permissions = :perms
        WHERE id = 'role_supervisor'
    """), {"perms": json.dumps(["products.view","tickets.view_all","tickets.create","tickets.edit_any","tickets.assign","messages.view","messages.send","signoffs.view_all","users.view","dashboard.view_all"])})

    db_conn.execute(text("""
        UPDATE roles
        SET permissions = :perms
        WHERE id = 'role_viewer'
    """), {"perms": json.dumps(["products.view","tickets.view_all","messages.view","signoffs.view_all","dashboard.view_all"])})

    db_conn.execute(text("""
        UPDATE users
        SET email = 'john@spoc.com',
            skills = 'CRM Support, API Troubleshooting',
            company_id = 'co_acme'
        WHERE id = 'u2'
          AND (email = 'john@freelancer.com' OR company_id IS NULL)
    """))
    db_conn.execute(text("""
        UPDATE users
        SET email = 'sara@spoc.com',
            skills = 'Database Queries, Application Configuration',
            company_id = 'co_beta'
        WHERE id = 'u3'
          AND (email = 'sara@freelancer.com' OR company_id IS NULL)
    """))
    db_conn.execute(text("""
        UPDATE users
        SET company_id = 'co_default'
        WHERE company_id IS NULL
          AND COALESCE(role_id, '') != 'role_admin'
    """))
    db_conn.execute(text("""
        INSERT INTO products (id, name, code, company_id, escalation_user_ids, active, created_at)
        VALUES ('prod_acme_crm', 'CRM Portal', 'CRM', NULL, :acme_matrix, TRUE, NOW())
        ON CONFLICT (id) DO NOTHING
    """), {"acme_matrix": json.dumps(["u2"])})
    db_conn.execute(text("""
        INSERT INTO products (id, name, code, company_id, escalation_user_ids, active, created_at)
        VALUES ('prod_beta_sales', 'Sales Dashboard', 'SALES_DASH', NULL, :beta_matrix, TRUE, NOW())
        ON CONFLICT (id) DO NOTHING
    """), {"beta_matrix": json.dumps(["u3"])})
    db_conn.execute(text("""
        INSERT INTO products (id, name, code, company_id, escalation_user_ids, active, created_at)
        VALUES ('prod_acme_finance', 'Finance Module', 'FINANCE', NULL, :finance_matrix, TRUE, NOW())
        ON CONFLICT (id) DO NOTHING
    """), {"finance_matrix": json.dumps(["u2"])})
    db_conn.execute(text("""
        UPDATE products
        SET company_id = NULL
        WHERE id IN ('prod_acme_crm', 'prod_beta_sales', 'prod_acme_finance')
    """))

    db_conn.execute(text("""
        UPDATE companies SET product_ids = :ids
        WHERE id = 'co_acme' AND (product_ids IS NULL OR product_ids::text = '[]')
    """), {"ids": json.dumps(["prod_acme_crm", "prod_acme_finance"])})
    db_conn.execute(text("""
        UPDATE companies SET product_ids = :ids
        WHERE id = 'co_beta' AND (product_ids IS NULL OR product_ids::text = '[]')
    """), {"ids": json.dumps(["prod_beta_sales"])})
    print("  ✓ Mapped demo products to demo customers")

    db_conn.execute(text("""
        UPDATE tickets
        SET company_id = 'co_acme',
            customer = 'Acme Corp'
        WHERE id IN ('T-001', 'T-003')
          AND company_id IS NULL
    """))
    db_conn.execute(text("""
        UPDATE tickets
        SET company_id = 'co_beta',
            customer = 'Beta Solutions'
        WHERE id = 'T-002'
          AND company_id IS NULL
    """))
    db_conn.execute(text("""
        UPDATE tickets
        SET company_id = 'co_default'
        WHERE company_id IS NULL
    """))

    db_conn.execute(text("""
        UPDATE tickets
        SET title = 'Login Issue - CRM Portal',
            description = 'User cannot sign in to the CRM portal after password reset.',
            type = 'SOFTWARE_SUPPORT',
            budget = 0,
            company_id = 'co_acme',
            product_id = 'prod_acme_crm',
            customer = 'Acme Corp',
            milestones = :milestones
        WHERE id = 'T-001'
          AND title = 'Network Router Installation - Site A'
    """), {"milestones": json.dumps([
        {"id":"m1","title":"Issue Reproduced","done":True},
        {"id":"m2","title":"Logs Reviewed","done":True},
        {"id":"m3","title":"Fix Applied","done":False},
        {"id":"m4","title":"User Confirmation","done":False},
    ])})
    db_conn.execute(text("""
        UPDATE tickets
        SET title = 'Report Export Failure - Sales Dashboard',
            description = 'CSV export fails for the monthly sales dashboard.',
            type = 'BUG',
            budget = 0,
            company_id = 'co_beta',
            product_id = 'prod_beta_sales',
            customer = 'Beta Solutions',
            milestones = :milestones
        WHERE id = 'T-002'
          AND title = 'Fiber Optic Survey - Pune Branch'
    """), {"milestones": json.dumps([
        {"id":"m1","title":"Initial Assessment","done":False},
        {"id":"m2","title":"Patch Review","done":False},
        {"id":"m3","title":"Resolution Update","done":False},
    ])})
    db_conn.execute(text("""
        UPDATE tickets
        SET title = 'Role Access Update - Finance Module',
            description = 'Grant approved users access to the finance module.',
            type = 'ACCESS_REQUEST',
            budget = 0,
            company_id = 'co_acme',
            product_id = 'prod_acme_finance',
            customer = 'Acme Corp',
            milestones = :milestones
        WHERE id = 'T-003'
          AND title = 'Switch Migration - Server Room'
    """), {"milestones": json.dumps([
        {"id":"m1","title":"Approval Verified","done":True},
        {"id":"m2","title":"Access Granted","done":True},
        {"id":"m3","title":"Verification","done":True},
    ])})
    db_conn.execute(text("UPDATE tickets SET product_id = 'prod_acme_crm' WHERE id = 'T-001' AND product_id IS NULL"))
    db_conn.execute(text("UPDATE tickets SET product_id = 'prod_beta_sales' WHERE id = 'T-002' AND product_id IS NULL"))
    db_conn.execute(text("UPDATE tickets SET product_id = 'prod_acme_finance' WHERE id = 'T-003' AND product_id IS NULL"))
    db_conn.execute(text("""
        UPDATE messages
        SET role = 'SPOC',
            content = 'I reproduced the login issue and started reviewing auth logs.'
        WHERE id = 'msg1'
          AND content = 'Reached site. Starting cable audit.'
    """))
    db_conn.execute(text("""
        UPDATE messages
        SET content = 'Good. Please share the fix status after validation.'
        WHERE id = 'msg2'
          AND content = 'Good. Complete installation by EOD.'
    """))
    db_conn.execute(text("""
        UPDATE messages
        SET role = 'SPOC',
            content = 'Root cause found in the password reset token flow. Fix is in progress.'
        WHERE id = 'msg3'
          AND content = 'Routers 1 and 2 installed. Router 3 pending.'
    """))
    db_conn.execute(text("""
        UPDATE messages
        SET role = 'SPOC',
            content = 'Access update completed and verified with the requester.'
        WHERE id = 'msg4'
          AND content = 'Migration completed. All services up.'
    """))
    print("  ✓ Refreshed software support demo tickets")

    # ── Migration 4: Map old users.role string → new users.role_id FK ─────────
    # Only for rows where role_id is still NULL
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

    company_user_fk = db_conn.execute(text("""
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_name='users' AND constraint_type='FOREIGN KEY'
        AND constraint_name='users_company_id_fkey'
    """)).fetchone()
    if not company_user_fk:
        try:
            db_conn.execute(text("""
                ALTER TABLE users
                ADD CONSTRAINT users_company_id_fkey
                FOREIGN KEY (company_id) REFERENCES companies(id)
            """))
            print("  ✓ Added FK constraint users.company_id → companies.id")
        except Exception as e:
            print(f"  ⚠ Could not add users.company_id FK (non-fatal): {e}")

    company_ticket_fk = db_conn.execute(text("""
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_name='tickets' AND constraint_type='FOREIGN KEY'
        AND constraint_name='tickets_company_id_fkey'
    """)).fetchone()
    if not company_ticket_fk:
        try:
            db_conn.execute(text("""
                ALTER TABLE tickets
                ADD CONSTRAINT tickets_company_id_fkey
                FOREIGN KEY (company_id) REFERENCES companies(id)
            """))
            print("  ✓ Added FK constraint tickets.company_id → companies.id")
        except Exception as e:
            print(f"  ⚠ Could not add tickets.company_id FK (non-fatal): {e}")

    product_company_fk = db_conn.execute(text("""
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_name='products' AND constraint_type='FOREIGN KEY'
        AND constraint_name='products_company_id_fkey'
    """)).fetchone()
    if not product_company_fk:
        try:
            db_conn.execute(text("""
                ALTER TABLE products
                ADD CONSTRAINT products_company_id_fkey
                FOREIGN KEY (company_id) REFERENCES companies(id)
            """))
            print("  Added FK constraint products.company_id -> companies.id")
        except Exception as e:
            print(f"  Could not add products.company_id FK (non-fatal): {e}")

    ticket_product_fk = db_conn.execute(text("""
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_name='tickets' AND constraint_type='FOREIGN KEY'
        AND constraint_name='tickets_product_id_fkey'
    """)).fetchone()
    if not ticket_product_fk:
        try:
            db_conn.execute(text("""
                ALTER TABLE tickets
                ADD CONSTRAINT tickets_product_id_fkey
                FOREIGN KEY (product_id) REFERENCES products(id)
            """))
            print("  Added FK constraint tickets.product_id -> products.id")
        except Exception as e:
            print(f"  Could not add tickets.product_id FK (non-fatal): {e}")

    # ── Email notifications ───────────────────────────────────────────────────
    # The tables themselves are created by Base.metadata.create_all; this only
    # seeds the singleton settings row and pins it to a single id.
    db_conn.execute(text("""
        INSERT INTO email_settings (id, enabled, port, security, verify_tls, from_name,
                                    timeout_seconds, max_attempts, events, updated_at)
        VALUES ('email_settings', FALSE, 587, 'starttls', TRUE, 'Advantal Support',
                20, 5, '{}', (NOW() AT TIME ZONE 'UTC'))
        ON CONFLICT (id) DO NOTHING
    """))
    print("  ✓ email_settings singleton ready")

    singleton_check = db_conn.execute(text("""
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_name='email_settings' AND constraint_type='CHECK'
        AND constraint_name='email_settings_singleton'
    """)).fetchone()
    if not singleton_check:
        try:
            db_conn.execute(text("""
                ALTER TABLE email_settings
                ADD CONSTRAINT email_settings_singleton CHECK (id = 'email_settings')
            """))
            print("  ✓ Added email_settings singleton constraint")
        except Exception as e:
            print(f"  Could not add email_settings singleton constraint (non-fatal): {e}")

    db_conn.commit()
    print("✅ Migrations complete.")

if __name__ == "__main__":
    with engine.connect() as conn:
        run(conn)
