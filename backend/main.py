from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Form, Query
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
from models import Company, Product, Role, User, Ticket, Message, Signoff, ALL_PERMISSIONS, PERMISSION_GROUPS
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
        user = db.query(User).options(joinedload(User.role_obj), joinedload(User.company)).filter(User.email == email).first()
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

def is_super_admin(user: User) -> bool:
    return user.can("companies.manage")

def scoped_users_query(db: Session, user: User):
    q = db.query(User).options(joinedload(User.role_obj), joinedload(User.company))
    if not is_super_admin(user):
        q = q.filter(User.company_id == user.company_id)
    return q

def scoped_tickets_query(db: Session, user: User):
    q = db.query(Ticket).options(joinedload(Ticket.company), joinedload(Ticket.product))
    if not is_super_admin(user):
        q = q.filter(Ticket.company_id == user.company_id)
    if not user.can("tickets.view_all"):
        q = q.filter(Ticket.assigned_to == user.id)
    return q

def scoped_products_query(db: Session, user: User, active_only: bool = False):
    q = db.query(Product).options(joinedload(Product.company))
    if not is_super_admin(user):
        q = q.filter(Product.company_id == user.company_id)
    if active_only:
        q = q.filter(Product.active == True)
    return q

def can_access_ticket(user: User, ticket: Ticket) -> bool:
    if is_super_admin(user):
        return True
    if ticket.company_id != user.company_id:
        return False
    return user.can("tickets.view_all") or ticket.assigned_to == user.id

def require_ticket_access(ticket: Ticket, user: User):
    if not can_access_ticket(user, ticket):
        raise HTTPException(403, "Access denied")

def role_is_customer_limited(role: Role) -> bool:
    perms = set(role.permissions or [])
    return "companies.manage" not in perms

def validate_escalation_users(db: Session, company_id: str, user_ids: List[str]) -> List[str]:
    ordered_ids = list(dict.fromkeys([uid for uid in user_ids if uid]))
    if not ordered_ids:
        raise HTTPException(400, "At least one escalation person is required")
    users = db.query(User).options(joinedload(User.role_obj)).filter(User.id.in_(ordered_ids)).all()
    by_id = {u.id: u for u in users}
    missing = [uid for uid in ordered_ids if uid not in by_id]
    if missing:
        raise HTTPException(400, f"Invalid escalation user(s): {', '.join(missing)}")
    for uid in ordered_ids:
        escalation_user = by_id[uid]
        if not escalation_user.active:
            raise HTTPException(400, f"{escalation_user.name} is inactive")
        if escalation_user.company_id != company_id:
            raise HTTPException(400, "Escalation people must belong to the selected company")
        if "tickets.edit_assigned" not in (escalation_user.permissions or []):
            raise HTTPException(400, f"{escalation_user.name} cannot own assigned tickets")
    return ordered_ids

def resolve_product_assignee(db: Session, product: Product) -> str:
    for user_id in product.escalation_user_ids or []:
        escalation_user = db.query(User).options(joinedload(User.role_obj)).filter(User.id == user_id, User.active == True).first()
        if (escalation_user and escalation_user.company_id == product.company_id
                and "tickets.edit_assigned" in (escalation_user.permissions or [])):
            return escalation_user.id
    raise HTTPException(400, "Selected product has no active escalation owner")

def ticket_code(value: str, fallback: str) -> str:
    raw = (value or fallback or "NA").upper()
    cleaned = "".join(ch if ch.isalnum() else "_" for ch in raw).strip("_")
    return cleaned or "NA"

def next_ticket_id(db: Session, company: Company, product: Product, created_at: datetime) -> str:
    company_code = ticket_code(company.code, company.name)
    product_code = ticket_code(product.code, product.name)
    date_code = created_at.strftime("%Y%m%d")
    prefix = f"T-{company_code}-{product_code}-{date_code}"
    existing = db.query(Ticket.id).filter(Ticket.id.like(f"{prefix}-%")).all()
    max_no = 0
    for (ticket_id,) in existing:
        try:
            max_no = max(max_no, int(str(ticket_id).rsplit("-", 1)[-1]))
        except ValueError:
            continue
    return f"{prefix}-{str(max_no + 1).zfill(3)}"

