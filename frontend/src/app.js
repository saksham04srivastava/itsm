import { api } from "./api.js";
import { useAuth } from "./auth.js";
import { useConfirm } from "./confirm.js";
import { Badge, EnterpriseTable, Progress } from "./table.js";
import { h, useEffect, useMemo, useRef, useState } from "./react.js";

const ticketTypes = ["SOFTWARE_SUPPORT", "BUG", "ACCESS_REQUEST", "CONFIGURATION", "MAINTENANCE"];
const priorities = ["low", "medium", "high", "critical"];
const statuses = ["open", "in_progress", "completed"];
const colors = ["#155eef", "#12805c", "#b7791f", "#c2413d", "#0e7490", "#7c3aed", "#475569"];

function can(user, permission) {
  return (user?.permissions || []).includes(permission);
}

function fmtDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function uniqueOptions(rows, getter, fallback = "All") {
  return [...new Set(rows.map(getter).filter(Boolean))]
    .sort()
    .map((value) => ({ value, label: String(value).replace(/_/g, " ") || fallback }));
}

function PageHeader({ title, subtitle, actions }) {
  return h("div", { className: "page-header" },
    h("div", null,
      h("h1", { className: "page-title" }, title),
      subtitle && h("p", { className: "page-kicker" }, subtitle)
    ),
    actions && h("div", { className: "page-actions" }, actions)
  );
}

function StatCard({ label, value, tone = "primary" }) {
  return h("div", { className: "stat-card" },
    h("div", { className: "stat-label" }, label),
    h("div", { className: `stat-value ${tone}` }, value)
  );
}

function Modal({ title, children, footer, onClose, narrow = false }) {
  return h("div", { className: "modal-backdrop" },
    h("div", { className: `modal ${narrow ? "narrow" : ""}` },
      h("div", { className: "modal-header" },
        h("h2", { className: "modal-title" }, title),
        h("button", { className: "btn btn-ghost btn-icon", onClick: onClose, "aria-label": "Close" }, "X")
      ),
      h("div", { className: "modal-body" }, children),
      footer && h("div", { className: "modal-footer" }, footer)
    )
  );
}

function Field({ label, children }) {
  return h("label", { className: "form-field" },
    h("span", null, label),
    children
  );
}

function LoginPage() {
  const { login } = useAuth();
  const confirm = useConfirm();
  const [email, setEmail] = useState("admin@portal.com");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    const ok = await confirm({
      title: "Sign In",
      message: `Sign in to Advantal Support as ${email}?`,
      confirmText: "Sign In",
    });
    if (!ok) return;
    setError("");
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return h("div", { className: "login-page" },
    h("form", { className: "login-panel", onSubmit: submit },
      h("div", { className: "brand-lockup" },
        h("div", { className: "brand-mark" }, "AS"),
        h("div", null,
          h("div", { className: "brand-title" }, "Advantal Support"),
          h("div", { className: "brand-subtitle" }, "Enterprise service desk")
        )
      ),
      h("h1", { className: "login-title" }, "Secure support operations"),
      h("p", { className: "login-copy" }, "Manage software-support tickets, SPOC ownership, signoffs, users, and permissions from one controlled workspace."),
      error && h("div", { className: "error" }, error),
      Field({ label: "Email Address", children: h("input", { className: "input", type: "email", value: email, onChange: (e) => setEmail(e.target.value), required: true }) }),
      Field({ label: "Password", children: h("input", { className: "input", type: "password", value: password, onChange: (e) => setPassword(e.target.value), required: true }) }),
      h("button", { className: "btn btn-primary", type: "submit", disabled: loading }, loading ? "Signing in..." : "Sign In")
    ),
    h("div", { className: "login-visual" },
      h("div", { className: "login-visual-copy" },
        h("h2", { style: { margin: "0 0 10px", fontSize: 28 } }, "Software support without loose ends"),
        h("p", { style: { margin: 0, lineHeight: 1.7, color: "#d9e3f5" } }, "Every operational table includes search, filters, export controls, and paginated review. Every portal mutation asks for confirmation before it commits.")
      )
    )
  );
}

function Sidebar({ page, setPage }) {
  const { user } = useAuth();
  const items = [
    { id: "dashboard", icon: "DB", label: "Dashboard" },
    { id: "tickets", icon: "TK", label: "Tickets" },
    ...(can(user, "companies.manage") ? [{ id: "companies", icon: "CO", label: "Companies" }] : []),
    ...(can(user, "products.manage") ? [{ id: "products", icon: "PR", label: "Products" }] : []),
    ...(can(user, "signoffs.view_all") || can(user, "signoffs.upload") ? [{ id: "signoffs", icon: "SO", label: "Signoffs" }] : []),
    ...(can(user, "users.view") ? [{ id: "users", icon: "US", label: "Users" }] : []),
    ...(can(user, "roles.view") ? [{ id: "roles", icon: "RL", label: "Roles" }] : []),
  ];
  return h("aside", { className: "sidebar" },
    h("div", { className: "brand-lockup" },
      h("div", { className: "brand-mark" }, "AS"),
      h("div", null,
        h("div", { className: "brand-title" }, "Advantal Support"),
        h("div", { className: "brand-subtitle" }, "Software operations")
      )
    ),
    h("nav", { className: "nav" },
      h("div", { className: "nav-label" }, "Workspace"),
      items.map((item) => h("button", {
        key: item.id,
        className: `nav-item ${page === item.id ? "active" : ""}`,
        onClick: () => setPage(item.id),
      }, h("span", { className: "nav-icon" }, item.icon), item.label))
    ),
    h("div", { className: "sidebar-footer" },
      h("div", { className: "avatar dark" }, user?.avatar || user?.name?.[0] || "U"),
      h("div", { className: "user-lines" },
        h("div", { className: "user-name" }, user?.name),
        h("div", { className: "user-role" }, user?.role_name || user?.role)
      )
    )
  );
}

