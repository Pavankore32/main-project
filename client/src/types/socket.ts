// client/src/socket.ts
import { io, Socket as ClientSocket } from "socket.io-client"

/* Types & events (keep synced with server) */
type SocketId = string

enum SocketEvent {
  JOIN_REQUEST = "join-request",
  JOIN_ACCEPTED = "join-accepted",
  USER_JOINED = "user-joined",
  USER_DISCONNECTED = "user-disconnected",
  SYNC_FILE_STRUCTURE = "sync-file-structure",
  DIRECTORY_CREATED = "directory-created",
  DIRECTORY_UPDATED = "directory-updated",
  DIRECTORY_RENAMED = "directory-renamed",
  DIRECTORY_DELETED = "directory-deleted",
  FILE_CREATED = "file-created",
  FILE_UPDATED = "file-updated",
  FILE_RENAMED = "file-renamed",
  FILE_DELETED = "file-deleted",
  USER_OFFLINE = "offline",
  USER_ONLINE = "online",
  SEND_MESSAGE = "send-message",
  RECEIVE_MESSAGE = "receive-message",
  TYPING_START = "typing-start",
  TYPING_PAUSE = "typing-pause",
  USERNAME_EXISTS = "username-exists",
  REQUEST_DRAWING = "request-drawing",
  SYNC_DRAWING = "sync-drawing",
  DRAWING_UPDATE = "drawing-update",
}

interface SocketContext {
  socket: ClientSocket
}

/* ---- CONNECT: replace your backend URL earlier inserted by you ---- */
export const socket: ClientSocket = io("https://main-project-ghf9.onrender.com", {
  autoConnect: true,
})

/* -------------------------
   Permission helper types
------------------------- */
type RequestType = "edit" | "delete" | "both"
type Perms = { canEdit?: boolean; canDelete?: boolean }

/* -------------------------
   EXPORTABLE API (client -> server)
------------------------- */

export function requestPermission(fileId: string, requestType: RequestType = "edit", message = "") {
  socket.emit("request-permission", { fileId, requestType, message })
}

export function grantPermission(fileId: string, targetUsername: string, perms: Perms) {
  socket.emit("grant-permission", { fileId, targetUsername, perms })
}

export function revokePermission(fileId: string, targetUsername: string) {
  socket.emit("revoke-permission", { fileId, targetUsername })
}

/* -------------------------
   Client Listeners
------------------------- */

socket.on("permission-request-sent", ({ fileId, owner }) => {
  console.log(`Request sent to ${owner} for ${fileId}`)
})

socket.on("permission-error", ({ reason }) => {
  console.warn("Permission error:", reason)
})

socket.on("permission-request", (payload) => {
  console.log("Permission request:", payload)
  if (window && (window as any).showPermissionRequestModal) {
    (window as any).showPermissionRequestModal(payload)
  }
})

socket.on("permission-updated", ({ fileId, perms, owner }) => {
  if (window && (window as any).enableFileActions) (window as any).enableFileActions(fileId, perms)
  console.log(`Permissions updated by ${owner} for file ${fileId}`)
})

socket.on("permission-revoked", ({ fileId }) => {
  if (window && (window as any).disableFileActions) (window as any).disableFileActions(fileId)
})

socket.on("permission-denied", ({ action, fileId }) => {
  console.warn(`Permission denied for ${action} on ${fileId}`)
})

/* -------------------------
   UI Helper Defaults
------------------------- */

declare global {
  interface Window {
    showPermissionRequestModal?: any
    enableFileActions?: any
    disableFileActions?: any
    currentPermissions?: any
    socket?: any
  }
}

if (!window.enableFileActions) {
  window.enableFileActions = (fileId: string, perms: Perms) => {
    window.currentPermissions = window.currentPermissions || {}
    window.currentPermissions[fileId] = perms
  }
}

if (!window.disableFileActions) {
  window.disableFileActions = (fileId: string) => {
    window.currentPermissions = window.currentPermissions || {}
    delete window.currentPermissions[fileId]
  }
}

/* -------------------------
   Export
------------------------- */

export { SocketEvent, SocketContext, SocketId }
export default socket