# ─── Serialisers ─────────────────────────────────────────────────────────────
def ser_company(c: Company) -> dict:
    return {
        "id": c.id, "name": c.name, "code": c.code,
        "active": True if c.active is None else c.active,
        "created_at": c.created_at.isoformat() if c.created_at else "",
        "updated_at": c.updated_at.isoformat() if c.updated_at else "",
    }

def ser_role(r: Role, viewer: Optional[User] = None) -> dict:
    users = r.users or []
    if viewer and not is_super_admin(viewer):
        users = [u for u in users if u.company_id == viewer.company_id]
    return {
        "id": r.id, "name": r.name, "description": r.description or "",
        "color": r.color or "#4f6ef7", "is_system": r.is_system,
        "permissions": r.permissions or [],
        "user_count": len(users),
        "created_at": r.created_at.isoformat() if r.created_at else "",
    }

def ser_user(u: User) -> dict:
    return {
        "id": u.id, "email": u.email, "name": u.name,
        "role_id": u.role_id, "role_name": u.role_obj.name if u.role_obj else "",
        "role_color": u.role_obj.color if u.role_obj else "#8b93b0",
        "company_id": u.company_id,
        "company_name": u.company.name if u.company else "",
        "permissions": u.permissions,
        "phone": u.phone or "", "skills": u.skills or "",
        "avatar": u.avatar or u.name[0].upper(),
        "active": True if u.active is None else u.active,
        "created_at": u.created_at.isoformat() if u.created_at else "",
        "updated_at": u.updated_at.isoformat() if u.updated_at else "",
    }

def ser_product(p: Product, db: Optional[Session] = None) -> dict:
    escalation_ids = p.escalation_user_ids or []
    people = []
    if db and escalation_ids:
        users = db.query(User).options(joinedload(User.role_obj)).filter(User.id.in_(escalation_ids)).all()
        by_id = {u.id: u for u in users}
        people = [ser_user(by_id[uid]) for uid in escalation_ids if uid in by_id]
    return {
        "id": p.id, "name": p.name, "code": p.code or "",
        "company_id": p.company_id,
        "company_name": p.company.name if p.company else "",
        "escalation_user_ids": escalation_ids,
        "escalation_people": people,
        "active": True if p.active is None else p.active,
        "created_at": p.created_at.isoformat() if p.created_at else "",
        "updated_at": p.updated_at.isoformat() if p.updated_at else "",
    }

