from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta
from jose import JWTError, jwt
from sqlalchemy.orm import Session, joinedload
import bcrypt, uuid, os, shutil, time

from database import engine, get_db, Base
from models import Role, User, Ticket, Message, Signoff, ALL_PERMISSIONS, PERMISSION_GROUPS
import seed as seed_module
import migrate as migrate_module

# ─── Init DB: create tables → migrate schema → seed ──────────────────────────
def init_db():
    for attempt in range(10):
        try:
            Base.metadata.create_all(bind=engine)   # create new tables
            print("✅ Database tables created/verified")
            with engine.connect() as conn:
                migrate_module.run(conn)             # upgrade existing schema
            return
        except Exception as e:
            print(f"⏳ DB not ready ({attempt+1}/10): {e}")
            time.sleep(3)
    raise RuntimeError("Could not connect to database")

init_db()
from database import SessionLocal
_db = SessionLocal()
try:
    seed_module.seed(_db)
finally:
    _db.close()

# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(title="Advantal Support API", version="3.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

SECRET_KEY = os.environ.get("SECRET_KEY", "change-me-in-production")
ALGORITHM  = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24
security = HTTPBearer()

@app.get("/health")
def health(): return {"status": "ok"}

# ─── Helpers ─────────────────────────────────────────────────────────────────
def hash_password(p): return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()
def verify_password(p, h): return bcrypt.checkpw(p.encode(), h.encode())
def create_token(data):
    exp = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({**data, "exp": exp}, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(creds: HTTPAuthorizationCredentials = Depends(security),
                     db: Session = Depends(get_db)) -> User:
    try:
        payload = jwt.decode(creds.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
        if not email: raise HTTPException(401, "Invalid token")
        user = db.query(User).options(joinedload(User.role_obj)).filter(User.email == email).first()
        if not user: raise HTTPException(401, "User not found")
        if not user.active: raise HTTPException(403, "Account inactive")
        return user
    except JWTError:
        raise HTTPException(401, "Invalid token")

def require_perm(perm: str):
    def checker(user: User = Depends(get_current_user)):
        if not user.can(perm):
            raise HTTPException(403, f"Permission required: {perm}")
        return user
    return checker

# ─── Serialisers ─────────────────────────────────────────────────────────────
def ser_role(r: Role) -> dict:
    return {
        "id": r.id, "name": r.name, "description": r.description or "",
        "color": r.color or "#4f6ef7", "is_system": r.is_system,
        "permissions": r.permissions or [],
        "user_count": len(r.users) if r.users else 0,
        "created_at": r.created_at.isoformat() if r.created_at else "",
    }

def ser_user(u: User) -> dict:
    return {
        "id": u.id, "email": u.email, "name": u.name,
        "role_id": u.role_id, "role_name": u.role_obj.name if u.role_obj else "",
        "role_color": u.role_obj.color if u.role_obj else "#8b93b0",
        "permissions": u.permissions,
        "phone": u.phone or "", "skills": u.skills or "",
        "avatar": u.avatar or u.name[0].upper(),
        "active": True if u.active is None else u.active,
        "created_at": u.created_at.isoformat() if u.created_at else "",
        "updated_at": u.updated_at.isoformat() if u.updated_at else "",
    }

def ser_ticket(t: Ticket) -> dict:
    return {
        "id": t.id, "title": t.title, "description": t.description,
        "customer": t.customer, "assigned_to": t.assigned_to,
        "status": t.status, "priority": t.priority, "type": t.type,
        "budget": t.budget, "progress": t.progress, "due_date": t.due_date,
        "milestones": t.milestones or [], "created_by": t.created_by,
        "created_at": t.created_at.isoformat() if t.created_at else "",
        "updated_at": t.updated_at.isoformat() if t.updated_at else "",
    }

def ser_message(m: Message) -> dict:
    return {
        "id": m.id, "ticket_id": m.ticket_id,
        "user_id": m.user_id, "user_name": m.user_name, "role": m.role,
        "content": m.content, "type": m.type,
        "timestamp": m.timestamp.isoformat() if m.timestamp else "",
        "attachments": m.attachments or [],
    }

def ser_signoff(s: Signoff) -> dict:
    return {
        "id": s.id, "ticket_id": s.ticket_id, "filename": s.filename,
        "path": s.path, "description": s.description,
        "uploaded_by": s.uploaded_by, "uploaded_by_id": s.uploaded_by_id,
        "role": s.role, "size": s.size,
        "timestamp": s.timestamp.isoformat() if s.timestamp else "",
    }

# ─── Pydantic Schemas ─────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: str; password: str

class RoleCreate(BaseModel):
    name: str
    description: str = ""
    color: str = "#4f6ef7"
    permissions: List[str] = []

class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    permissions: Optional[List[str]] = None

class UserCreate(BaseModel):
    name: str; email: str; password: str
    role_id: str
    phone: Optional[str] = ""
    skills: Optional[str] = ""

class UserUpdateModel(BaseModel):
    name: Optional[str] = None
    role_id: Optional[str] = None
    phone: Optional[str] = None
    skills: Optional[str] = None
    password: Optional[str] = None
    active: Optional[bool] = None

class TicketCreate(BaseModel):
    title: str; description: str = ""; customer: str = ""
    assigned_to: str = ""; priority: str = "medium"
    type: str = "INSTALLATION"; budget: float = 0
    due_date: str = ""; milestones: List[dict] = []

class TicketUpdate(BaseModel):
    status: Optional[str] = None; progress: Optional[int] = None
    milestone_id: Optional[str] = None; milestone_done: Optional[bool] = None

class MessageCreate(BaseModel):
    content: str; type: str = "text"

# ══════════════════════════════════════════════════════════════════════════════
# AUTH
# ══════════════════════════════════════════════════════════════════════════════
@app.post("/api/auth/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).options(joinedload(User.role_obj)).filter(User.email == req.email).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(401, "Invalid credentials")
    if not user.active:
        raise HTTPException(403, "Account inactive. Contact admin.")
    return {"access_token": create_token({"sub": user.email}),
            "token_type": "bearer", "user": ser_user(user)}

@app.get("/api/auth/me")
def get_me(user: User = Depends(get_current_user)):
    return ser_user(user)

# ══════════════════════════════════════════════════════════════════════════════
# ROLES
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/permissions")
def get_all_permissions(user: User = Depends(require_perm("roles.view"))):
    return {"permissions": ALL_PERMISSIONS, "groups": PERMISSION_GROUPS}

@app.get("/api/roles")
def get_roles(user: User = Depends(require_perm("roles.view")), db: Session = Depends(get_db)):
    roles = db.query(Role).options(joinedload(Role.users)).order_by(Role.created_at).all()
    return [ser_role(r) for r in roles]

@app.get("/api/roles/{role_id}")
def get_role(role_id: str, user: User = Depends(require_perm("roles.view")), db: Session = Depends(get_db)):
    r = db.query(Role).options(joinedload(Role.users)).filter(Role.id == role_id).first()
    if not r: raise HTTPException(404, "Role not found")
    return ser_role(r)

@app.post("/api/roles")
def create_role(payload: RoleCreate, user: User = Depends(require_perm("roles.manage")), db: Session = Depends(get_db)):
    if db.query(Role).filter(Role.name == payload.name).first():
        raise HTTPException(409, "Role name already exists")
    invalid = [p for p in payload.permissions if p not in ALL_PERMISSIONS]
    if invalid: raise HTTPException(400, f"Unknown permissions: {invalid}")
    r = Role(id=f"role_{uuid.uuid4().hex[:8]}", name=payload.name,
             description=payload.description, color=payload.color,
             permissions=payload.permissions, is_system=False,
             created_at=datetime.utcnow())
    db.add(r)
    db.commit()
    db.refresh(r)
    return ser_role(r)

@app.patch("/api/roles/{role_id}")
def update_role(role_id: str, payload: RoleUpdate, user: User = Depends(require_perm("roles.manage")), db: Session = Depends(get_db)):
    r = db.query(Role).filter(Role.id == role_id).first()
    if not r: raise HTTPException(404, "Role not found")
    # System roles: only permissions can be updated (not name/description)
    if not r.is_system:
        if payload.name is not None:
            if db.query(Role).filter(Role.name == payload.name, Role.id != role_id).first():
                raise HTTPException(409, "Role name already exists")
            r.name = payload.name
        if payload.description is not None: r.description = payload.description
        if payload.color is not None: r.color = payload.color
    if payload.permissions is not None:
        invalid = [p for p in payload.permissions if p not in ALL_PERMISSIONS]
        if invalid: raise HTTPException(400, f"Unknown permissions: {invalid}")
        # Prevent removing roles.manage from your own role
        if r.id == user.role_id and "roles.manage" not in payload.permissions:
            raise HTTPException(400, "Cannot remove roles.manage from your own role")
        r.permissions = payload.permissions
    r.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(r)
    return ser_role(r)

@app.delete("/api/roles/{role_id}")
def delete_role(role_id: str, user: User = Depends(require_perm("roles.manage")), db: Session = Depends(get_db)):
    r = db.query(Role).options(joinedload(Role.users)).filter(Role.id == role_id).first()
    if not r: raise HTTPException(404, "Role not found")
    if r.is_system: raise HTTPException(400, "Cannot delete system roles")
    if r.users: raise HTTPException(400, f"Cannot delete: {len(r.users)} user(s) assigned to this role")
    db.delete(r)
    db.commit()
    return {"message": "Role deleted"}

# ══════════════════════════════════════════════════════════════════════════════
# USERS
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/users")
def get_users(user: User = Depends(require_perm("users.view")), db: Session = Depends(get_db)):
    users = db.query(User).options(joinedload(User.role_obj)).order_by(User.created_at).all()
    return [ser_user(u) for u in users]

@app.get("/api/users/assignable")
def get_assignable(user: User = Depends(require_perm("tickets.assign")), db: Session = Depends(get_db)):
    """Users who can be assigned tickets (have tickets.edit_assigned permission)"""
    all_users = db.query(User).options(joinedload(User.role_obj)).filter(User.active == True).all()
    return [ser_user(u) for u in all_users if "tickets.edit_assigned" in (u.permissions or [])]

@app.get("/api/users/{user_id}")
def get_user(user_id: str, user: User = Depends(require_perm("users.view")), db: Session = Depends(get_db)):
    u = db.query(User).options(joinedload(User.role_obj)).filter(User.id == user_id).first()
    if not u: raise HTTPException(404, "User not found")
    return ser_user(u)

@app.post("/api/users")
def create_user(payload: UserCreate, admin: User = Depends(require_perm("users.create")), db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(409, "Email already exists")
    if not db.query(Role).filter(Role.id == payload.role_id).first():
        raise HTTPException(400, "Invalid role_id")
    if len(payload.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    u = User(id=f"u{uuid.uuid4().hex[:8]}", email=payload.email, name=payload.name,
             role_id=payload.role_id, phone=payload.phone or "", skills=payload.skills or "",
             avatar=payload.name[0].upper(), active=True,
             hashed_password=hash_password(payload.password),
             created_by=admin.id, created_at=datetime.utcnow())
    db.add(u)
    db.commit()
    db.refresh(u)
    return ser_user(db.query(User).options(joinedload(User.role_obj)).filter(User.id == u.id).first())

@app.patch("/api/users/{user_id}")
def update_user(user_id: str, payload: UserUpdateModel, admin: User = Depends(require_perm("users.edit")), db: Session = Depends(get_db)):
    u = db.query(User).filter(User.id == user_id).first()
    if not u: raise HTTPException(404, "User not found")
    if u.id == admin.id and payload.role_id and payload.role_id != admin.role_id:
        raise HTTPException(400, "Cannot change your own role")
    if payload.name is not None:
        u.name = payload.name; u.avatar = payload.name[0].upper()
    if payload.role_id is not None:
        if not db.query(Role).filter(Role.id == payload.role_id).first():
            raise HTTPException(400, "Invalid role_id")
        u.role_id = payload.role_id
    if payload.phone is not None: u.phone = payload.phone
    if payload.skills is not None: u.skills = payload.skills
    if payload.active is not None: u.active = payload.active
    if payload.password:
        if len(payload.password) < 6: raise HTTPException(400, "Password min 6 chars")
        u.hashed_password = hash_password(payload.password)
    u.updated_at = datetime.utcnow()
    db.commit()
    return ser_user(db.query(User).options(joinedload(User.role_obj)).filter(User.id == u.id).first())

@app.delete("/api/users/{user_id}")
def delete_user(user_id: str, admin: User = Depends(require_perm("users.delete")), db: Session = Depends(get_db)):
    if user_id == admin.id: raise HTTPException(400, "Cannot delete your own account")
    u = db.query(User).filter(User.id == user_id).first()
    if not u: raise HTTPException(404, "User not found")
    db.delete(u)
    db.commit()
    return {"message": "User deleted"}

# ══════════════════════════════════════════════════════════════════════════════
# TICKETS
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/tickets")
def get_tickets(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(Ticket)
    if not user.can("tickets.view_all"):
        q = q.filter(Ticket.assigned_to == user.id)
    return [ser_ticket(t) for t in q.order_by(Ticket.created_at.desc()).all()]

@app.get("/api/tickets/{ticket_id}")
def get_ticket(ticket_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not t: raise HTTPException(404, "Ticket not found")
    if not user.can("tickets.view_all") and t.assigned_to != user.id:
        raise HTTPException(403, "Access denied")
    return ser_ticket(t)

@app.post("/api/tickets")
def create_ticket(payload: TicketCreate, user: User = Depends(require_perm("tickets.create")), db: Session = Depends(get_db)):
    count = db.query(Ticket).count()
    tid = f"T-{str(count + 1).zfill(3)}"
    while db.query(Ticket).filter(Ticket.id == tid).first():
        count += 1; tid = f"T-{str(count + 1).zfill(3)}"
    t = Ticket(id=tid, title=payload.title, description=payload.description,
               customer=payload.customer, assigned_to=payload.assigned_to or None,
               priority=payload.priority, type=payload.type, budget=payload.budget,
               due_date=payload.due_date, milestones=payload.milestones,
               status="open", progress=0, created_by=user.id,
               created_at=datetime.utcnow(), updated_at=datetime.utcnow())
    db.add(t)
    db.commit()
    db.refresh(t)
    return ser_ticket(t)

@app.patch("/api/tickets/{ticket_id}")
def update_ticket(ticket_id: str, payload: TicketUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not t: raise HTTPException(404, "Ticket not found")
    can_edit_any = user.can("tickets.edit_any")
    can_edit_own = user.can("tickets.edit_assigned") and t.assigned_to == user.id
    if not can_edit_any and not can_edit_own:
        raise HTTPException(403, "No permission to edit this ticket")
    if payload.status is not None: t.status = payload.status
    if payload.progress is not None: t.progress = payload.progress
    if payload.milestone_id is not None and payload.milestone_done is not None:
        ms = list(t.milestones or [])
        for m in ms:
            if m["id"] == payload.milestone_id: m["done"] = payload.milestone_done
        t.milestones = ms
    t.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(t)
    return ser_ticket(t)

@app.delete("/api/tickets/{ticket_id}")
def delete_ticket(ticket_id: str, user: User = Depends(require_perm("tickets.delete")), db: Session = Depends(get_db)):
    t = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not t: raise HTTPException(404, "Ticket not found")
    db.delete(t)
    db.commit()
    return {"message": "Deleted"}

# ══════════════════════════════════════════════════════════════════════════════
# MESSAGES
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/tickets/{ticket_id}/messages")
def get_messages(ticket_id: str, user: User = Depends(require_perm("messages.view")), db: Session = Depends(get_db)):
    t = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not t: raise HTTPException(404, "Ticket not found")
    if not user.can("tickets.view_all") and t.assigned_to != user.id:
        raise HTTPException(403, "Access denied")
    return [ser_message(m) for m in db.query(Message).filter(Message.ticket_id == ticket_id).order_by(Message.timestamp).all()]

@app.post("/api/tickets/{ticket_id}/messages")
def post_message(ticket_id: str, payload: MessageCreate, user: User = Depends(require_perm("messages.send")), db: Session = Depends(get_db)):
    t = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not t: raise HTTPException(404, "Ticket not found")
    if not user.can("tickets.view_all") and t.assigned_to != user.id:
        raise HTTPException(403, "Access denied")
    m = Message(id=str(uuid.uuid4()), ticket_id=ticket_id, user_id=user.id,
                user_name=user.name, role=user.role_obj.name if user.role_obj else "",
                content=payload.content, type=payload.type,
                timestamp=datetime.utcnow(), attachments=[])
    t.updated_at = datetime.utcnow()
    db.add(m)
    db.commit()
    db.refresh(m)
    return ser_message(m)

# ══════════════════════════════════════════════════════════════════════════════
# SIGNOFFS
# ══════════════════════════════════════════════════════════════════════════════
@app.post("/api/tickets/{ticket_id}/signoff")
async def upload_signoff(ticket_id: str, file: UploadFile = File(...),
                          description: str = Form(""),
                          user: User = Depends(require_perm("signoffs.upload")),
                          db: Session = Depends(get_db)):
    t = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not t: raise HTTPException(404, "Ticket not found")
    if not user.can("tickets.view_all") and t.assigned_to != user.id:
        raise HTTPException(403, "Access denied")
    fid = str(uuid.uuid4())
    ext = os.path.splitext(file.filename)[1]
    path = f"uploads/{fid}{ext}"
    with open(path, "wb") as f_out: shutil.copyfileobj(file.file, f_out)
    s = Signoff(id=fid, ticket_id=ticket_id, filename=file.filename,
                path=f"/uploads/{fid}{ext}", description=description,
                uploaded_by=user.name, uploaded_by_id=user.id,
                role=user.role_obj.name if user.role_obj else "",
                size=os.path.getsize(path), timestamp=datetime.utcnow())
    db.add(s)
    m = Message(id=str(uuid.uuid4()), ticket_id=ticket_id, user_id=user.id,
                user_name=user.name, role=user.role_obj.name if user.role_obj else "",
                content=f"Uploaded signoff: {file.filename}", type="file",
                timestamp=datetime.utcnow(), attachments=[ser_signoff(s)])
    t.updated_at = datetime.utcnow()
    db.add(m)
    db.commit()
    db.refresh(s)
    return ser_signoff(s)

@app.get("/api/tickets/{ticket_id}/signoffs")
def get_signoffs(ticket_id: str, user: User = Depends(require_perm("messages.view")), db: Session = Depends(get_db)):
    t = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not t: raise HTTPException(404, "Ticket not found")
    if not user.can("tickets.view_all") and t.assigned_to != user.id:
        raise HTTPException(403, "Access denied")
    return [ser_signoff(s) for s in db.query(Signoff).filter(Signoff.ticket_id == ticket_id).all()]

# ══════════════════════════════════════════════════════════════════════════════
# DASHBOARD
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/dashboard/stats")
def get_stats(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(Ticket)
    if not user.can("dashboard.view_all"):
        q = q.filter(Ticket.assigned_to == user.id)
    tickets = q.all()
    return {
        "total": len(tickets),
        "open": sum(1 for t in tickets if t.status == "open"),
        "in_progress": sum(1 for t in tickets if t.status == "in_progress"),
        "completed": sum(1 for t in tickets if t.status == "completed"),
        "critical": sum(1 for t in tickets if t.priority == "critical"),
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