function Shell({ page, setPage, children }) {
  const { user, logout } = useAuth();
  const confirm = useConfirm();
  const titles = {
    dashboard: "Dashboard",
    tickets: "Tickets",
    "ticket-detail": "Ticket Detail",
    companies: "Companies",
    products: "Products",
    signoffs: "Signoffs",
    users: "User Management",
    roles: "Roles & Permissions",
  };
  const doLogout = async () => {
    const ok = await confirm({ title: "Sign Out", message: "Sign out of the portal?", confirmText: "Sign Out" });
    if (ok) logout();
  };
  return h("div", { className: "app-shell" },
    h(Sidebar, { page, setPage }),
    h("main", { className: "main" },
      h("div", { className: "topbar" },
        h("strong", null, titles[page] || "Portal"),
        h("div", { className: "page-actions" },
          h("span", { className: "badge badge-type" }, user?.role_name || "User"),
          h("button", { className: "btn btn-outline btn-sm", onClick: doLogout }, "Logout")
        )
      ),
      h("div", { className: "page" }, children)
    )
  );
}

function TicketTitleCell(ticket) {
  return h("div", null,
    h("div", { className: "truncate", style: { maxWidth: 320, fontWeight: 800 } }, ticket.title),
    h("div", { className: "small muted" }, ticket.customer || "No customer")
  );
}

function ticketColumns(extra = []) {
  return [
    { header: "Ticket ID", accessor: "id", cell: (t) => h("span", { className: "mono" }, t.id) },
    { header: "Title", accessor: "title", cell: TicketTitleCell },
    { header: "Company", accessor: "company_name", cell: (t) => t.company_name || t.customer || "Not set" },
    { header: "Product", accessor: "product_name", cell: (t) => t.product_name || "Not set" },
    { header: "Type", accessor: "type", cell: (t) => h(Badge, { value: t.type, tone: "type" }) },
    { header: "Status", accessor: "status", cell: (t) => h(Badge, { value: t.status }) },
    { header: "Priority", accessor: "priority", cell: (t) => h(Badge, { value: t.priority }) },
    { header: "Progress", accessor: "progress", cell: (t) => h(Progress, { value: t.progress }) },
    { header: "Due Date", accessor: "due_date", exportValue: (t) => fmtDate(t.due_date), cell: (t) => fmtDate(t.due_date) },
    ...extra,
  ];
}

function DashboardPage({ setPage, setSelectedTicket }) {
  const { token } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.get("/tickets", token).then(setTickets).catch(() => {});
    api.get("/dashboard/stats", token).then(setStats).catch(() => {});
  }, [token]);

  const recent = tickets.slice(0, 20);
  return h("div", null,
    h(PageHeader, { title: "Operational Dashboard", subtitle: "Live software-support workload, ownership, and resolution status." }),
    h("div", { className: "stats-grid" },
      h(StatCard, { label: "Total Tickets", value: stats?.total ?? tickets.length, tone: "primary" }),
      h(StatCard, { label: "Open", value: stats?.open ?? tickets.filter((t) => t.status === "open").length, tone: "info" }),
      h(StatCard, { label: "In Progress", value: stats?.in_progress ?? tickets.filter((t) => t.status === "in_progress").length, tone: "warning" }),
      h(StatCard, { label: "Completed", value: stats?.completed ?? tickets.filter((t) => t.status === "completed").length, tone: "success" }),
      h(StatCard, { label: "Critical", value: tickets.filter((t) => t.priority === "critical").length, tone: "danger" })
    ),
    h(EnterpriseTable, {
      title: "Recent Tickets",
      rows: recent,
      columns: ticketColumns(),
      searchPlaceholder: "Search recent tickets...",
      filters: [
        { key: "status", label: "All Statuses", value: (r) => r.status, options: uniqueOptions(recent, (r) => r.status) },
        { key: "priority", label: "All Priorities", value: (r) => r.priority, options: uniqueOptions(recent, (r) => r.priority) },
        { key: "product_name", label: "All Products", value: (r) => r.product_name, options: uniqueOptions(recent, (r) => r.product_name) },
      ],
      defaultPageSize: 5,
      onRowClick: (ticket) => { setSelectedTicket(ticket.id); setPage("ticket-detail"); },
    })
  );
}

function TicketsPage({ setPage, setSelectedTicket }) {
  const { token, user } = useAuth();
  const confirm = useConfirm();
  const [tickets, setTickets] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const load = () => api.get("/tickets", token).then(setTickets);

  useEffect(() => { load().catch(() => {}); }, [token]);

  const remove = async (ticket) => {
    const ok = await confirm({ title: "Delete Ticket", message: `Delete ${ticket.id} - ${ticket.title}?`, confirmText: "Delete", tone: "danger" });
    if (!ok) return;
    await api.delete(`/tickets/${ticket.id}`, token);
    load();
  };

  const actionColumn = can(user, "tickets.delete") ? [{
    header: "Actions",
    id: "actions",
    export: false,
    stopRowClick: true,
    cell: (ticket) => h("button", { className: "btn btn-danger btn-sm", onClick: () => remove(ticket) }, "Delete"),
  }] : [];

  return h("div", null,
    h(PageHeader, {
      title: can(user, "tickets.view_all") ? "All Tickets" : "My Tickets",
      subtitle: "Search, filter, export, and track software-support tickets.",
      actions: can(user, "tickets.create") ? h("button", { className: "btn btn-primary", onClick: () => setShowModal(true) }, "New Ticket") : null,
    }),
    h(EnterpriseTable, {
      title: "Tickets",
      rows: tickets,
      columns: ticketColumns(actionColumn),
      searchPlaceholder: "Search tickets, customers, status...",
      filters: [
        { key: "status", label: "All Statuses", value: (r) => r.status, options: uniqueOptions(tickets, (r) => r.status) },
        { key: "priority", label: "All Priorities", value: (r) => r.priority, options: uniqueOptions(tickets, (r) => r.priority) },
        { key: "type", label: "All Types", value: (r) => r.type, options: uniqueOptions(tickets, (r) => r.type) },
        { key: "company_name", label: "All Companies", value: (r) => r.company_name || r.customer, options: uniqueOptions(tickets, (r) => r.company_name || r.customer) },
        { key: "product_name", label: "All Products", value: (r) => r.product_name, options: uniqueOptions(tickets, (r) => r.product_name) },
      ],
      onRowClick: (ticket) => { setSelectedTicket(ticket.id); setPage("ticket-detail"); },
    }),
    showModal && h(TicketModal, { onClose: () => setShowModal(false), onSaved: () => { setShowModal(false); load(); } })
  );
}

