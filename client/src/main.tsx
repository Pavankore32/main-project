// client/src/main.tsx
import ReactDOM from "react-dom/client"
import App from "./App.tsx"
import AppProvider from "./context/AppProvider.tsx"
import "@/styles/global.css"

// import wrapper (relative) — final stable path
import socket from "./socket-wrapper"

// expose socket globally
;(window as any).socket = socket

type RequestType = "edit" | "delete" | "both"
type PermissionRequestPayload = {
  fileId: string
  requester: string
  requestType: RequestType
  message?: string
}

;(window as any).showPermissionRequestModal = function (payload: PermissionRequestPayload) {
  const { fileId, requester, requestType, message } = payload
  const allow = confirm(
    `${requester} wants ${requestType} access to file: ${fileId}\n\n` +
      `Message: ${message || "(no message)"}\n\n` +
      `Do you approve?`
  )

  if (allow) {
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