def ser_ticket(t: Ticket) -> dict:
    return {
        "id": t.id, "title": t.title, "description": t.description,
        "customer": t.customer, "company_id": t.company_id,
        "company_name": t.company.name if t.company else t.customer,
        "product_id": t.product_id,
        "product_name": t.product.name if t.product else "",
        "assigned_to": t.assigned_to,
        "status": t.status, "priority": t.priority, "type": t.type,
        "progress": t.progress, "due_date": t.due_date,
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

class CompanyCreate(BaseModel):
    name: str
    code: Optional[str] = ""

class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    active: Optional[bool] = None

class ProductCreate(BaseModel):
    name: str
    code: Optional[str] = ""
    company_id: str
    escalation_user_ids: List[str] = []
    active: bool = True

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    company_id: Optional[str] = None
    escalation_user_ids: Optional[List[str]] = None
    active: Optional[bool] = None

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
    company_id: Optional[str] = None
    phone: Optional[str] = ""
    skills: Optional[str] = ""

class UserUpdateModel(BaseModel):
    name: Optional[str] = None
    role_id: Optional[str] = None
    company_id: Optional[str] = None
    phone: Optional[str] = None
    skills: Optional[str] = None
    password: Optional[str] = None
    active: Optional[bool] = None

class TicketCreate(BaseModel):
    title: str; description: str = ""; customer: str = ""
    product_id: str
    company_id: Optional[str] = None
    assigned_to: str = ""; priority: str = "medium"
    type: str = "SOFTWARE_SUPPORT"
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
    user = db.query(User).options(joinedload(User.role_obj), joinedload(User.company)).filter(User.email == req.email).first()
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
# COMPANIES
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/companies")
def get_companies(user: User = Depends(require_perm("companies.manage")), db: Session = Depends(get_db)):
    companies = db.query(Company).order_by(Company.name).all()
    return [ser_company(c) for c in companies]

@app.post("/api/companies")
def create_company(payload: CompanyCreate, user: User = Depends(require_perm("companies.manage")), db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Company name is required")
    code = (payload.code or name[:8]).strip().upper().replace(" ", "_")
    if db.query(Company).filter(Company.name == name).first():
        raise HTTPException(409, "Company name already exists")
    if db.query(Company).filter(Company.code == code).first():
        raise HTTPException(409, "Company code already exists")
    company = Company(id=f"co_{uuid.uuid4().hex[:8]}", name=name, code=code,
                      active=True, created_at=datetime.utcnow())
    db.add(company)
    db.commit()
    db.refresh(company)
    return ser_company(company)

@app.patch("/api/companies/{company_id}")
def update_company(company_id: str, payload: CompanyUpdate, user: User = Depends(require_perm("companies.manage")), db: Session = Depends(get_db)):
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(404, "Company not found")
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(400, "Company name is required")
        if db.query(Company).filter(Company.name == name, Company.id != company_id).first():
            raise HTTPException(409, "Company name already exists")
        company.name = name
    if payload.code is not None:
        code = payload.code.strip().upper().replace(" ", "_")
        if not code:
            raise HTTPException(400, "Company code is required")
        if db.query(Company).filter(Company.code == code, Company.id != company_id).first():
            raise HTTPException(409, "Company code already exists")
        company.code = code
    if payload.active is not None:
        company.active = payload.active
    company.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(company)
    return ser_company(company)

# ══════════════════════════════════════════════════════════════════════════════
# ROLES
# ══════════════════════════════════════════════════════════════════════════════
# PRODUCTS
@app.get("/api/products")
def get_products(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not user.can("products.view") and not user.can("products.manage"):
        raise HTTPException(403, "Permission required: products.view")
    products = scoped_products_query(db, user, active_only=not is_super_admin(user)).order_by(Product.name).all()
    return [ser_product(p, db) for p in products]

@app.post("/api/products")
def create_product(payload: ProductCreate, user: User = Depends(require_perm("products.manage")), db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Product name is required")
    company = db.query(Company).filter(Company.id == payload.company_id, Company.active == True).first()
    if not company:
        raise HTTPException(400, "Valid company is required")
    code = (payload.code or name[:8]).strip().upper().replace(" ", "_")
    if db.query(Product).filter(Product.company_id == company.id, Product.name == name).first():
        raise HTTPException(409, "Product name already exists for this company")
    if code and db.query(Product).filter(Product.company_id == company.id, Product.code == code).first():
        raise HTTPException(409, "Product code already exists for this company")
    escalation_ids = validate_escalation_users(db, company.id, payload.escalation_user_ids)
    product = Product(id=f"prod_{uuid.uuid4().hex[:8]}", name=name, code=code,
                      company_id=company.id, escalation_user_ids=escalation_ids,
                      active=payload.active, created_at=datetime.utcnow(),
                      updated_at=datetime.utcnow())
    db.add(product)
    db.commit()
    db.refresh(product)
    saved = db.query(Product).options(joinedload(Product.company)).filter(Product.id == product.id).first()
    return ser_product(saved, db)

@app.patch("/api/products/{product_id}")
def update_product(product_id: str, payload: ProductUpdate, user: User = Depends(require_perm("products.manage")), db: Session = Depends(get_db)):
    product = db.query(Product).options(joinedload(Product.company)).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(404, "Product not found")
    company_id = payload.company_id if payload.company_id is not None else product.company_id
    company = db.query(Company).filter(Company.id == company_id, Company.active == True).first()
    if not company:
        raise HTTPException(400, "Valid company is required")
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(400, "Product name is required")
        if db.query(Product).filter(Product.company_id == company_id, Product.name == name, Product.id != product_id).first():
            raise HTTPException(409, "Product name already exists for this company")
        product.name = name
    if payload.code is not None:
        code = payload.code.strip().upper().replace(" ", "_")
        if code and db.query(Product).filter(Product.company_id == company_id, Product.code == code, Product.id != product_id).first():
            raise HTTPException(409, "Product code already exists for this company")
        product.code = code
    if payload.company_id is not None:
        product.company_id = company_id
    if payload.escalation_user_ids is not None:
        product.escalation_user_ids = validate_escalation_users(db, company_id, payload.escalation_user_ids)
    if payload.active is not None:
        product.active = payload.active
    product.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(product)
    saved = db.query(Product).options(joinedload(Product.company)).filter(Product.id == product.id).first()
    return ser_product(saved, db)

@app.get("/api/permissions")
def get_all_permissions(user: User = Depends(require_perm("roles.view"))):
    return {"permissions": ALL_PERMISSIONS, "groups": PERMISSION_GROUPS}

@app.get("/api/roles")
def get_roles(user: User = Depends(require_perm("roles.view")), db: Session = Depends(get_db)):
    roles = db.query(Role).options(joinedload(Role.users)).order_by(Role.created_at).all()
    return [ser_role(r, user) for r in roles]

@app.get("/api/roles/{role_id}")
def get_role(role_id: str, user: User = Depends(require_perm("roles.view")), db: Session = Depends(get_db)):
    r = db.query(Role).options(joinedload(Role.users)).filter(Role.id == role_id).first()
    if not r: raise HTTPException(404, "Role not found")
    return ser_role(r, user)

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
    return ser_role(r, user)

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
    return ser_role(r, user)

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
    users = scoped_users_query(db, user).order_by(User.created_at).all()
    return [ser_user(u) for u in users]

@app.get("/api/users/assignable")
def get_assignable(company_id: Optional[str] = Query(None), user: User = Depends(require_perm("tickets.assign")), db: Session = Depends(get_db)):
    """Users who can be assigned tickets (have tickets.edit_assigned permission)"""
    q = db.query(User).options(joinedload(User.role_obj), joinedload(User.company)).filter(User.active == True)
    if is_super_admin(user):
        if company_id:
            q = q.filter(User.company_id == company_id)
    else:
        q = q.filter(User.company_id == user.company_id)
    all_users = q.all()
    return [ser_user(u) for u in all_users if "tickets.edit_assigned" in (u.permissions or [])]

@app.get("/api/users/{user_id}")
def get_user(user_id: str, user: User = Depends(require_perm("users.view")), db: Session = Depends(get_db)):
    u = scoped_users_query(db, user).filter(User.id == user_id).first()
    if not u: raise HTTPException(404, "User not found")
    return ser_user(u)

@app.post("/api/users")
def create_user(payload: UserCreate, admin: User = Depends(require_perm("users.create")), db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(409, "Email already exists")
    role = db.query(Role).filter(Role.id == payload.role_id).first()
    if not role:
        raise HTTPException(400, "Invalid role_id")
    if len(payload.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    company_id = payload.company_id if is_super_admin(admin) else admin.company_id
    if role_is_customer_limited(role) and not company_id:
        raise HTTPException(400, "Company is required for this role")
    if company_id:
        company = db.query(Company).filter(Company.id == company_id, Company.active == True).first()
        if not company:
            raise HTTPException(400, "Invalid company_id")
    if not is_super_admin(admin) and payload.company_id and payload.company_id != admin.company_id:
        raise HTTPException(403, "Cannot create users for another company")
    if not is_super_admin(admin) and not role_is_customer_limited(role):
        raise HTTPException(403, "Cannot create Super Admin users")
    u = User(id=f"u{uuid.uuid4().hex[:8]}", email=payload.email, name=payload.name,
             role_id=payload.role_id, company_id=company_id, phone=payload.phone or "", skills=payload.skills or "",
             avatar=payload.name[0].upper(), active=True,
             hashed_password=hash_password(payload.password),
             created_by=admin.id, created_at=datetime.utcnow())
    db.add(u)
    db.commit()
    db.refresh(u)
    return ser_user(db.query(User).options(joinedload(User.role_obj)).filter(User.id == u.id).first())

@app.patch("/api/users/{user_id}")
def update_user(user_id: str, payload: UserUpdateModel, admin: User = Depends(require_perm("users.edit")), db: Session = Depends(get_db)):
    u = scoped_users_query(db, admin).filter(User.id == user_id).first()
    if not u: raise HTTPException(404, "User not found")
    if u.id == admin.id and payload.role_id and payload.role_id != admin.role_id:
        raise HTTPException(400, "Cannot change your own role")
    if payload.name is not None:
        u.name = payload.name; u.avatar = payload.name[0].upper()
    if payload.role_id is not None:
        role = db.query(Role).filter(Role.id == payload.role_id).first()
        if not role:
            raise HTTPException(400, "Invalid role_id")
        if not is_super_admin(admin) and not role_is_customer_limited(role):
            raise HTTPException(403, "Cannot assign Super Admin role")
        u.role_id = payload.role_id
    if payload.company_id is not None:
        if not is_super_admin(admin):
            raise HTTPException(403, "Cannot move users between companies")
        if u.id == admin.id:
            raise HTTPException(400, "Cannot change your own company")
        if payload.company_id:
            company = db.query(Company).filter(Company.id == payload.company_id, Company.active == True).first()
            if not company:
                raise HTTPException(400, "Invalid company_id")
        u.company_id = payload.company_id
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
    u = scoped_users_query(db, admin).filter(User.id == user_id).first()
    if not u: raise HTTPException(404, "User not found")
    db.delete(u)
    db.commit()
    return {"message": "User deleted"}

# ══════════════════════════════════════════════════════════════════════════════
# TICKETS
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/tickets")
def get_tickets(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = scoped_tickets_query(db, user)
    return [ser_ticket(t) for t in q.order_by(Ticket.created_at.desc()).all()]

@app.get("/api/tickets/{ticket_id}")
def get_ticket(ticket_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = db.query(Ticket).options(joinedload(Ticket.company), joinedload(Ticket.product)).filter(Ticket.id == ticket_id).first()
    if not t: raise HTTPException(404, "Ticket not found")
    require_ticket_access(t, user)
    return ser_ticket(t)

@app.post("/api/tickets")
def create_ticket(payload: TicketCreate, user: User = Depends(require_perm("tickets.create")), db: Session = Depends(get_db)):
    title = payload.title.strip()
    if not title:
        raise HTTPException(400, "Ticket title is required")
    product = db.query(Product).options(joinedload(Product.company)).filter(Product.id == payload.product_id, Product.active == True).first()
    if not product:
        raise HTTPException(400, "Valid product is required")
    if not is_super_admin(user) and product.company_id != user.company_id:
        raise HTTPException(403, "Cannot create tickets for another company")
    if payload.company_id and payload.company_id != product.company_id:
        raise HTTPException(400, "Selected company does not match product company")
    company = product.company
    if not company or not company.active:
        raise HTTPException(400, "Product company is inactive")
    assigned_to = resolve_product_assignee(db, product)
    created_at = datetime.utcnow()
    tid = next_ticket_id(db, company, product, created_at)
    t = Ticket(id=tid, title=title, description=payload.description,
               customer=company.name, company_id=product.company_id, product_id=product.id,
               assigned_to=assigned_to,
               priority=payload.priority, type=payload.type,
               due_date=payload.due_date, milestones=payload.milestones,
               status="open", progress=0, created_by=user.id,
               created_at=created_at, updated_at=created_at)
    db.add(t)
    db.commit()
    db.refresh(t)
    saved = db.query(Ticket).options(joinedload(Ticket.company), joinedload(Ticket.product)).filter(Ticket.id == t.id).first()
    return ser_ticket(saved)

@app.patch("/api/tickets/{ticket_id}")
def update_ticket(ticket_id: str, payload: TicketUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = db.query(Ticket).options(joinedload(Ticket.company), joinedload(Ticket.product)).filter(Ticket.id == ticket_id).first()
    if not t: raise HTTPException(404, "Ticket not found")
    if not is_super_admin(user) and t.company_id != user.company_id:
        raise HTTPException(403, "Access denied")
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
    if not is_super_admin(user) and t.company_id != user.company_id:
        raise HTTPException(403, "Access denied")
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
    require_ticket_access(t, user)
    return [ser_message(m) for m in db.query(Message).filter(Message.ticket_id == ticket_id).order_by(Message.timestamp).all()]

@app.post("/api/tickets/{ticket_id}/messages")
def post_message(ticket_id: str, payload: MessageCreate, user: User = Depends(require_perm("messages.send")), db: Session = Depends(get_db)):
    t = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not t: raise HTTPException(404, "Ticket not found")
    require_ticket_access(t, user)
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
    require_ticket_access(t, user)
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
    require_ticket_access(t, user)
    return [ser_signoff(s) for s in db.query(Signoff).filter(Signoff.ticket_id == ticket_id).all()]

# ══════════════════════════════════════════════════════════════════════════════
# DASHBOARD
# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/dashboard/stats")
def get_stats(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = scoped_tickets_query(db, user)
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