function TicketModal({ onClose, onSaved }) {
  const { token, user } = useAuth();
  const confirm = useConfirm();
  const [products, setProducts] = useState([]);
  const initialCompanyName = user?.company_name || "";
  const [form, setForm] = useState({ title: "", description: "", customer: initialCompanyName, company_id: user?.company_id || "", product_id: "", priority: "medium", type: "SOFTWARE_SUPPORT", due_date: "", milestones: [] });
  const [milestone, setMilestone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get("/products", token).then(setProducts).catch(() => setError("Unable to load products for ticket routing."));
  }, [token]);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const activeProducts = products.filter((product) => product.active !== false);
  const chooseProduct = (productId) => {
    const product = products.find((item) => item.id === productId);
    setForm((current) => ({
      ...current,
      product_id: productId,
      company_id: product?.company_id || current.company_id,
      customer: product?.company_name || current.customer,
    }));
  };
  const addMilestone = () => {
    if (!milestone.trim()) return;
    set("milestones", [...form.milestones, { id: `m${Date.now()}`, title: milestone.trim(), done: false }]);
    setMilestone("");
  };
  const submit = async () => {
    if (!form.product_id) {
      setError("Select a product before creating the ticket.");
      return;
    }
    if (!form.title.trim()) {
      setError("Ticket title is required.");
      return;
    }
    const selectedProduct = products.find((product) => product.id === form.product_id);
    const ok = await confirm({ title: "Create Ticket", message: `Create ticket "${form.title}" for ${selectedProduct?.name || "selected product"}? It will be routed to the product escalation team.`, confirmText: "Create Ticket" });
    if (!ok) return;
    setError("");
    setLoading(true);
    try {
      const payload = { ...form, customer: undefined };
      await api.post("/tickets", payload, token);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return h(Modal, {
    title: "Create New Ticket",
    onClose,
    footer: [
      h("button", { key: "cancel", className: "btn btn-outline", onClick: onClose }, "Cancel"),
      h("button", { key: "save", className: "btn btn-primary", onClick: submit, disabled: loading }, loading ? "Creating..." : "Create Ticket"),
    ],
  },
    error && h("div", { className: "error" }, error),
    h("div", { className: "form-grid" },
      Field({ label: "Ticket Title", children: h("input", { className: "input", value: form.title, onChange: (e) => set("title", e.target.value), placeholder: "e.g. Login Issue - CRM Portal" }) }),
      Field({ label: "Product", children: h("select", { className: "select", value: form.product_id, onChange: (e) => chooseProduct(e.target.value) },
        h("option", { value: "" }, activeProducts.length ? "Select product" : "No active products available"),
        activeProducts.map((product) => h("option", { key: product.id, value: product.id }, can(user, "companies.manage") ? `${product.name} - ${product.company_name}` : product.name))
      ) }),
      Field({ label: "Customer", children: h("input", { className: "input", value: form.customer, readOnly: true, placeholder: "Auto-filled from selected product" }) }),
      Field({ label: "Priority", children: h("select", { className: "select", value: form.priority, onChange: (e) => set("priority", e.target.value) }, priorities.map((p) => h("option", { key: p, value: p }, p))) }),
      Field({ label: "Type", children: h("select", { className: "select", value: form.type, onChange: (e) => set("type", e.target.value) }, ticketTypes.map((t) => h("option", { key: t, value: t }, t.replace(/_/g, " ")))) }),
      Field({ label: "Due Date", children: h("input", { className: "input", type: "date", value: form.due_date, onChange: (e) => set("due_date", e.target.value) }) })
    ),
    Field({ label: "Description", children: h("textarea", { className: "textarea", value: form.description, onChange: (e) => set("description", e.target.value), placeholder: "Describe the support request..." }) }),
    Field({ label: "Milestones", children: h("div", null,
      form.milestones.length > 0 && h("div", { className: "milestone-list", style: { marginBottom: 10 } },
        form.milestones.map((m, index) => h("div", { key: m.id, className: "milestone-row" },
          h("span", { className: "check" }, ""),
          h("span", { style: { flex: 1 } }, m.title),
          h("button", { className: "btn btn-outline btn-sm", onClick: () => set("milestones", form.milestones.filter((_, i) => i !== index)) }, "Remove")
        ))
      ),
      h("div", { className: "composer-row" },
        h("input", { className: "input", value: milestone, onChange: (e) => setMilestone(e.target.value), placeholder: "Add milestone..." }),
        h("button", { className: "btn btn-outline", type: "button", onClick: addMilestone }, "Add")
      )
    ) })
  );
}

function TicketDetailPage({ ticketId, setPage }) {
  const { token, user } = useAuth();
  const confirm = useConfirm();
  const [ticket, setTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("text");
  const [file, setFile] = useState(null);
  const [progressDraft, setProgressDraft] = useState(0);
  const endRef = useRef(null);

  const load = () => {
    api.get(`/tickets/${ticketId}`, token).then((data) => { setTicket(data); setProgressDraft(data.progress || 0); });
    api.get(`/tickets/${ticketId}/messages`, token).then(setMessages);
  };
  useEffect(() => { if (ticketId) load(); }, [ticketId, token]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  if (!ticketId) return h("div", null, h(PageHeader, { title: "Ticket Detail" }), h("button", { className: "btn btn-outline", onClick: () => setPage("tickets") }, "Back to Tickets"));
  if (!ticket) return h("div", null, h(PageHeader, { title: "Loading Ticket" }));
  const canEditTicket = can(user, "tickets.edit_any") || (can(user, "tickets.edit_assigned") && ticket.assigned_to === user.id);

  const patchTicket = async (payload, label) => {
    const ok = await confirm({ title: label, message: `Apply this update to ${ticket.id}?`, confirmText: "Apply Update" });
    if (!ok) return;
    await api.patch(`/tickets/${ticket.id}`, payload, token);
    load();
  };
  const send = async () => {
    if (!message.trim() && !file) return;
    if (message.trim() && !can(user, "messages.send")) return;
    if (file && !can(user, "signoffs.upload")) return;
    const ok = await confirm({ title: file ? "Send Message and Upload Signoff" : "Send Message", message: `Post this ${messageType} update on ${ticket.id}?`, confirmText: "Send" });
    if (!ok) return;
    if (file) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("description", message);
      await api.postForm(`/tickets/${ticket.id}/signoff`, fd, token);
      setFile(null);
    }
    if (message.trim()) await api.post(`/tickets/${ticket.id}/messages`, { content: message, type: messageType }, token);
    setMessage("");
    setMessageType("text");
    load();
  };

  return h("div", null,
    h(PageHeader, {
      title: ticket.title,
      subtitle: `${ticket.id} - ${ticket.company_name || ticket.customer || "No customer"}`,
      actions: h("button", { className: "btn btn-outline", onClick: () => setPage("tickets") }, "Back to Tickets"),
    }),
    h("div", { className: "detail-grid" },
      h("div", { className: "detail-stack" },
        h("section", { className: "panel" },
          h("div", { className: "panel-header" },
            h("h2", { className: "panel-title" }, "Ticket Overview"),
            h("div", { className: "detail-meta" }, h(Badge, { value: ticket.status }), h(Badge, { value: ticket.priority }), h(Badge, { value: ticket.type, tone: "type" }))
          ),
          h("div", { className: "panel-body" },
            h("p", { style: { lineHeight: 1.7, color: "var(--muted)", marginTop: 0 } }, ticket.description || "No description provided."),
            h("div", { className: "info-grid" },
              h("div", { className: "info-item" }, h("label", null, "Company"), h("span", null, ticket.company_name || "Not set")),
              h("div", { className: "info-item" }, h("label", null, "Product"), h("span", null, ticket.product_name || "Not set")),
              h("div", { className: "info-item" }, h("label", null, "Customer"), h("span", null, ticket.customer || "Not set")),
              h("div", { className: "info-item" }, h("label", null, "Due Date"), h("span", null, fmtDate(ticket.due_date))),
              h("div", { className: "info-item" }, h("label", null, "Created"), h("span", null, fmtDate(ticket.created_at))),
              h("div", { className: "info-item" }, h("label", null, "Progress"), h(Progress, { value: ticket.progress }))
            )
          )
        ),
        h("section", { className: "panel" },
          h("div", { className: "panel-header" }, h("h2", { className: "panel-title" }, "Controlled Updates")),
          h("div", { className: "panel-body" },
            h("div", { className: "form-grid" },
              Field({ label: "Status", children: h("select", { className: "select", value: ticket.status, disabled: !canEditTicket, onChange: (e) => patchTicket({ status: e.target.value }, "Update Status") }, statuses.map((s) => h("option", { key: s, value: s }, s.replace(/_/g, " ")))) }),
              Field({ label: "Progress", children: h("div", { className: "composer-row" },
                h("input", { className: "input", type: "number", min: 0, max: 100, step: 5, value: progressDraft, disabled: !canEditTicket, onChange: (e) => setProgressDraft(e.target.value) }),
                h("button", { className: "btn btn-outline", disabled: !canEditTicket, onClick: () => patchTicket({ progress: Number(progressDraft) }, "Update Progress") }, "Update")
              ) })
            )
          )
        ),
        ticket.milestones?.length > 0 && h("section", { className: "panel" },
          h("div", { className: "panel-header" }, h("h2", { className: "panel-title" }, "Milestones")),
          h("div", { className: "panel-body" },
            h("div", { className: "milestone-list" },
              ticket.milestones.map((m) => h("button", {
                key: m.id,
                className: `milestone-row ${m.done ? "done" : ""}`,
                disabled: !canEditTicket,
                onClick: () => patchTicket({ milestone_id: m.id, milestone_done: !m.done }, "Update Milestone"),
              }, h("span", { className: "check" }, m.done ? "✓" : ""), h("span", null, m.title)))
            )
          )
        )
      ),
      h("section", { className: "panel chat-panel" },
        h("div", { className: "panel-header" }, h("h2", { className: "panel-title" }, "Conversation & Signoff")),
        h("div", { className: "messages" },
          messages.map((m) => h("div", { key: m.id, className: `message ${m.user_id === user.id ? "own" : ""}` },
            h("div", { className: "message-meta" }, `${m.user_name} - ${m.role || "User"} - ${fmtDate(m.timestamp)}`),
            h("div", { className: "message-bubble" }, m.content)
          )),
          h("div", { ref: endRef })
        ),
        h("div", { className: "chat-composer" },
          h("textarea", { className: "textarea", value: message, onChange: (e) => setMessage(e.target.value), placeholder: "Type an update..." }),
          h("div", { className: "composer-actions" },
            h("select", { className: "select", style: { width: 140 }, value: messageType, onChange: (e) => setMessageType(e.target.value) },
              ["text", "update", "file"].map((t) => h("option", { key: t, value: t }, t))
            ),
            h("input", { id: "signoff-file", type: "file", disabled: !can(user, "signoffs.upload"), style: { display: "none" }, onChange: (e) => setFile(e.target.files?.[0] || null) }),
            can(user, "signoffs.upload") && h("label", { className: "btn btn-outline", htmlFor: "signoff-file" }, file ? file.name : "Attach Signoff"),
            h("button", { className: "btn btn-primary", disabled: !can(user, "messages.send"), onClick: send }, "Send")
          )
        )
      )
    )
  );
}

function ProductsPage() {
  const { token } = useAuth();
  const [products, setProducts] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = () => api.get("/products", token).then(setProducts);

  useEffect(() => {
    load().catch(() => {});
    api.get("/companies", token).then(setCompanies).catch(() => {});
  }, [token]);

  return h("div", null,
    h(PageHeader, {
      title: "Products",
      subtitle: "Manage product-level routing and escalation ownership for each customer company.",
      actions: h("button", { className: "btn btn-primary", onClick: () => setEditing({}) }, "New Product"),
    }),
    h(EnterpriseTable, {
      title: "Products",
      rows: products,
      columns: [
        { header: "Product", accessor: "name", cell: (p) => h("div", null, h("div", { style: { fontWeight: 800 } }, p.name), h("div", { className: "small muted mono" }, p.code || "No code")) },
        { header: "Company", accessor: "company_name", cell: (p) => p.company_name || "Not set" },
        { header: "Escalation Matrix", accessor: "escalation_people", exportValue: (p) => (p.escalation_people || []).map((person) => person.name).join("; "), cell: (p) => {
          const people = p.escalation_people || [];
          return people.length ? people.map((person) => person.name).join(" -> ") : "Not configured";
        } },
        { header: "Status", accessor: "active", exportValue: (p) => p.active === false ? "Inactive" : "Active", cell: (p) => h(Badge, { value: p.active === false ? "Inactive" : "Active", tone: p.active === false ? "inactive" : "active" }) },
        { header: "Created", accessor: "created_at", exportValue: (p) => fmtDate(p.created_at), cell: (p) => fmtDate(p.created_at) },
        { header: "Actions", id: "actions", export: false, stopRowClick: true, cell: (p) => h("button", { className: "btn btn-outline btn-sm", onClick: () => setEditing(p) }, "Edit") },
      ],
      filters: [
        { key: "company_name", label: "All Companies", value: (p) => p.company_name, options: uniqueOptions(products, (p) => p.company_name) },
        { key: "active", label: "All Statuses", value: (p) => p.active === false ? "Inactive" : "Active", options: [{ value: "Active", label: "Active" }, { value: "Inactive", label: "Inactive" }] },
      ],
      searchPlaceholder: "Search products, companies, escalation people...",
    }),
    editing && h(ProductModal, { product: editing.id ? editing : null, companies, onClose: () => setEditing(null), onSaved: () => { setEditing(null); load(); } })
  );
}

function ProductModal({ product, companies, onClose, onSaved }) {
  const { token } = useAuth();
  const confirm = useConfirm();
  const isEdit = Boolean(product);
  const [assignable, setAssignable] = useState([]);
  const [form, setForm] = useState({
    name: product?.name || "",
    code: product?.code || "",
    company_id: product?.company_id || "",
    escalation_user_ids: product?.escalation_user_ids || [],
    active: product?.active !== false,
  });
  const [error, setError] = useState("");
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!form.company_id) {
      setAssignable([]);
      return;
    }
    api.get(`/users/assignable?company_id=${encodeURIComponent(form.company_id)}`, token).then(setAssignable).catch(() => setAssignable([]));
  }, [token, form.company_id]);

  const chooseCompany = (companyId) => {
    setForm((current) => ({ ...current, company_id: companyId, escalation_user_ids: [] }));
  };
  const toggleEscalation = (userId) => {
    set("escalation_user_ids", form.escalation_user_ids.includes(userId)
      ? form.escalation_user_ids.filter((id) => id !== userId)
      : [...form.escalation_user_ids, userId]);
  };
  const moveEscalation = (userId, direction) => {
    const index = form.escalation_user_ids.indexOf(userId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= form.escalation_user_ids.length) return;
    const next = [...form.escalation_user_ids];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    set("escalation_user_ids", next);
  };
  const submit = async () => {
    if (!form.company_id) {
      setError("Select a company for this product.");
      return;
    }
    if (!form.escalation_user_ids.length) {
      setError("Select at least one escalation person.");
      return;
    }
    const ok = await confirm({ title: isEdit ? "Save Product" : "Create Product", message: `${isEdit ? "Save changes for" : "Create"} product ${form.name || "Untitled"}?`, confirmText: isEdit ? "Save" : "Create" });
    if (!ok) return;
    setError("");
    try {
      if (isEdit) await api.patch(`/products/${product.id}`, form, token);
      else await api.post("/products", form, token);
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };

  const selectedCompany = companies.find((company) => company.id === form.company_id);
  return h(Modal, {
    title: isEdit ? `Edit Product - ${product.name}` : "Create Product",
    onClose,
    footer: [h("button", { key: "cancel", className: "btn btn-outline", onClick: onClose }, "Cancel"), h("button", { key: "save", className: "btn btn-primary", onClick: submit }, isEdit ? "Save Changes" : "Create Product")],
  },
    error && h("div", { className: "error" }, error),
    h("div", { className: "form-grid" },
      Field({ label: "Product Name", children: h("input", { className: "input", value: form.name, onChange: (e) => set("name", e.target.value), placeholder: "e.g. CRM Portal" }) }),
      Field({ label: "Product Code", children: h("input", { className: "input", value: form.code, onChange: (e) => set("code", e.target.value), placeholder: "e.g. CRM" }) }),
      Field({ label: "Customer Company", children: h("select", { className: "select", value: form.company_id, onChange: (e) => chooseCompany(e.target.value) },
        h("option", { value: "" }, "Select company"),
        companies.filter((company) => company.active !== false).map((company) => h("option", { key: company.id, value: company.id }, company.name))
      ) }),
      Field({ label: "Status", children: h("select", { className: "select", value: form.active ? "active" : "inactive", onChange: (e) => set("active", e.target.value === "active") }, h("option", { value: "active" }, "Active"), h("option", { value: "inactive" }, "Inactive")) })
    ),
    Field({ label: `Escalation Matrix${selectedCompany ? ` - ${selectedCompany.name}` : ""}`, children: h("div", { className: "permission-grid" },
      assignable.length ? assignable.map((person) => {
        const selected = form.escalation_user_ids.includes(person.id);
        return h("label", { key: person.id, className: "permission-item" },
          h("input", { type: "checkbox", checked: selected, onChange: () => toggleEscalation(person.id) }),
          h("span", null, person.name),
          selected && h("div", { className: "page-actions", style: { marginLeft: "auto" } },
            h("button", { className: "btn btn-outline btn-sm", type: "button", onClick: (e) => { e.preventDefault(); e.stopPropagation(); moveEscalation(person.id, -1); } }, "Up"),
            h("button", { className: "btn btn-outline btn-sm", type: "button", onClick: (e) => { e.preventDefault(); e.stopPropagation(); moveEscalation(person.id, 1); } }, "Down")
          )
        );
      }) : h("div", { className: "small muted" }, form.company_id ? "No active SPOC users found for this company." : "Select a company to load escalation people.")
    ) })
  );
}

