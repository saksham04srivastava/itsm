"""Seed roles first, then users and demo data. Runs once if DB is empty."""
import bcrypt, uuid
from datetime import datetime
from sqlalchemy.orm import Session
from models import Role, User, Ticket, Message, ALL_PERMISSIONS

def hash_pw(p):
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()

# ─── Default system roles ─────────────────────────────────────────────────────
SYSTEM_ROLES = [
    {
        "id": "role_admin",
        "name": "Admin",
        "description": "Full system access — can manage everything",
        "color": "#4f6ef7",
        "is_system": True,
        "permissions": ALL_PERMISSIONS,   # all permissions
    },
    {
        "id": "role_freelancer",
        "name": "Freelancer",
        "description": "Field engineer — can update assigned tickets and upload signoffs",
        "color": "#22c55e",
        "is_system": True,
        "permissions": [
            "tickets.edit_assigned",
            "messages.view",
            "messages.send",
            "signoffs.upload",
        ],
    },
    {
        "id": "role_supervisor",
        "name": "Supervisor",
        "description": "Can view all tickets and assign work, but cannot delete",
        "color": "#f59e0b",
        "is_system": False,
        "permissions": [
            "tickets.view_all",
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

    # Create roles
    for r in SYSTEM_ROLES:
        db.add(Role(**r, created_at=datetime.utcnow()))
    db.flush()

    # Create users
    admin = User(id="u1", email="admin@portal.com", name="Admin User",
                 role_id="role_admin", avatar="A", active=True,
                 hashed_password=hash_pw("admin123"), created_at=datetime.utcnow())
    john  = User(id="u2", email="john@freelancer.com", name="John Doe",
                 role_id="role_freelancer", avatar="J", active=True,
                 phone="+91 98765 43210", skills="Network Installation, Fiber Optics",
                 hashed_password=hash_pw("free123"), created_at=datetime.utcnow())
    sara  = User(id="u3", email="sara@freelancer.com", name="Sara Smith",
                 role_id="role_freelancer", avatar="S", active=True,
                 phone="+91 99887 76655", skills="CCTV, Switch Migration",
                 hashed_password=hash_pw("free123"), created_at=datetime.utcnow())
    db.add_all([admin, john, sara])
    db.flush()

    # Demo tickets
    t1 = Ticket(id="T-001", title="Network Router Installation - Site A",
                description="Install and configure 3x Cisco routers at Mumbai data center.",
                customer="Acme Corp", assigned_to="u2", status="in_progress",
                priority="high", type="INSTALLATION", budget=15000, progress=50,
                due_date="2026-03-15", created_by="u1",
                milestones=[
                    {"id":"m1","title":"Site Survey","done":True},
                    {"id":"m2","title":"Hardware Delivery","done":True},
                    {"id":"m3","title":"Installation","done":False},
                    {"id":"m4","title":"Testing & Signoff","done":False},
                ])
    t2 = Ticket(id="T-002", title="Fiber Optic Survey - Pune Branch",
                description="Survey for fiber optic rollout across 5 floors.",
                customer="Beta Solutions", assigned_to="u3", status="open",
                priority="medium", type="SURVEY", budget=8000, progress=0,
                due_date="2026-03-20", created_by="u1",
                milestones=[
                    {"id":"m1","title":"Initial Assessment","done":False},
                    {"id":"m2","title":"Floor Plans Review","done":False},
                    {"id":"m3","title":"Report Submission","done":False},
                ])
    t3 = Ticket(id="T-003", title="Switch Migration - Server Room",
                description="Migrate legacy switches to Juniper EX series.",
                customer="Gamma Tech", assigned_to="u2", status="completed",
                priority="critical", type="MIGRATION", budget=25000, progress=100,
                due_date="2026-03-01", created_by="u1",
                milestones=[
                    {"id":"m1","title":"Pre-migration backup","done":True},
                    {"id":"m2","title":"Migration execution","done":True},
                    {"id":"m3","title":"Verification","done":True},
                ])
    db.add_all([t1, t2, t3])
    db.flush()

    msgs = [
        Message(id="msg1", ticket_id="T-001", user_id="u2", user_name="John Doe",
                role="Freelancer", content="Reached site. Starting cable audit.", type="text"),
        Message(id="msg2", ticket_id="T-001", user_id="u1", user_name="Admin User",
                role="Admin", content="Good. Complete installation by EOD.", type="text"),
        Message(id="msg3", ticket_id="T-001", user_id="u2", user_name="John Doe",
                role="Freelancer", content="Routers 1 and 2 installed. Router 3 pending.", type="update"),
        Message(id="msg4", ticket_id="T-003", user_id="u2", user_name="John Doe",
                role="Freelancer", content="Migration completed. All services up.", type="update"),
    ]
    db.add_all(msgs)
    db.commit()
    print("✅ Seed complete — 4 roles, 3 users, 3 tickets.")
