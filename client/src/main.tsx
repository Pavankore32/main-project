// client/src/main.tsx
import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App.tsx"
import AppProvider from "./context/AppProvider.tsx"
import "@/styles/global.css"

// IMPORTANT: import socket (include extension if your build needs it)
import socket from "./socket" // try "./socket.ts" if your build complains

// expose socket globally (for quick modal code)
;(window as any).socket = socket

// typed modal payload
type RequestType = "edit" | "delete" | "both"
type PermissionRequestPayload = {
  fileId: string
  requester: string
  requestType: RequestType
  message?: string
}

// owner approval modal (typed)
;(window as any).showPermissionRequestModal = function (payload: PermissionRequestPayload) {
  const { fileId, requester, requestType, message } = payload

  const allow = confirm(
    `${requester} wants ${requestType} access to file: ${fileId}\n\n` +
      `Message: ${message || "(no message)"}\n\n` +
      `Do you approve?`
  )

  if (allow) {
    // Owner grants permission
    socket.emit("grant-permission", {
      fileId,
      targetUsername: requester,
      perms: {
        canEdit: requestType === "edit" || requestType === "both",
        canDelete: requestType === "delete" || requestType === "both",
      },
    })

    alert(`You granted ${requestType} access to ${requester}.`)
  } else {
    // Owner denies request (server may ignore if not implemented, harmless)
    socket.emit("deny-permission", {
      fileId,
      targetUsername: requester,
    })

    alert(`You denied permission to ${requester}.`)
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <AppProvider>
    <App />
  </AppProvider>
)