function CompaniesPage() {
  const { token } = useAuth();
  const confirm = useConfirm();
  const [companies, setCompanies] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = () => api.get("/companies", token).then(setCompanies);
  useEffect(() => { load().catch(() => {}); }, [token]);

  return h("div", null,
    h(PageHeader, {
      title: "Companies",
      subtitle: "Create and maintain customer company records for tenant-isolated support data.",
      actions: h("button", { className: "btn btn-primary", onClick: () => setEditing({}) }, "New Company"),
    }),
    h(EnterpriseTable, {
      title: "Companies",
      rows: companies,
      columns: [
        { header: "Company", accessor: "name", cell: (c) => h("div", null, h("div", { style: { fontWeight: 800 } }, c.name), h("div", { className: "small muted mono" }, c.code)) },
        { header: "Status", accessor: "active", exportValue: (c) => c.active === false ? "Inactive" : "Active", cell: (c) => h(Badge, { value: c.active === false ? "Inactive" : "Active", tone: c.active === false ? "inactive" : "active" }) },
        { header: "Created", accessor: "created_at", exportValue: (c) => fmtDate(c.created_at), cell: (c) => fmtDate(c.created_at) },
        { header: "Actions", id: "actions", export: false, stopRowClick: true, cell: (c) => h("button", { className: "btn btn-outline btn-sm", onClick: () => setEditing(c) }, "Edit") },
      ],
      filters: [
        { key: "active", label: "All Statuses", value: (c) => c.active === false ? "Inactive" : "Active", options: [{ value: "Active", label: "Active" }, { value: "Inactive", label: "Inactive" }] },
      ],
      searchPlaceholder: "Search companies...",
    }),
    editing && h(CompanyModal, { company: editing.id ? editing : null, onClose: () => setEditing(null), onSaved: () => { setEditing(null); load(); } })
  );
}

