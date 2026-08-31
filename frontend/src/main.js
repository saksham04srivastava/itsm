import { AuthProvider } from "./auth.js";
import { ConfirmProvider } from "./confirm.js";
import { App } from "./app.js";
import { h, ReactDOM } from "./react.js";

ReactDOM.createRoot(document.getElementById("root")).render(
  h(AuthProvider, null,
    h(ConfirmProvider, null,
      h(App)
    )
  )
);
