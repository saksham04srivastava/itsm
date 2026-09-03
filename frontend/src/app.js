import { api } from "./api.js";
import { useAuth } from "./auth.js";
import { useConfirm } from "./confirm.js";
import { Badge, EnterpriseTable, Progress } from "./table.js";
import { BarChartCard, TrendChart } from "./charts.js";
import { h, useEffect, useMemo, useRef, useState } from "./react.js";

const ticketTypes = ["SOFTWARE_SUPPORT", "BUG", "ACCESS_REQUEST", "CONFIGURATION", "MAINTENANCE"];
const priorities = ["low", "medium", "high", "critical"];
const statuses = ["open", "in_progress", "completed"];
const colors = ["#155eef", "#12805c", "#b7791f", "#c2413d", "#0e7490", "#7c3aed", "#475569"];

function can(user, permission) {
  return (user?.permissions || []).includes(permission);
}

const UPLOAD_ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.bmp,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.ppt,.pptx,.zip";

function fmtSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageFile(file) {
  if (file.kind === "image") return true;
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.filename || "") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.path || "");
}

function Attachment({ file }) {
  const name = file.filename || "Attachment";
  // Served through the authenticated download route, never as a static file.
  const href = file.id ? `/api/files/${file.id}` : file.path;
  if (isImageFile(file)) {
    return h("a", { className: "attachment attachment-image", href, target: "_blank", rel: "noreferrer", title: name },
      h("img", { src: href, alt: name, loading: "lazy" })
    );
  }
  return h("a", { className: "attachment attachment-file", href, target: "_blank", rel: "noreferrer", download: name },
    h("span", { className: "attachment-icon" }, "FILE"),
    h("span", { className: "attachment-name" }, name),
    file.size ? h("span", { className: "attachment-size" }, fmtSize(file.size)) : null
  );
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
        h("span", { className: "login-quote-mark" }, "“"),
        h("p", { className: "login-quote-text" }, "Reliable support is not a stroke of luck. It is the result of clear ownership, disciplined follow-through, and a system everyone can trust."),
        h("div", { className: "login-quote-attribution" }, "Advantal Support Operations")
      )
    )
  );
}

function Sidebar({ page, setPage }) {
  const { user } = useAuth();
  const items = [
    { id: "dashboard", icon: "DB", label: "Dashboard" },
    { id: "tickets", icon: "TK", label: "Tickets" },
    ...(can(user, "companies.manage") ? [{ id: "customers", icon: "CU", label: "Customers" }] : []),
    ...(can(user, "products.manage") ? [{ id: "products", icon: "PR", label: "Products" }] : []),
    ...(can(user, "signoffs.view_all") || can(user, "signoffs.upload") ? [{ id: "signoffs", icon: "SO", label: "Signoffs" }] : []),
    ...(can(user, "users.view") ? [{ id: "users", icon: "US", label: "Users" }] : []),
    ...(can(user, "roles.view") ? [{ id: "roles", icon: "RL", label: "Roles" }] : []),
    ...(can(user, "email.manage") ? [{ id: "notifications", icon: "NT", label: "Notifications" }] : []),
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
    customers: "Customers",
    products: "Products",
    signoffs: "Signoffs",
    users: "User Management",
    roles: "Roles & Permissions",
    notifications: "Email Notifications",
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
    { header: "Customer", accessor: "company_name", cell: (t) => t.company_name || t.customer || "Not set" },
    { header: "Product", accessor: "product_name", cell: (t) => t.product_name || "Not set" },
    { header: "Type", accessor: "type", cell: (t) => h(Badge, { value: t.type, tone: "type" }) },
    { header: "Status", accessor: "status", cell: (t) => h(Badge, { value: t.status }) },
    { header: "Priority", accessor: "priority", cell: (t) => h(Badge, { value: t.priority }) },
    { header: "Progress", accessor: "progress", cell: (t) => h(Progress, { value: t.progress }) },
    { header: "Due Date", accessor: "due_date", exportValue: (t) => fmtDate(t.due_date), cell: (t) => fmtDate(t.due_date) },
    ...extra,
  ];
}

const TIME_RANGES = [
  { key: "7", label: "7 days", days: 7 },
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "all", label: "All time", days: null },
];

const STATUS_LABELS = { open: "Open", in_progress: "In Progress", completed: "Completed" };
const STATUS_COLORS = { open: "#2a78d6", in_progress: "#eda100", completed: "#008300" };
const PRIORITY_COLORS = { low: "#0ca30c", medium: "#fab219", high: "#ec835a", critical: "#d03b3b" };
const CHART_ACCENT = "#2a78d6";
const CHART_OTHER = "#94a3b8";