function CompanyModal({ company, onClose, onSaved }) {
  const { token } = useAuth();
  const confirm = useConfirm();
  const isEdit = Boolean(company);
  const [form, setForm] = useState({ name: company?.name || "", code: company?.code || "", active: company?.active !== false });
  const [error, setError] = useState("");
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async () => {
    const ok = await confirm({ title: isEdit ? "Save Company" : "Create Company", message: `${isEdit ? "Save changes for" : "Create"} company ${form.name || "Untitled"}?`, confirmText: isEdit ? "Save" : "Create" });
    if (!ok) return;
    setError("");
    try {
      if (isEdit) await api.patch(`/companies/${company.id}`, form, token);
      else await api.post("/companies", form, token);
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };
  return h(Modal, {
    title: isEdit ? `Edit Company - ${company.name}` : "Create Company",
    onClose,
    footer: [h("button", { key: "cancel", className: "btn btn-outline", onClick: onClose }, "Cancel"), h("button", { key: "save", className: "btn btn-primary", onClick: submit }, isEdit ? "Save Changes" : "Create Company")],
  },
    error && h("div", { className: "error" }, error),
    h("div", { className: "form-grid" },
      Field({ label: "Company Name", children: h("input", { className: "input", value: form.name, onChange: (e) => set("name", e.target.value), placeholder: "Customer company name" }) }),
      Field({ label: "Company Code", children: h("input", { className: "input", value: form.code, onChange: (e) => set("code", e.target.value), placeholder: "e.g. ACME" }) }),
      Field({ label: "Status", children: h("select", { className: "select", value: form.active ? "active" : "inactive", onChange: (e) => set("active", e.target.value === "active") }, h("option", { value: "active" }, "Active"), h("option", { value: "inactive" }, "Inactive")) })
    )
  );
}

function SignoffsPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api.get("/tickets", token).then(async (tickets) => {
      const groups = await Promise.all(tickets.map((ticket) => api.get(`/tickets/${ticket.id}/signoffs`, token).then((items) => items.map((item) => ({ ...item, ticket_id: ticket.id, ticket_title: ticket.title }))).catch(() => [])));
      setRows(groups.flat());
    }).catch(() => {});
  }, [token]);

  return h("div", null,
    h(PageHeader, { title: "Signoffs", subtitle: "Review uploaded signoff files with searchable, exportable records." }),
    h(EnterpriseTable, {
      title: "Signoffs",
      rows,
      columns: [
        { header: "Ticket", accessor: "ticket_id", cell: (s) => h("div", null, h("span", { className: "mono" }, s.ticket_id), h("div", { className: "small muted" }, s.ticket_title)) },
        { header: "File", accessor: "filename" },
        { header: "Uploaded By", accessor: "uploaded_by" },
        { header: "Uploaded At", accessor: "uploaded_at", exportValue: (s) => fmtDate(s.uploaded_at), cell: (s) => fmtDate(s.uploaded_at) },
        { header: "Description", accessor: "description" },
      ],
      filters: [
        { key: "ticket_id", label: "All Tickets", value: (r) => r.ticket_id, options: uniqueOptions(rows, (r) => r.ticket_id) },
        { key: "uploaded_by", label: "All Uploaders", value: (r) => r.uploaded_by, options: uniqueOptions(rows, (r) => r.uploaded_by) },
      ],
      searchPlaceholder: "Search signoffs...",
    })
  );
}

