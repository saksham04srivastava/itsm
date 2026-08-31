import { createContext, h, useCallback, useContext, useState } from "./react.js";

const ConfirmContext = createContext(null);

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null);

  const confirm = useCallback((options) => new Promise((resolve) => {
    setDialog({
      title: "Confirm Action",
      message: "Please confirm before continuing.",
      confirmText: "Confirm",
      cancelText: "Cancel",
      tone: "primary",
      ...options,
      resolve,
    });
  }), []);

  const close = (result) => {
    const active = dialog;
    setDialog(null);
    active?.resolve(result);
  };

  return h(ConfirmContext.Provider, { value: confirm },
    children,
    dialog && h("div", { className: "modal-backdrop", role: "presentation" },
      h("div", { className: "modal narrow", role: "dialog", "aria-modal": "true" },
        h("div", { className: "modal-header" },
          h("h2", { className: "modal-title" }, dialog.title),
          h("button", { className: "btn btn-ghost btn-icon", onClick: () => close(false), "aria-label": "Close" }, "X")
        ),
        h("div", { className: "modal-body" },
          h("p", { style: { margin: 0, color: "var(--muted)", lineHeight: 1.6 } }, dialog.message)
        ),
        h("div", { className: "modal-footer" },
          h("button", { className: "btn btn-outline", onClick: () => close(false) }, dialog.cancelText),
          h("button", {
            className: dialog.tone === "danger" ? "btn btn-danger" : "btn btn-primary",
            onClick: () => close(true),
          }, dialog.confirmText)
        )
      )
    )
  );
}
