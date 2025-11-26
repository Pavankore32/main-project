// import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App.tsx"
import AppProvider from "./context/AppProvider.tsx"
import "@/styles/global.css"

// 1️⃣ Import socket
import socket from "./socket"

// 2️⃣ Expose socket globally (needed for permission modal)
;(window as any).socket = socket

// 3️⃣ Add Permission Request Popup for owners
;(window as any).showPermissionRequestModal = function ({
    fileId,
    requester,
    requestType,
    message,
}) {
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
        // Owner denies request
        socket.emit("deny-permission", {
            fileId,
            targetUsername: requester,
        })

        alert(`You denied permission to ${requester}.`)
    }
}

// 4️⃣ Render App
ReactDOM.createRoot(document.getElementById("root")!).render(
    <AppProvider>
        <App />
    </AppProvider>
)