function UsersPage() {
  const { token, user } = useAuth();
  const confirm = useConfirm();
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = () => api.get("/users", token).then(setUsers);
  useEffect(() => {
    load().catch(() => {});
    if (can(user, "companies.manage")) api.get("/companies", token).then(setCompanies).catch(() => {});
  }, [token, user]);

  const remove = async (target) => {
    const ok = await confirm({ title: "Delete User", message: `Delete user ${target.name}? Assigned tickets will remain without this assignee.`, confirmText: "Delete", tone: "danger" });
    if (!ok) return;
    await api.delete(`/users/${target.id}`, token);
    load();
  };

  return h("div", null,
    h(PageHeader, {
      title: "User Management",
      subtitle: "Manage user access, SPOC ownership, and active portal accounts.",
      actions: can(user, "users.create") ? h("button", { className: "btn btn-primary", onClick: () => setEditing({}) }, "Add User") : null,
    }),
    h(EnterpriseTable, {
      title: "Users",
      rows: users,
      columns: [
        { header: "User", accessor: "name", cell: (u) => h("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, h("div", { className: "avatar" }, u.avatar || u.name?.[0]), h("div", null, h("div", { style: { fontWeight: 800 } }, u.name), h("div", { className: "small muted" }, u.email))) },
        { header: "Company", accessor: "company_name", cell: (u) => u.company_name || "Global" },
        { header: "Role", accessor: "role_name", cell: (u) => h("span", { className: "badge badge-type" }, u.role_name || u.role) },
        { header: "Phone", accessor: "phone" },
        { header: "Skills", accessor: "skills" },
        { header: "Status", accessor: "active", exportValue: (u) => u.active === false ? "Inactive" : "Active", cell: (u) => h(Badge, { value: u.active === false ? "Inactive" : "Active", tone: u.active === false ? "inactive" : "active" }) },
        { header: "Created", accessor: "created_at", exportValue: (u) => fmtDate(u.created_at), cell: (u) => fmtDate(u.created_at) },
        { header: "Actions", id: "actions", export: false, stopRowClick: true, cell: (u) => h("div", { className: "page-actions" },
          h("button", { className: "btn btn-outline btn-sm", onClick: () => setEditing(u) }, "Edit"),
          u.id !== user.id && can(user, "users.delete") && h("button", { className: "btn btn-danger btn-sm", onClick: () => remove(u) }, "Delete")
        ) },
      ],
      filters: [
        { key: "company_name", label: "All Companies", value: (r) => r.company_name || "Global", options: uniqueOptions(users, (r) => r.company_name || "Global") },
        { key: "role_name", label: "All Roles", value: (r) => r.role_name, options: uniqueOptions(users, (r) => r.role_name) },
        { key: "active", label: "All Statuses", value: (r) => r.active === false ? "Inactive" : "Active", options: [{ value: "Active", label: "Active" }, { value: "Inactive", label: "Inactive" }] },
      ],
      searchPlaceholder: "Search users...",
    }),
    editing && h(UserModal, { user: editing.id ? editing : null, companies, onClose: () => setEditing(null), onSaved: () => { setEditing(null); load(); if (can(user, "companies.manage")) api.get("/companies", token).then(setCompanies).catch(() => {}); } })
  );
}

function UserModal({ user, companies, onClose, onSaved }) {
  const { token, user: currentUser } = useAuth();
  const confirm = useConfirm();
  const [roles, setRoles] = useState([]);
  const isEdit = Boolean(user);
  const [companyMode, setCompanyMode] = useState("existing");
  const [newCompany, setNewCompany] = useState({ name: "", code: "" });
  const [form, setForm] = useState({ name: user?.name || "", email: user?.email || "", password: "", role_id: user?.role_id || "role_freelancer", company_id: user?.company_id || currentUser?.company_id || "", phone: user?.phone || "", skills: user?.skills || "", active: user?.active !== false });
  const [error, setError] = useState("");
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  useEffect(() => { api.get("/roles", token).then(setRoles).catch(() => {}); }, [token]);

  const submit = async () => {
    const ok = await confirm({ title: isEdit ? "Save User" : "Create User", message: `${isEdit ? "Save changes for" : "Create"} ${form.name || "this user"}?`, confirmText: isEdit ? "Save" : "Create" });
    if (!ok) return;
    setError("");
    try {
      let companyId = form.company_id;
      if (!isEdit && can(currentUser, "companies.manage") && companyMode === "new") {
        const created = await api.post("/companies", newCompany, token);
        companyId = created.id;
      }
      if (isEdit) {
        const payload = { name: form.name, role_id: form.role_id, company_id: companyId, phone: form.phone, skills: form.skills, active: form.active };
        if (form.password) payload.password = form.password;
        await api.patch(`/users/${user.id}`, payload, token);
      } else {
        await api.post("/users", { ...form, company_id: companyId }, token);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };

  return h(Modal, {
    title: isEdit ? `Edit User - ${user.name}` : "Create New User",
    onClose,
    footer: [h("button", { key: "cancel", className: "btn btn-outline", onClick: onClose }, "Cancel"), h("button", { key: "save", className: "btn btn-primary", onClick: submit }, isEdit ? "Save Changes" : "Create User")],
  },
    error && h("div", { className: "error" }, error),
    h("div", { className: "form-grid" },
      Field({ label: "Full Name", children: h("input", { className: "input", value: form.name, onChange: (e) => set("name", e.target.value) }) }),
      Field({ label: "Email Address", children: h("input", { className: "input", type: "email", value: form.email, disabled: isEdit, onChange: (e) => set("email", e.target.value) }) }),
      Field({ label: isEdit ? "New Password" : "Password", children: h("input", { className: "input", type: "password", value: form.password, onChange: (e) => set("password", e.target.value) }) }),
      Field({ label: "Role", children: h("select", { className: "select", value: form.role_id, onChange: (e) => set("role_id", e.target.value) }, roles.map((r) => h("option", { key: r.id, value: r.id }, r.name))) }),
      can(currentUser, "companies.manage") && Field({ label: "Company Setup", children: h("select", { className: "select", value: companyMode, disabled: isEdit, onChange: (e) => setCompanyMode(e.target.value) },
        h("option", { value: "existing" }, "Existing company"),
        h("option", { value: "new" }, "Create new company")
      ) }),
      can(currentUser, "companies.manage") && companyMode === "existing" && Field({ label: "Company", children: h("select", { className: "select", value: form.company_id || "", onChange: (e) => set("company_id", e.target.value) },
        h("option", { value: "" }, "Global / no company"),
        companies.map((company) => h("option", { key: company.id, value: company.id }, company.name))
      ) }),
      can(currentUser, "companies.manage") && !isEdit && companyMode === "new" && Field({ label: "Company Name", children: h("input", { className: "input", value: newCompany.name, onChange: (e) => setNewCompany((current) => ({ ...current, name: e.target.value })), placeholder: "Customer company name" }) }),
      can(currentUser, "companies.manage") && !isEdit && companyMode === "new" && Field({ label: "Company Code", children: h("input", { className: "input", value: newCompany.code, onChange: (e) => setNewCompany((current) => ({ ...current, code: e.target.value })), placeholder: "e.g. ACME" }) }),
      !can(currentUser, "companies.manage") && Field({ label: "Company", children: h("input", { className: "input", value: currentUser?.company_name || "Not assigned", readOnly: true }) }),
      Field({ label: "Phone", children: h("input", { className: "input", value: form.phone, onChange: (e) => set("phone", e.target.value) }) }),
      Field({ label: "Status", children: h("select", { className: "select", value: form.active ? "active" : "inactive", onChange: (e) => set("active", e.target.value === "active") }, h("option", { value: "active" }, "Active"), h("option", { value: "inactive" }, "Inactive")) })
    ),
    Field({ label: "Skills / Specialization", children: h("input", { className: "input", value: form.skills, onChange: (e) => set("skills", e.target.value), placeholder: "e.g. CRM Support, API Troubleshooting, Database Queries" }) })
  );
}

function RolesPage() {
  const { token, user } = useAuth();
  const confirm = useConfirm();
  const [roles, setRoles] = useState([]);
  const [editing, setEditing] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [groups, setGroups] = useState({});
  const load = () => Promise.all([api.get("/roles", token).then(setRoles), api.get("/permissions", token).then((data) => { setPermissions(data.permissions || []); setGroups(data.groups || {}); })]);
  useEffect(() => { load().catch(() => {}); }, [token]);

  const remove = async (role) => {
    const ok = await confirm({ title: "Delete Role", message: `Delete role ${role.name}?`, confirmText: "Delete", tone: "danger" });
    if (!ok) return;
    await api.delete(`/roles/${role.id}`, token);
    load();
  };

  return h("div", null,
    h(PageHeader, {
      title: "Roles & Permissions",
      subtitle: "Review and manage permission groups using searchable role records.",
      actions: can(user, "roles.manage") ? h("button", { className: "btn btn-primary", onClick: () => setEditing({}) }, "New Role") : null,
    }),
    h(EnterpriseTable, {
      title: "Roles",
      rows: roles,
      columns: [
        { header: "Role", accessor: "name", cell: (r) => h("div", null, h("div", { style: { fontWeight: 800, color: r.color } }, r.name), h("div", { className: "small muted" }, r.description)) },
        { header: "Type", accessor: "is_system", exportValue: (r) => r.is_system ? "System" : "Custom", cell: (r) => h(Badge, { value: r.is_system ? "System" : "Custom", tone: "type" }) },
        { header: "Users", accessor: "user_count", cell: (r) => h("span", { className: "mono" }, r.user_count || 0) },
        { header: "Permissions", accessor: "permissions", exportValue: (r) => (r.permissions || []).join("; "), cell: (r) => `${(r.permissions || []).length} permission(s)` },
        { header: "Actions", id: "actions", export: false, stopRowClick: true, cell: (r) => h("div", { className: "page-actions" },
          can(user, "roles.manage") && h("button", { className: "btn btn-outline btn-sm", onClick: () => setEditing(r) }, "Edit"),
          can(user, "roles.manage") && !r.is_system && h("button", { className: "btn btn-danger btn-sm", disabled: r.user_count > 0, onClick: () => remove(r) }, "Delete")
        ) },
      ],
      filters: [
        { key: "is_system", label: "All Role Types", value: (r) => r.is_system ? "System" : "Custom", options: [{ value: "System", label: "System" }, { value: "Custom", label: "Custom" }] },
      ],
      searchPlaceholder: "Search roles...",
    }),
    editing && h(RoleModal, { role: editing.id ? editing : null, permissions, groups, onClose: () => setEditing(null), onSaved: () => { setEditing(null); load(); } })
  );
}

function RoleModal({ role, permissions, groups, onClose, onSaved }) {
  const { token } = useAuth();
  const confirm = useConfirm();
  const isEdit = Boolean(role);
  const systemLocked = isEdit && role.is_system;
  const [form, setForm] = useState({ name: role?.name || "", description: role?.description || "", color: role?.color || colors[0], permissions: role?.permissions || [] });
  const [error, setError] = useState("");
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const togglePermission = (permission) => {
    if (systemLocked) return;
    set("permissions", form.permissions.includes(permission) ? form.permissions.filter((p) => p !== permission) : [...form.permissions, permission]);
  };
  const submit = async () => {
    const ok = await confirm({ title: isEdit ? "Save Role" : "Create Role", message: `${isEdit ? "Save changes to" : "Create"} role ${form.name || "Untitled"}?`, confirmText: isEdit ? "Save" : "Create" });
    if (!ok) return;
    setError("");
    try {
      if (isEdit) await api.patch(`/roles/${role.id}`, form, token);
      else await api.post("/roles", form, token);
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };
  const grouped = useMemo(() => Object.entries(groups).length ? groups : { Permissions: permissions }, [groups, permissions]);

  return h(Modal, {
    title: isEdit ? `Edit Role - ${role.name}` : "Create New Role",
    onClose,
    footer: [h("button", { key: "cancel", className: "btn btn-outline", onClick: onClose }, "Cancel"), h("button", { key: "save", className: "btn btn-primary", onClick: submit }, isEdit ? "Save Changes" : "Create Role")],
  },
    error && h("div", { className: "error" }, error),
    h("div", { className: "form-grid" },
      Field({ label: "Role Name", children: h("input", { className: "input", value: form.name, disabled: systemLocked, onChange: (e) => set("name", e.target.value) }) }),
      Field({ label: "Color", children: h("div", { className: "color-row" }, colors.map((color) => h("button", { key: color, className: `color-swatch ${form.color === color ? "selected" : ""}`, style: { background: color }, disabled: systemLocked, onClick: () => set("color", color), "aria-label": color }))) })
    ),
    Field({ label: "Description", children: h("input", { className: "input", value: form.description, disabled: systemLocked, onChange: (e) => set("description", e.target.value) }) }),
    Object.entries(grouped).map(([group, perms]) => h("div", { key: group, style: { marginBottom: 16 } },
      h("div", { className: "stat-label", style: { marginBottom: 8 } }, group),
      h("div", { className: "permission-grid" },
        perms.map((permission) => h("label", { key: permission, className: "permission-item" },
          h("input", { type: "checkbox", checked: form.permissions.includes(permission), disabled: systemLocked, onChange: () => togglePermission(permission) }),
          h("span", null, permission)
        ))
      )
    ))
  );
}

export function App() {
  const { user } = useAuth();
  const [page, setPage] = useState("dashboard");
  const [selectedTicket, setSelectedTicket] = useState(null);

  if (!user) return h(LoginPage);

  return h(Shell, { page, setPage },
    page === "dashboard" && h(DashboardPage, { setPage, setSelectedTicket }),
    page === "tickets" && h(TicketsPage, { setPage, setSelectedTicket }),
    page === "ticket-detail" && h(TicketDetailPage, { ticketId: selectedTicket, setPage }),
    page === "companies" && h(CompaniesPage),
    page === "products" && h(ProductsPage),
    page === "signoffs" && h(SignoffsPage),
    page === "users" && h(UsersPage),
    page === "roles" && h(RolesPage)
  );
}
