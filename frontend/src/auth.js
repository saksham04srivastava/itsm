import { api } from "./api.js";
import { createContext, h, useContext, useEffect, useState } from "./react.js";

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem("token"));
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    api.get("/auth/me", token)
      .then(setUser)
      .catch(() => {
        localStorage.removeItem("token");
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const data = await api.post("/auth/login", { email, password });
    localStorage.setItem("token", data.access_token);
    setToken(data.access_token);
    setUser(data.user);
  };

  const logout = () => {
    // Clears the httpOnly download cookie server-side; the local session is
    // dropped regardless of whether that call succeeds.
    api.post("/auth/logout", {}, token).catch(() => {});
    localStorage.removeItem("token");
    setToken(null);
    setUser(null);
  };

  if (loading) {
    return h("div", { className: "page", style: { minHeight: "100vh", display: "grid", placeItems: "center" } }, "Loading portal...");
  }

  return h(AuthContext.Provider, { value: { token, user, login, logout } }, children);
}
