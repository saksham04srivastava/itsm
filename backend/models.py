from sqlalchemy import Column, String, Integer, Float, Boolean, Text, ForeignKey, DateTime, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

# ─── All available permissions in the system ─────────────────────────────────
ALL_PERMISSIONS = [
    # Companies
    "companies.manage",       # create and manage customer companies
    # Products
    "products.view",          # view customer products for ticket creation
    "products.manage",        # create and manage products and escalation matrix
    # Tickets
    "tickets.view_all",       # see every ticket (not just assigned)
    "tickets.create",         # create new tickets
    "tickets.edit_any",       # edit any ticket (status, priority, etc.)
    "tickets.edit_assigned",  # edit only own assigned tickets
    "tickets.delete",         # delete tickets
    "tickets.assign",         # assign/reassign tickets to users
    # Messages / Chat
    "messages.view",          # view chat on accessible tickets
    "messages.send",          # send messages
    # Signoffs
    "signoffs.upload",        # upload signoff documents
    "signoffs.view_all",      # view signoffs across all tickets
    # Users
    "users.view",             # view user list
    "users.create",           # create users
    "users.edit",             # edit users
    "users.delete",           # delete users
    # Roles
    "roles.view",             # view roles
    "roles.manage",           # create / edit / delete roles
    # Dashboard
    "dashboard.view_all",     # see global stats (vs only own)
]

PERMISSION_GROUPS = {
    "Companies": ["companies.manage"],
    "Products":  ["products.view","products.manage"],
    "Tickets":   ["tickets.view_all","tickets.create","tickets.edit_any","tickets.edit_assigned","tickets.delete","tickets.assign"],
    "Chat":      ["messages.view","messages.send"],
    "Signoffs":  ["signoffs.upload","signoffs.view_all"],
    "Users":     ["users.view","users.create","users.edit","users.delete"],
    "Roles":     ["roles.view","roles.manage"],
    "Dashboard": ["dashboard.view_all"],
}


class Company(Base):
    __tablename__ = "companies"

    id          = Column(String, primary_key=True)
    name        = Column(String, unique=True, nullable=False)
    code        = Column(String, unique=True, nullable=False)
    active      = Column(Boolean, default=True)
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    users       = relationship("User", back_populates="company")
    products    = relationship("Product", back_populates="company")
    tickets     = relationship("Ticket", back_populates="company")


class Role(Base):
    __tablename__ = "roles"

    id          = Column(String, primary_key=True)
    name        = Column(String, unique=True, nullable=False)
    description = Column(String, default="")
    color       = Column(String, default="#4f6ef7")   # hex colour for badge
    is_system   = Column(Boolean, default=False)      # system roles can't be deleted
    permissions = Column(JSON, default=list)          # list of permission strings
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    users       = relationship("User", back_populates="role_obj", foreign_keys="User.role_id")


class User(Base):
    __tablename__ = "users"

    id          = Column(String, primary_key=True)
    email       = Column(String, unique=True, nullable=False, index=True)
    name        = Column(String, nullable=False)
    role_id     = Column(String, ForeignKey("roles.id"), nullable=True)
    company_id  = Column(String, ForeignKey("companies.id"), nullable=True, index=True)
    phone       = Column(String, default="")
    skills      = Column(String, default="")
    avatar      = Column(String, default="")
    active      = Column(Boolean, default=True)
    hashed_password = Column(String, nullable=False)
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by  = Column(String, nullable=True)

    role_obj         = relationship("Role", back_populates="users", foreign_keys=[role_id])
    company          = relationship("Company", back_populates="users", foreign_keys=[company_id])
    tickets_assigned = relationship("Ticket", back_populates="assignee", foreign_keys="Ticket.assigned_to")
    messages         = relationship("Message", back_populates="author")

    @property
    def permissions(self):
        return self.role_obj.permissions if self.role_obj else []

    def can(self, perm: str) -> bool:
        return perm in self.permissions


class Product(Base):
    __tablename__ = "products"

    id                  = Column(String, primary_key=True)
    name                = Column(String, nullable=False)
    code                = Column(String, default="")
    company_id          = Column(String, ForeignKey("companies.id"), nullable=False, index=True)
    escalation_user_ids = Column(JSON, default=list)
    active              = Column(Boolean, default=True)
    created_at          = Column(DateTime, default=datetime.utcnow)
    updated_at          = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    company = relationship("Company", back_populates="products", foreign_keys=[company_id])
    tickets = relationship("Ticket", back_populates="product")


class Ticket(Base):
    __tablename__ = "tickets"

    id          = Column(String, primary_key=True)
    title       = Column(String, nullable=False)
    description = Column(Text, default="")
    customer    = Column(String, default="")
    company_id  = Column(String, ForeignKey("companies.id"), nullable=True, index=True)
    product_id  = Column(String, ForeignKey("products.id"), nullable=True, index=True)
    assigned_to = Column(String, ForeignKey("users.id"), nullable=True)
    status      = Column(String, default="open")
    priority    = Column(String, default="medium")
    type        = Column(String, default="SOFTWARE_SUPPORT")
    budget      = Column(Float, default=0)
    progress    = Column(Integer, default=0)
    due_date    = Column(String, default="")
    milestones  = Column(JSON, default=list)
    created_by  = Column(String, ForeignKey("users.id"), nullable=True)
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    assignee    = relationship("User", back_populates="tickets_assigned", foreign_keys=[assigned_to])
    company     = relationship("Company", back_populates="tickets", foreign_keys=[company_id])
    product     = relationship("Product", back_populates="tickets", foreign_keys=[product_id])
    messages    = relationship("Message", back_populates="ticket", cascade="all, delete-orphan")
    signoffs    = relationship("Signoff", back_populates="ticket", cascade="all, delete-orphan")


class Message(Base):
    __tablename__ = "messages"

    id          = Column(String, primary_key=True)
    ticket_id   = Column(String, ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False)
    user_id     = Column(String, ForeignKey("users.id"), nullable=False)
    user_name   = Column(String, default="")
    role        = Column(String, default="")
    content     = Column(Text, default="")
    type        = Column(String, default="text")
    timestamp   = Column(DateTime, default=datetime.utcnow)
    attachments = Column(JSON, default=list)

    ticket      = relationship("Ticket", back_populates="messages")
    author      = relationship("User", back_populates="messages")


class Signoff(Base):
    __tablename__ = "signoffs"

    id              = Column(String, primary_key=True)
    ticket_id       = Column(String, ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False)
    filename        = Column(String, default="")
    path            = Column(String, default="")
    description     = Column(Text, default="")
    uploaded_by     = Column(String, default="")
    uploaded_by_id  = Column(String, default="")
    role            = Column(String, default="")
    size            = Column(Integer, default=0)
    timestamp       = Column(DateTime, default=datetime.utcnow)

    ticket          = relationship("Ticket", back_populates="signoffs")
