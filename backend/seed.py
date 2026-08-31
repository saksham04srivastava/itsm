"""Seed roles first, then users and demo data. Runs once if DB is empty."""
import bcrypt, uuid
from datetime import datetime
from sqlalchemy.orm import Session
from models import Company, Product, Role, User, Ticket, Message, ALL_PERMISSIONS

def hash_pw(p):
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()

# ─── Default system roles ─────────────────────────────────────────────────────
SYSTEM_ROLES = [
    {
        "id": "role_admin",
        "name": "Super Admin",
        "description": "Full cross-company system access",
        "color": "#4f6ef7",
        "is_system": True,
        "permissions": ALL_PERMISSIONS,   # all permissions
    },
    {
        "id": "role_freelancer",
        "name": "SPOC",
        "description": "Software support point of contact - can update assigned tickets and upload signoffs",
        "color": "#22c55e",
        "is_system": True,
        "permissions": [
            "products.view",
            "tickets.view_all",
            "tickets.create",
            "tickets.edit_assigned",
            "tickets.assign",
            "messages.view",
            "messages.send",
            "signoffs.upload",
            "signoffs.view_all",
            "users.view",
            "dashboard.view_all",
        ],
    },
    {
        "id": "role_supervisor",
        "name": "Company Member",
        "description": "Can view company tickets and assign work, but cannot delete",
        "color": "#f59e0b",
        "is_system": False,
        "permissions": [
            "products.view",
            "tickets.view_all",
            "tickets.create",
            "tickets.edit_any",
            "tickets.assign",
            "messages.view",
            "messages.send",
            "signoffs.view_all",
            "users.view",
            "dashboard.view_all",
        ],
    },
    {
        "id": "role_viewer",
        "name": "Viewer",
        "description": "Read-only access to tickets and dashboard",
        "color": "#8b93b0",
        "is_system": False,
        "permissions": [
            "products.view",
            "tickets.view_all",
            "messages.view",
            "signoffs.view_all",
            "dashboard.view_all",
        ],
    },
]

def seed(db: Session):
    if db.query(User).count() > 0:
        return

    print("🌱 Seeding roles and users...")

    # Create companies
    acme = Company(id="co_acme", name="Acme Corp", code="ACME", active=True, created_at=datetime.utcnow())
    beta = Company(id="co_beta", name="Beta Solutions", code="BETA", active=True, created_at=datetime.utcnow())
    db.add_all([acme, beta])
    db.flush()

    # Create roles
    for r in SYSTEM_ROLES:
        db.add(Role(**r, created_at=datetime.utcnow()))
    db.flush()

    # Create users
    admin = User(id="u1", email="admin@portal.com", name="Admin User",
                 role_id="role_admin", company_id=None, avatar="A", active=True,
                 hashed_password=hash_pw("admin123"), created_at=datetime.utcnow())
    john  = User(id="u2", email="john@spoc.com", name="John Doe",
                 role_id="role_freelancer", company_id="co_acme", avatar="J", active=True,
                 phone="+91 98765 43210", skills="CRM Support, API Troubleshooting",
                 hashed_password=hash_pw("free123"), created_at=datetime.utcnow())
    sara  = User(id="u3", email="sara@spoc.com", name="Sara Smith",
                 role_id="role_freelancer", company_id="co_beta", avatar="S", active=True,
                 phone="+91 99887 76655", skills="Database Queries, Application Configuration",
                 hashed_password=hash_pw("free123"), created_at=datetime.utcnow())
    db.add_all([admin, john, sara])
    db.flush()

    crm = Product(id="prod_acme_crm", name="CRM Portal", code="CRM",
                  company_id="co_acme", escalation_user_ids=["u2"],
                  active=True, created_at=datetime.utcnow())
    sales = Product(id="prod_beta_sales", name="Sales Dashboard", code="SALES_DASH",
                    company_id="co_beta", escalation_user_ids=["u3"],
                    active=True, created_at=datetime.utcnow())
    finance = Product(id="prod_acme_finance", name="Finance Module", code="FINANCE",
                      company_id="co_acme", escalation_user_ids=["u2"],
                      active=True, created_at=datetime.utcnow())
    db.add_all([crm, sales, finance])
    db.flush()

    # Demo tickets
    t1 = Ticket(id="T-001", title="Login Issue - CRM Portal",
                description="User cannot sign in to the CRM portal after password reset.",
                customer="Acme Corp", company_id="co_acme", product_id="prod_acme_crm",
                assigned_to="u2", status="in_progress",
                priority="high", type="SOFTWARE_SUPPORT", progress=50,
                due_date="2026-03-15", created_by="u1",
                milestones=[
                    {"id":"m1","title":"Issue Reproduced","done":True},
                    {"id":"m2","title":"Logs Reviewed","done":True},
                    {"id":"m3","title":"Fix Applied","done":False},
                    {"id":"m4","title":"User Confirmation","done":False},
                ])
    t2 = Ticket(id="T-002", title="Report Export Failure - Sales Dashboard",
                description="CSV export fails for the monthly sales dashboard.",
                customer="Beta Solutions", company_id="co_beta", product_id="prod_beta_sales",
                assigned_to="u3", status="open",
                priority="medium", type="BUG", progress=0,
                due_date="2026-03-20", created_by="u1",
                milestones=[
                    {"id":"m1","title":"Initial Assessment","done":False},
                    {"id":"m2","title":"Patch Review","done":False},
                    {"id":"m3","title":"Resolution Update","done":False},
                ])
    t3 = Ticket(id="T-003", title="Role Access Update - Finance Module",
                description="Grant approved users access to the finance module.",
                customer="Acme Corp", company_id="co_acme", product_id="prod_acme_finance",
                assigned_to="u2", status="completed",
                priority="critical", type="ACCESS_REQUEST", progress=100,
                due_date="2026-03-01", created_by="u1",
                milestones=[
                    {"id":"m1","title":"Approval Verified","done":True},
                    {"id":"m2","title":"Access Granted","done":True},
                    {"id":"m3","title":"Verification","done":True},
                ])
    db.add_all([t1, t2, t3])
    db.flush()

    msgs = [
        Message(id="msg1", ticket_id="T-001", user_id="u2", user_name="John Doe",
                role="SPOC", content="I reproduced the login issue and started reviewing auth logs.", type="text"),
        Message(id="msg2", ticket_id="T-001", user_id="u1", user_name="Admin User",
                role="Admin", content="Good. Please share the fix status after validation.", type="text"),
        Message(id="msg3", ticket_id="T-001", user_id="u2", user_name="John Doe",
                role="SPOC", content="Root cause found in the password reset token flow. Fix is in progress.", type="update"),
        Message(id="msg4", ticket_id="T-003", user_id="u2", user_name="John Doe",
                role="SPOC", content="Access update completed and verified with the requester.", type="update"),
    ]
    db.add_all(msgs)
    db.commit()
    print("✅ Seed complete — 4 roles, 3 users, 3 tickets.")