function topByKey(rows, getter, limit = 6) {
  const counts = new Map();
  rows.forEach((row) => {
    const key = getter(row) || "Not set";
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, limit).map(([key, value]) => ({ key, label: key, value, color: CHART_ACCENT }));
  const restTotal = sorted.slice(limit).reduce((sum, [, value]) => sum + value, 0);
  if (restTotal > 0) top.push({ key: "__other__", label: "Other", value: restTotal, color: CHART_OTHER, disabled: true });
  return top;
}

function buildTrend(rows, rangeKey) {
  const now = new Date();
  if (rangeKey === "7" || rangeKey === "30") {
    const days = rangeKey === "7" ? 7 : 30;
    const buckets = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      buckets.push({ key: d.toISOString().slice(0, 10), label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }), value: 0 });
    }
    const index = new Map(buckets.map((b, i) => [b.key, i]));
    rows.forEach((t) => {
      if (!t.created_at) return;
      const i = index.get(t.created_at.slice(0, 10));
      if (i != null) buckets[i].value++;
    });
    return buckets;
  }
  if (rangeKey === "90") {
    const weeks = 13;
    const buckets = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const end = new Date(now);
      end.setDate(end.getDate() - i * 7);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      buckets.push({ key: `w${i}`, start, end, label: start.toLocaleDateString(undefined, { month: "short", day: "numeric" }), value: 0 });
    }
    rows.forEach((t) => {
      if (!t.created_at) return;
      const d = new Date(t.created_at);
      const bucket = buckets.find((b) => d >= b.start && d <= b.end);
      if (bucket) bucket.value++;
    });
    return buckets;
  }
  const counts = new Map();
  rows.forEach((t) => {
    if (!t.created_at) return;
    const d = new Date(t.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => {
    const [y, m] = key.split("-");
    return { key, label: new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" }), value };
  });
}

function DashboardPage({ setPage, setSelectedTicket }) {
  const { token } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [timeRange, setTimeRange] = useState("30");
  const [drill, setDrill] = useState({ type: null, value: null });

  useEffect(() => {
    api.get("/tickets", token).then(setTickets).catch(() => {});
  }, [token]);

  const rangedTickets = useMemo(() => {
    const range = TIME_RANGES.find((r) => r.key === timeRange);
    if (!range || range.days == null) return tickets;
    const cutoff = Date.now() - range.days * 86400000;
    return tickets.filter((t) => t.created_at && new Date(t.created_at).getTime() >= cutoff);
  }, [tickets, timeRange]);

  const toggleDrill = (type, value) => {
    setDrill((current) => (current.type === type && current.value === value ? { type: null, value: null } : { type, value }));
  };

  const drillFiltered = useMemo(() => {
    if (!drill.type) return rangedTickets;
    return rangedTickets.filter((t) => {
      if (drill.type === "status") return t.status === drill.value;
      if (drill.type === "priority") return t.priority === drill.value;
      if (drill.type === "product") return (t.product_name || "Not set") === drill.value;
      if (drill.type === "customer") return (t.company_name || t.customer || "Not set") === drill.value;
      return true;
    });
  }, [rangedTickets, drill]);

  const recent = drillFiltered.slice(0, 20);

  const kpis = useMemo(() => ({
    total: rangedTickets.length,
    open: rangedTickets.filter((t) => t.status === "open").length,
    in_progress: rangedTickets.filter((t) => t.status === "in_progress").length,
    completed: rangedTickets.filter((t) => t.status === "completed").length,
    critical: rangedTickets.filter((t) => t.priority === "critical").length,
    overdue: rangedTickets.filter((t) => t.due_date && t.status !== "completed" && new Date(t.due_date) < new Date()).length,
  }), [rangedTickets]);

  const statusData = useMemo(() => statuses.map((s) => ({
    key: s,
    label: STATUS_LABELS[s],
    value: rangedTickets.filter((t) => t.status === s).length,
    color: STATUS_COLORS[s],
  })), [rangedTickets]);

  const priorityData = useMemo(() => priorities.map((p) => ({
    key: p,
    label: p.charAt(0).toUpperCase() + p.slice(1),
    value: rangedTickets.filter((t) => t.priority === p).length,
    color: PRIORITY_COLORS[p],
  })), [rangedTickets]);

  const productData = useMemo(() => topByKey(rangedTickets, (t) => t.product_name), [rangedTickets]);
  const customerData = useMemo(() => topByKey(rangedTickets, (t) => t.company_name || t.customer), [rangedTickets]);
  const trendData = useMemo(() => buildTrend(rangedTickets, timeRange), [rangedTickets, timeRange]);

  const drillLabel = drill.type && ({
    status: statusData.find((d) => d.key === drill.value)?.label,
    priority: priorityData.find((d) => d.key === drill.value)?.label,
    product: drill.value,
    customer: drill.value,
  })[drill.type];

  return h("div", null,
    h(PageHeader, { title: "Operational Dashboard", subtitle: "Live software-support workload, ownership, and resolution status." }),
    h("div", { className: "time-range-row" },
      h("span", { className: "time-range-label" }, "Time range"),
      h("div", { className: "time-range-group" },
        TIME_RANGES.map((r) => h("button", {
          key: r.key,
          className: `time-range-btn ${timeRange === r.key ? "active" : ""}`,
          onClick: () => setTimeRange(r.key),
        }, r.label))
      )
    ),
    h("div", { className: "stats-grid" },
      h(StatCard, { label: "Total Tickets", value: kpis.total, tone: "primary" }),
      h(StatCard, { label: "Open", value: kpis.open, tone: "info" }),
      h(StatCard, { label: "In Progress", value: kpis.in_progress, tone: "warning" }),
      h(StatCard, { label: "Completed", value: kpis.completed, tone: "success" }),
      h(StatCard, { label: "Critical", value: kpis.critical, tone: "danger" }),
      h(StatCard, { label: "Overdue", value: kpis.overdue, tone: "danger" })
    ),
    h("div", { className: "analytics-grid" },
      h("section", { className: "panel chart-panel chart-panel-wide" },
        h("div", { className: "panel-header" }, h("h2", { className: "panel-title" }, "Tickets Created"), h("span", { className: "small muted" }, "Click a point to inspect")),
        h("div", { className: "panel-body" }, h(TrendChart, { data: trendData }))
      ),
      h("section", { className: "panel chart-panel" },
        h("div", { className: "panel-header" }, h("h2", { className: "panel-title" }, "Status Breakdown"), h("span", { className: "small muted" }, "Click a bar to filter")),
        h("div", { className: "panel-body" }, h(BarChartCard, { data: statusData, selectedKey: drill.type === "status" ? drill.value : null, onSelect: (key) => toggleDrill("status", key) }))
      ),
      h("section", { className: "panel chart-panel" },
        h("div", { className: "panel-header" }, h("h2", { className: "panel-title" }, "Priority Breakdown"), h("span", { className: "small muted" }, "Click a bar to filter")),
        h("div", { className: "panel-body" }, h(BarChartCard, { data: priorityData, selectedKey: drill.type === "priority" ? drill.value : null, onSelect: (key) => toggleDrill("priority", key) }))
      ),
      h("section", { className: "panel chart-panel" },
        h("div", { className: "panel-header" }, h("h2", { className: "panel-title" }, "Tickets by Product"), h("span", { className: "small muted" }, "Top products")),
        h("div", { className: "panel-body" }, h(BarChartCard, { data: productData, selectedKey: drill.type === "product" ? drill.value : null, onSelect: (key) => toggleDrill("product", key) }))
      ),
      h("section", { className: "panel chart-panel" },
        h("div", { className: "panel-header" }, h("h2", { className: "panel-title" }, "Tickets by Customer"), h("span", { className: "small muted" }, "Top customers")),
        h("div", { className: "panel-body" }, h(BarChartCard, { data: customerData, selectedKey: drill.type === "customer" ? drill.value : null, onSelect: (key) => toggleDrill("customer", key) }))
      )
    ),
    drill.type && h("div", { className: "drill-banner" },
      h("span", null, "Filtered by ", h("strong", null, drillLabel)),
      h("button", { className: "btn btn-outline btn-sm", onClick: () => setDrill({ type: null, value: null }) }, "Clear filter")
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
      title: can(user, "tickets.view_all") ? "All Tickets" : "My Product Tickets",
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
        { key: "company_name", label: "All Customers", value: (r) => r.company_name || r.customer, options: uniqueOptions(tickets, (r) => r.company_name || r.customer) },
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
  const [customers, setCustomers] = useState([]);
  const initialCustomerName = user?.company_name || "";
  const [form, setForm] = useState({ title: "", description: "", customer: initialCustomerName, company_id: user?.company_id || "", product_id: "", priority: "medium", type: "SOFTWARE_SUPPORT", due_date: "", milestones: [] });
  const [milestone, setMilestone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get("/products", token).then(setProducts).catch(() => setError("Unable to load products for ticket routing."));
    if (can(user, "companies.manage")) api.get("/companies", token).then(setCustomers).catch(() => {});
  }, [token]);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const isSuperAdmin = can(user, "companies.manage");
  const activeProducts = products.filter((product) => product.active !== false);
  const visibleProducts = isSuperAdmin ? activeProducts : activeProducts.filter((product) => (user?.company_product_ids || []).includes(product.id));
  const chooseCustomer = (customerId) => {
    const customer = customers.find((item) => item.id === customerId);
    setForm((current) => ({ ...current, company_id: customerId, customer: customer?.name || "" }));
  };
  const chooseProduct = (productId) => {
    setForm((current) => ({
      ...current,
      product_id: productId,
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
    if (!form.company_id) {
      setError("Customer is required.");
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
      can(user, "companies.manage") && Field({ label: "Customer", children: h("select", { className: "select", value: form.company_id, onChange: (e) => chooseCustomer(e.target.value) },
        h("option", { value: "" }, "Select customer"),
        customers.filter((customer) => customer.active !== false).map((customer) => h("option", { key: customer.id, value: customer.id }, customer.name))
      ) }),
      Field({ label: "Product", children: h("select", { className: "select", value: form.product_id, onChange: (e) => chooseProduct(e.target.value) },
        h("option", { value: "" }, visibleProducts.length ? "Select product" : "No products available for this customer"),
        visibleProducts.map((product) => h("option", { key: product.id, value: product.id }, product.name))
      ) }),
      Field({ label: "Customer", children: h("input", { className: "input", value: form.customer, readOnly: true, placeholder: "Auto-filled from logged-in user" }) }),
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
  const [fileMode, setFileMode] = useState("attachment");
  const [chatError, setChatError] = useState("");
  const [sending, setSending] = useState(false);
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
  const isProductSpoc = (ticket.product_escalation_user_ids || []).includes(user.id);
  const canEditTicket = can(user, "tickets.edit_any") || (can(user, "tickets.edit_assigned") && (ticket.assigned_to === user.id || isProductSpoc));

  const patchTicket = async (payload, label) => {
    const ok = await confirm({ title: label, message: `Apply this update to ${ticket.id}?`, confirmText: "Apply Update" });
    if (!ok) return;
    await api.patch(`/tickets/${ticket.id}`, payload, token);
    load();
  };
  const send = async () => {
    if (!message.trim() && !file) return;
    if (!file && !can(user, "messages.send")) return;
    if (file && fileMode === "signoff" && !can(user, "signoffs.upload")) return;
    const isSignoff = file && fileMode === "signoff";
    const title = file ? (isSignoff ? "Upload Signoff" : "Send Attachment") : "Send Message";
    const ok = await confirm({ title, message: `Post this update on ${ticket.id}?`, confirmText: "Send" });
    if (!ok) return;
    setChatError("");
    setSending(true);
    try {
      if (file) {
        // The typed text rides along as the caption for the uploaded file.
        const fd = new FormData();
        fd.append("file", file);
        fd.append("description", message);
        await api.postForm(`/tickets/${ticket.id}/${isSignoff ? "signoff" : "attachment"}`, fd, token);
        setFile(null);
      } else {
        await api.post(`/tickets/${ticket.id}/messages`, { content: message, type: messageType }, token);
      }
      setMessage("");
      setMessageType("text");
      load();
    } catch (err) {
      setChatError(err.message || "Unable to send this update.");
    } finally {
      setSending(false);
    }
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
              h("div", { className: "info-item" }, h("label", null, "Customer"), h("span", null, ticket.company_name || "Not set")),
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
            h("div", { className: "message-bubble" },
              m.content && h("div", null, m.content),
              (m.attachments || []).map((a) => h(Attachment, { key: a.id || a.path, file: a }))
            )
          )),
          h("div", { ref: endRef })
        ),
        h("div", { className: "chat-composer" },
          chatError && h("div", { className: "error" }, chatError),
          file && h("div", { className: "composer-file" },
            h("span", null, `${fileMode === "signoff" ? "Signoff" : "Attachment"}: ${file.name} (${fmtSize(file.size)})`),
            h("button", { className: "btn btn-ghost btn-sm", onClick: () => setFile(null) }, "Remove")
          ),
          h("textarea", { className: "textarea", value: message, onChange: (e) => setMessage(e.target.value), placeholder: file ? "Add a caption (optional)..." : "Type an update..." }),
          h("div", { className: "composer-actions" },
            h("select", { className: "select", style: { width: 140 }, value: messageType, disabled: Boolean(file), onChange: (e) => setMessageType(e.target.value) },
              ["text", "update", "file"].map((t) => h("option", { key: t, value: t }, t))
            ),
            h("input", { id: "chat-file", type: "file", accept: UPLOAD_ACCEPT, style: { display: "none" },
              onChange: (e) => { setFile(e.target.files?.[0] || null); setFileMode("attachment"); e.target.value = ""; } }),
            can(user, "messages.send") && h("label", { className: "btn btn-outline", htmlFor: "chat-file" }, "Attach File"),
            h("input", { id: "signoff-file", type: "file", accept: UPLOAD_ACCEPT, style: { display: "none" },
              onChange: (e) => { setFile(e.target.files?.[0] || null); setFileMode("signoff"); e.target.value = ""; } }),
            can(user, "signoffs.upload") && h("label", { className: "btn btn-outline", htmlFor: "signoff-file" }, "Attach Signoff"),
            h("button", { className: "btn btn-primary", disabled: sending || (!can(user, "messages.send") && !file), onClick: send }, sending ? "Sending..." : "Send")
          )
        )
      )
    )
  );
}

function ProductsPage() {
  const { token } = useAuth();
  const [products, setProducts] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = () => api.get("/products", token).then(setProducts);

  useEffect(() => {
    load().catch(() => {});
  }, [token]);

  return h("div", null,
    h(PageHeader, {
      title: "Products",
      subtitle: "Manage product-level routing and escalation ownership used by every customer.",
      actions: h("button", { className: "btn btn-primary", onClick: () => setEditing({}) }, "New Product"),
    }),
    h(EnterpriseTable, {
      title: "Products",
      rows: products,
      columns: [
        { header: "Product", accessor: "name", cell: (p) => h("div", null, h("div", { style: { fontWeight: 800 } }, p.name), h("div", { className: "small muted mono" }, p.code || "No code")) },
        { header: "Escalation Matrix", accessor: "escalation_people", exportValue: (p) => (p.escalation_people || []).map((person) => person.name).join("; "), cell: (p) => {
          const people = p.escalation_people || [];
          return people.length ? people.map((person) => person.name).join(" -> ") : "Not configured";
        } },
        { header: "Status", accessor: "active", exportValue: (p) => p.active === false ? "Inactive" : "Active", cell: (p) => h(Badge, { value: p.active === false ? "Inactive" : "Active", tone: p.active === false ? "inactive" : "active" }) },
        { header: "Created", accessor: "created_at", exportValue: (p) => fmtDate(p.created_at), cell: (p) => fmtDate(p.created_at) },
        { header: "Actions", id: "actions", export: false, stopRowClick: true, cell: (p) => h("button", { className: "btn btn-outline btn-sm", onClick: () => setEditing(p) }, "Edit") },
      ],
      filters: [
        { key: "active", label: "All Statuses", value: (p) => p.active === false ? "Inactive" : "Active", options: [{ value: "Active", label: "Active" }, { value: "Inactive", label: "Inactive" }] },
      ],
      searchPlaceholder: "Search products and escalation people...",
    }),
    editing && h(ProductModal, { product: editing.id ? editing : null, onClose: () => setEditing(null), onSaved: () => { setEditing(null); load(); } })
  );
}

function ProductModal({ product, onClose, onSaved }) {
  const { token } = useAuth();
  const confirm = useConfirm();
  const isEdit = Boolean(product);
  const [assignable, setAssignable] = useState([]);
  const [form, setForm] = useState({
    name: product?.name || "",
    code: product?.code || "",
    escalation_user_ids: product?.escalation_user_ids || [],
    active: product?.active !== false,
  });
  const [error, setError] = useState("");
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    api.get("/users/assignable", token).then(setAssignable).catch(() => setAssignable([]));
  }, [token]);

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

  return h(Modal, {
    title: isEdit ? `Edit Product - ${product.name}` : "Create Product",
    onClose,
    footer: [h("button", { key: "cancel", className: "btn btn-outline", onClick: onClose }, "Cancel"), h("button", { key: "save", className: "btn btn-primary", onClick: submit }, isEdit ? "Save Changes" : "Create Product")],
  },
    error && h("div", { className: "error" }, error),
    h("div", { className: "form-grid" },
      Field({ label: "Product Name", children: h("input", { className: "input", value: form.name, onChange: (e) => set("name", e.target.value), placeholder: "e.g. CRM Portal" }) }),
      Field({ label: "Product Code", children: h("input", { className: "input", value: form.code, onChange: (e) => set("code", e.target.value), placeholder: "e.g. CRM" }) }),
      Field({ label: "Status", children: h("select", { className: "select", value: form.active ? "active" : "inactive", onChange: (e) => set("active", e.target.value === "active") }, h("option", { value: "active" }, "Active"), h("option", { value: "inactive" }, "Inactive")) })
    ),
    Field({ label: "Escalation Matrix", children: (() => {
      const selectedPeople = form.escalation_user_ids.map((id) => assignable.find((p) => p.id === id)).filter(Boolean);
      const remainingPeople = assignable.filter((p) => !form.escalation_user_ids.includes(p.id));
      return h("div", { className: "escalation-matrix" },
        h("div", { className: "small muted" }, "A ticket is first routed to L1. If unresolved, it escalates to L2, then L3, and so on."),
        h("div", { className: "escalation-chain" },
          selectedPeople.length ? selectedPeople.map((person, index) => h("div", { key: person.id, className: "escalation-row" },
            h("span", { className: "escalation-level" }, `L${index + 1}`),
            h("span", { className: "escalation-name" }, person.name),
            h("div", { className: "page-actions", style: { marginLeft: "auto" } },
              h("button", { className: "btn btn-outline btn-sm", type: "button", title: "Move up one level", disabled: index === 0, onClick: (e) => { e.preventDefault(); moveEscalation(person.id, -1); } }, "↑ Move Up"),
              h("button", { className: "btn btn-outline btn-sm", type: "button", title: "Move down one level", disabled: index === selectedPeople.length - 1, onClick: (e) => { e.preventDefault(); moveEscalation(person.id, 1); } }, "↓ Move Down"),
              h("button", { className: "btn btn-outline btn-sm", type: "button", title: "Remove from escalation chain", onClick: (e) => { e.preventDefault(); toggleEscalation(person.id); } }, "Remove")
            )
          )) : h("div", { className: "small muted" }, "No escalation levels configured yet. Add people below to build the chain.")
        ),
        remainingPeople.length > 0 && h("div", { className: "escalation-pool" },
          h("div", { className: "small muted", style: { marginBottom: "8px", fontWeight: 700 } }, "Add to escalation chain:"),
          h("div", { className: "escalation-pool-list" },
            remainingPeople.map((person) => h("button", { key: person.id, type: "button", className: "btn btn-outline btn-sm", onClick: (e) => { e.preventDefault(); toggleEscalation(person.id); } }, `+ ${person.name}`))
          )
        ),
        assignable.length === 0 && h("div", { className: "small muted" }, "No active SPOC users found.")
      );
    })() })
  );
}

function CustomersPage() {
  const { token } = useAuth();
  const confirm = useConfirm();
  const [customers, setCustomers] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = () => api.get("/companies", token).then(setCustomers);
  useEffect(() => { load().catch(() => {}); }, [token]);

  return h("div", null,
    h(PageHeader, {
      title: "Customers",
      subtitle: "Create and maintain customer records for tenant-isolated support data.",
      actions: h("button", { className: "btn btn-primary", onClick: () => setEditing({}) }, "New Customer"),
    }),
    h(EnterpriseTable, {
      title: "Customers",
      rows: customers,
      columns: [
        { header: "Customer", accessor: "name", cell: (c) => h("div", null, h("div", { style: { fontWeight: 800 } }, c.name), h("div", { className: "small muted mono" }, c.code)) },
        { header: "Status", accessor: "active", exportValue: (c) => c.active === false ? "Inactive" : "Active", cell: (c) => h(Badge, { value: c.active === false ? "Inactive" : "Active", tone: c.active === false ? "inactive" : "active" }) },
        { header: "Created", accessor: "created_at", exportValue: (c) => fmtDate(c.created_at), cell: (c) => fmtDate(c.created_at) },
        { header: "Actions", id: "actions", export: false, stopRowClick: true, cell: (c) => h("button", { className: "btn btn-outline btn-sm", onClick: () => setEditing(c) }, "Edit") },
      ],
      filters: [
        { key: "active", label: "All Statuses", value: (c) => c.active === false ? "Inactive" : "Active", options: [{ value: "Active", label: "Active" }, { value: "Inactive", label: "Inactive" }] },
      ],
      searchPlaceholder: "Search customers...",
    }),
    editing && h(CustomerModal, { customer: editing.id ? editing : null, onClose: () => setEditing(null), onSaved: () => { setEditing(null); load(); } })
  );
}

function CustomerModal({ customer, onClose, onSaved }) {
  const { token } = useAuth();
  const confirm = useConfirm();
  const isEdit = Boolean(customer);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({ name: customer?.name || "", code: customer?.code || "", product_ids: customer?.product_ids || [], active: customer?.active !== false });
  const [error, setError] = useState("");
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const toggleProduct = (productId) => {
    set("product_ids", form.product_ids.includes(productId)
      ? form.product_ids.filter((id) => id !== productId)
      : [...form.product_ids, productId]);
  };

  useEffect(() => {
    api.get("/products", token).then(setProducts).catch(() => setProducts([]));
  }, [token]);

  const submit = async () => {
    const ok = await confirm({ title: isEdit ? "Save Customer" : "Create Customer", message: `${isEdit ? "Save changes for" : "Create"} customer ${form.name || "Untitled"}?`, confirmText: isEdit ? "Save" : "Create" });
    if (!ok) return;
    setError("");
    try {
      if (isEdit) await api.patch(`/companies/${customer.id}`, form, token);
      else await api.post("/companies", form, token);
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };
  return h(Modal, {
    title: isEdit ? `Edit Customer - ${customer.name}` : "Create Customer",
    onClose,
    footer: [h("button", { key: "cancel", className: "btn btn-outline", onClick: onClose }, "Cancel"), h("button", { key: "save", className: "btn btn-primary", onClick: submit }, isEdit ? "Save Changes" : "Create Customer")],
  },
    error && h("div", { className: "error" }, error),
    h("div", { className: "form-grid" },
      Field({ label: "Customer Name", children: h("input", { className: "input", value: form.name, onChange: (e) => set("name", e.target.value), placeholder: "Customer name" }) }),
      Field({ label: "Customer Code", children: h("input", { className: "input", value: form.code, onChange: (e) => set("code", e.target.value), placeholder: "e.g. ACME" }) }),
      Field({ label: "Status", children: h("select", { className: "select", value: form.active ? "active" : "inactive", onChange: (e) => set("active", e.target.value === "active") }, h("option", { value: "active" }, "Active"), h("option", { value: "inactive" }, "Inactive")) })
    ),
    Field({ label: "Products", children: h("div", null,
      h("div", { className: "small muted", style: { marginBottom: "8px" } }, "Only the products checked here will be selectable when this customer creates a ticket."),
      h("div", { className: "permission-grid" },
        products.length ? products.map((product) => h("label", { key: product.id, className: "permission-item" },
          h("input", { type: "checkbox", checked: form.product_ids.includes(product.id), onChange: () => toggleProduct(product.id) }),
          h("span", null, product.name)
        )) : h("div", { className: "small muted" }, "No products available yet.")
      )
    ) })
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
  const [customers, setCustomers] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = () => api.get("/users", token).then(setUsers);
  useEffect(() => {
    load().catch(() => {});
    if (can(user, "companies.manage")) api.get("/companies", token).then(setCustomers).catch(() => {});
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
        { header: "Customer", accessor: "company_name", cell: (u) => u.company_name || "Global" },
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
        { key: "company_name", label: "All Customers", value: (r) => r.company_name || "Global", options: uniqueOptions(users, (r) => r.company_name || "Global") },
        { key: "role_name", label: "All Roles", value: (r) => r.role_name, options: uniqueOptions(users, (r) => r.role_name) },
        { key: "active", label: "All Statuses", value: (r) => r.active === false ? "Inactive" : "Active", options: [{ value: "Active", label: "Active" }, { value: "Inactive", label: "Inactive" }] },
      ],
      searchPlaceholder: "Search users...",
    }),
    editing && h(UserModal, { user: editing.id ? editing : null, customers, onClose: () => setEditing(null), onSaved: () => { setEditing(null); load(); if (can(user, "companies.manage")) api.get("/companies", token).then(setCustomers).catch(() => {}); } })
  );
}

function UserModal({ user, customers, onClose, onSaved }) {
  const { token, user: currentUser } = useAuth();
  const confirm = useConfirm();
  const [roles, setRoles] = useState([]);
  const isEdit = Boolean(user);
  const [customerMode, setCustomerMode] = useState("existing");
  const [newCustomer, setNewCustomer] = useState({ name: "", code: "" });
  const [form, setForm] = useState({ name: user?.name || "", email: user?.email || "", password: "", role_id: user?.role_id || "role_freelancer", company_id: user?.company_id || currentUser?.company_id || "", phone: user?.phone || "", skills: user?.skills || "", active: user?.active !== false });
  const [error, setError] = useState("");
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  useEffect(() => { api.get("/roles", token).then(setRoles).catch(() => {}); }, [token]);

  const submit = async () => {
    const ok = await confirm({ title: isEdit ? "Save User" : "Create User", message: `${isEdit ? "Save changes for" : "Create"} ${form.name || "this user"}?`, confirmText: isEdit ? "Save" : "Create" });
    if (!ok) return;
    setError("");
    try {
      let customerId = form.company_id;
      if (!isEdit && can(currentUser, "companies.manage") && customerMode === "new") {
        const created = await api.post("/companies", newCustomer, token);
        customerId = created.id;
      }
      if (isEdit) {
        const payload = { name: form.name, role_id: form.role_id, company_id: customerId, phone: form.phone, skills: form.skills, active: form.active };
        if (form.password) payload.password = form.password;
        await api.patch(`/users/${user.id}`, payload, token);
      } else {
        await api.post("/users", { ...form, company_id: customerId }, token);
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
      can(currentUser, "companies.manage") && Field({ label: "Customer Setup", children: h("select", { className: "select", value: customerMode, disabled: isEdit, onChange: (e) => setCustomerMode(e.target.value) },
        h("option", { value: "existing" }, "Existing customer"),
        h("option", { value: "new" }, "Create new customer")
      ) }),
      can(currentUser, "companies.manage") && customerMode === "existing" && Field({ label: "Customer", children: h("select", { className: "select", value: form.company_id || "", onChange: (e) => set("company_id", e.target.value) },
        h("option", { value: "" }, "Global / no customer"),
        customers.map((customer) => h("option", { key: customer.id, value: customer.id }, customer.name))
      ) }),
      can(currentUser, "companies.manage") && !isEdit && customerMode === "new" && Field({ label: "Customer Name", children: h("input", { className: "input", value: newCustomer.name, onChange: (e) => setNewCustomer((current) => ({ ...current, name: e.target.value })), placeholder: "Customer name" }) }),
      can(currentUser, "companies.manage") && !isEdit && customerMode === "new" && Field({ label: "Customer Code", children: h("input", { className: "input", value: newCustomer.code, onChange: (e) => setNewCustomer((current) => ({ ...current, code: e.target.value })), placeholder: "e.g. ACME" }) }),
      !can(currentUser, "companies.manage") && Field({ label: "Customer", children: h("input", { className: "input", value: currentUser?.company_name || "Not assigned", readOnly: true }) }),
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

function NotificationsPage() {
  const { token, user } = useAuth();
  const confirm = useConfirm();
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [log, setLog] = useState([]);
  const [stats, setStats] = useState({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState(user?.email || "");

  const loadLog = () => Promise.all([
    api.get("/email/log?limit=200", token).then(setLog).catch(() => setLog([])),
    api.get("/email/stats", token).then(setStats).catch(() => setStats({})),
  ]);

  const load = () => api.get("/email/settings", token).then((data) => {
    setSettings(data);
    // password is never sent to the browser; null means "leave unchanged"
    setForm({
      host: data.host, port: data.port, security: data.security, verify_tls: data.verify_tls,
      username: data.username, password: null, from_email: data.from_email,
      from_name: data.from_name, reply_to: data.reply_to, portal_url: data.portal_url,
      timeout_seconds: data.timeout_seconds, max_attempts: data.max_attempts,
      events: { ...(data.events || {}) },
    });
  });

  useEffect(() => { load().catch((err) => setError(err.message)); loadLog(); }, [token]);

  if (!can(user, "email.manage")) {
    return h("div", null, h(PageHeader, { title: "Email Notifications", subtitle: "You do not have access to this page." }));
  }
  if (!settings || !form) return h("div", null, h(PageHeader, { title: "Email Notifications" }));

  const set = (key, value) => { setForm((c) => ({ ...c, [key]: value })); setNotice(""); };
  const toggleEvent = (key) => setForm((c) => ({ ...c, events: { ...c.events, [key]: !c.events[key] } }));

  const save = async (extra = {}) => {
    const ok = await confirm({ title: "Save Email Settings", message: "Apply these SMTP settings?", confirmText: "Save" });
    if (!ok) return;
    setError(""); setNotice(""); setSaving(true);
    try {
      const payload = { ...form, ...extra };
      if (payload.password === null) delete payload.password;
      const data = await api.patch("/email/settings", payload, token);
      setSettings(data);
      setForm((c) => ({ ...c, password: null, events: { ...(data.events || {}) } }));
      setNotice("Settings saved.");
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  const sendTest = async () => {
    const ok = await confirm({ title: "Send Test Email", message: `Send a test message to ${testTo}?`, confirmText: "Send Test" });
    if (!ok) return;
    setError(""); setNotice(""); setTesting(true);
    try {
      const res = await api.post("/email/test", { to: testTo }, token);
      setSettings(res.settings);
      setNotice(`${res.message}. Notifications can now be enabled.`);
      loadLog();
    } catch (err) { setError(err.message); } finally { setTesting(false); }
  };

  const setEnabled = async (value) => {
    const ok = await confirm({
      title: value ? "Enable Notifications" : "Pause Notifications",
      message: value ? "Start sending activity emails to customers and SPOCs?" : "Stop sending all activity emails?",
      confirmText: value ? "Enable" : "Pause", tone: value ? "primary" : "danger",
    });
    if (!ok) return;
    setError(""); setNotice("");
    try {
      const data = await api.patch("/email/settings", { enabled: value }, token);
      setSettings(data);
      setNotice(value ? "Notifications are now active." : "Notifications paused.");
    } catch (err) { setError(err.message); }
  };

  const retry = async (row) => {
    const ok = await confirm({ title: "Retry Email", message: `Queue another delivery attempt to ${row.to_email}?`, confirmText: "Retry" });
    if (!ok) return;
    try { await api.post(`/email/log/${row.id}/retry`, {}, token); loadLog(); }
    catch (err) { setError(err.message); }
  };

  // Banner reflects exactly why mail is or is not flowing.
  let banner = null;
  if (settings.password_unreadable) {
    banner = h("div", { className: "warn" }, "The stored SMTP password cannot be read, most likely because SECRET_KEY changed. Re-enter the password and send a new test email.");
  } else if (!settings.verified) {
    banner = h("div", { className: "warn" }, "Notifications are paused. Save your SMTP details, then send a test email to verify them before enabling.");
  } else if (settings.config_changed_since_verify) {
    banner = h("div", { className: "warn" }, "Connection settings have changed since the last successful test. Send another test email to re-verify.");
  } else if (settings.sending_active) {
    banner = h("div", { className: "success" }, `Verified ${fmtDate(settings.verified_at)} via ${settings.verified_email}. Notifications are active.`);
  } else {
    banner = h("div", { className: "success" }, `Verified ${fmtDate(settings.verified_at)}. Turn on "Send notifications" to start delivering email.`);
  }

  const field = (label, key, opts = {}) => Field({
    label,
    children: h("input", {
      className: "input", type: opts.type || "text",
      value: form[key] === null ? "" : form[key],
      placeholder: opts.placeholder || "",
      onChange: (e) => set(key, opts.type === "number" ? Number(e.target.value) : e.target.value),
    }),
  });

  return h("div", null,
    h(PageHeader, {
      title: "Email Notifications",
      subtitle: "Connect an SMTP server so ticket activity reaches customers and product SPOCs.",
      actions: h("div", { className: "page-actions" },
        h("button", { className: "btn btn-outline", disabled: testing, onClick: sendTest }, testing ? "Sending..." : "Send Test Email"),
        h("button", { className: "btn btn-primary", disabled: saving, onClick: () => save() }, saving ? "Saving..." : "Save Changes")
      ),
    }),

    error && h("div", { className: "error" }, error),
    notice && h("div", { className: "success" }, notice),
    settings.secret_key_weak && h("div", { className: "warn" }, "SECRET_KEY is still the shipped default, so the stored SMTP password is not meaningfully protected at rest. Set a strong SECRET_KEY before going live."),
    banner,

    h("div", { className: "stats-grid" },
      h(StatCard, { label: "Sent", value: stats.sent ?? 0, tone: "success" }),
      h(StatCard, { label: "Queued", value: stats.queued ?? 0, tone: "primary" }),
      h(StatCard, { label: "Retrying", value: stats.retrying ?? 0, tone: "warning" }),
      h(StatCard, { label: "Failed", value: stats.failed ?? 0, tone: "danger" })
    ),

    h("section", { className: "panel" },
      h("div", { className: "panel-header" }, h("h2", { className: "panel-title" }, "SMTP Server")),
      h("div", { className: "panel-body" },
        h("div", { className: "form-grid" },
          field("Host", "host", { placeholder: "smtp.yourbank.co.in" }),
          field("Port", "port", { type: "number" }),
          Field({ label: "Security", children: h("select", { className: "select", value: form.security, onChange: (e) => set("security", e.target.value) },
            h("option", { value: "starttls" }, "STARTTLS (recommended)"),
            h("option", { value: "ssl" }, "SSL / TLS"),
            h("option", { value: "none" }, "None (test servers only)")
          ) }),
          Field({ label: "Certificate", children: h("select", { className: "select", value: form.verify_tls ? "verify" : "skip", onChange: (e) => set("verify_tls", e.target.value === "verify") },
            h("option", { value: "verify" }, "Verify TLS certificate (recommended)"),
            h("option", { value: "skip" }, "Do not verify (private CA)")
          ) }),
          field("Username", "username"),
          Field({ label: "Password", children: h("div", { className: "composer-row" },
            h("input", {
              className: "input", type: "password",
              value: form.password === null ? "" : form.password,
              placeholder: settings.has_password ? "Unchanged" : "Not set",
              onChange: (e) => set("password", e.target.value),
            }),
            settings.has_password && h("button", { className: "btn btn-outline btn-sm", type: "button", onClick: () => set("password", "") }, "Clear")
          ) }),
          field("From Name", "from_name"),
          field("From Address", "from_email", { placeholder: "support@advantal.net" }),
          field("Reply-To", "reply_to", { placeholder: "Optional" }),
          field("Portal URL", "portal_url", { placeholder: "https://support.yourbank.co.in" }),
          field("Timeout (seconds)", "timeout_seconds", { type: "number" }),
          field("Retry Attempts", "max_attempts", { type: "number" })
        ),
        h("div", { className: "small muted" }, "The password is encrypted before it is stored and is never sent back to this screen.")
      )
    ),

    h("section", { className: "panel" },
      h("div", { className: "panel-header" }, h("h2", { className: "panel-title" }, "Notify On")),
      h("div", { className: "panel-body" },
        h("div", { className: "permission-item", style: { marginBottom: "12px" } },
          h("input", {
            type: "checkbox", checked: settings.enabled, disabled: !settings.verified,
            onChange: (e) => setEnabled(e.target.checked),
          }),
          h("span", null, h("strong", null, "Send notifications"))
        ),
        !settings.verified && h("div", { className: "small muted", style: { marginBottom: "12px" } },
          "Send a successful test email to unlock this switch."),
        h("div", { className: "permission-grid" },
          (settings.event_types || []).map((ev) => h("label", { key: ev.key, className: "permission-item" },
            h("input", { type: "checkbox", checked: Boolean(form.events[ev.key]), onChange: () => toggleEvent(ev.key) }),
            h("span", null, h("strong", null, ev.label), h("div", { className: "small muted" }, ev.description))
          ))
        ),
        h("div", { className: "small muted", style: { marginTop: "10px" } },
          "Every notification goes to all active users of the ticket's customer and to every SPOC on the product's escalation matrix. Files are named but never attached.")
      )
    ),

    h(EnterpriseTable, {
      title: "Delivery Log",
      rows: log,
      defaultPageSize: 20,
      emptyText: "No email has been queued yet.",
      searchPlaceholder: "Search recipients, tickets and subjects...",
      columns: [
        { header: "Queued", accessor: "created_at", exportValue: (r) => fmtDate(r.created_at), cell: (r) => fmtDate(r.created_at) },
        { header: "Event", accessor: "event_label", cell: (r) => h(Badge, { value: r.event_label, tone: "type" }) },
        { header: "Ticket", accessor: "ticket_id", cell: (r) => h("span", { className: "mono small" }, r.ticket_id || "-") },
        { header: "Recipient", accessor: "to_email", cell: (r) => h("div", null,
          h("div", { style: { fontWeight: 700 } }, r.to_name || r.to_email),
          h("div", { className: "small muted" }, r.to_email)) },
        { header: "Audience", accessor: "audience", cell: (r) => h(Badge, { value: r.audience }) },
        { header: "Subject", accessor: "subject", cell: (r) => h("span", { title: r.subject }, (r.subject || "").slice(0, 60) + ((r.subject || "").length > 60 ? "..." : "")) },
        { header: "Status", accessor: "status", cell: (r) => h(Badge, { value: r.status }) },
        { header: "Tries", accessor: "attempts", cell: (r) => h("span", { className: "mono" }, r.attempts) },
        { header: "Error", accessor: "last_error", cell: (r) => r.last_error
          ? h("span", { className: "small", title: r.last_error }, r.last_error.slice(0, 40) + (r.last_error.length > 40 ? "..." : ""))
          : h("span", { className: "small muted" }, "-") },
        { header: "Actions", id: "actions", export: false, stopRowClick: true, cell: (r) => (r.raw_status === "failed" || r.raw_status === "cancelled")
          ? h("button", { className: "btn btn-outline btn-sm", onClick: () => retry(r) }, "Retry")
          : null },
      ],
      filters: [
        { key: "status", label: "All Statuses", value: (r) => r.status, options: uniqueOptions(log, (r) => r.status) },
        { key: "event_label", label: "All Events", value: (r) => r.event_label, options: uniqueOptions(log, (r) => r.event_label) },
        { key: "audience", label: "All Audiences", value: (r) => r.audience, options: uniqueOptions(log, (r) => r.audience) },
      ],
    }),

    h("section", { className: "panel" },
      h("div", { className: "panel-header" }, h("h2", { className: "panel-title" }, "Send a Test Email")),
      h("div", { className: "panel-body" },
        h("div", { className: "composer-row" },
          h("input", { className: "input", value: testTo, placeholder: "you@example.com", onChange: (e) => setTestTo(e.target.value) }),
          h("button", { className: "btn btn-outline", disabled: testing, onClick: sendTest }, testing ? "Sending..." : "Send Test")
        ),
        h("div", { className: "small muted", style: { marginTop: "8px" } },
          "A successful test verifies the configuration and unlocks the notifications switch. Changing any connection setting afterwards requires re-verification.")
      )
    )
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
    page === "customers" && h(CustomersPage),
    page === "products" && h(ProductsPage),
    page === "signoffs" && h(SignoffsPage),
    page === "users" && h(UsersPage),
    page === "roles" && h(RolesPage),
    page === "notifications" && h(NotificationsPage)
  );
}
