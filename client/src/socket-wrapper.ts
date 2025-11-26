// client/src/socket-wrapper.ts
import { io, Socket as ClientSocket } from "socket.io-client"

/* ---- BACKEND URL ---- */
const BACKEND_URL = "https://main-project-ghf9.onrender.com"

/* ---- SINGLE SOCKET INSTANCE ---- */
export const socket: ClientSocket = io(BACKEND_URL, {
  autoConnect: true,
})

/* -------------------------------------------------------------------
   EVENTS (must match backend server SocketEvent enum)
-------------------------------------------------------------------- */
export enum SocketEvent {
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

  /* Permission related */
  REQUEST_PERMISSION = "request-permission",
  GRANT_PERMISSION = "grant-permission",
  REVOKE_PERMISSION = "revoke-permission",

  PERMISSION_REQUEST = "permission-request",
  PERMISSION_UPDATED = "permission-updated",
  PERMISSION_REVOKED = "permission-revoked",
  PERMISSION_ERROR = "permission-error",
  PERMISSION_DENIED = "permission-denied",
}

/* -------------------------------------------------------------------
   PERMISSION HELPERS (client → server)
-------------------------------------------------------------------- */

type RequestType = "edit" | "delete" | "both"
type Perms = { canEdit?: boolean; canDelete?: boolean }

export function requestPermission(fileId: string, requestType: RequestType = "edit", message = "") {
  socket.emit(SocketEvent.REQUEST_PERMISSION, { fileId, requestType, message })
}

export function grantPermission(fileId: string, targetUsername: string, perms: Perms) {
  socket.emit(SocketEvent.GRANT_PERMISSION, { fileId, targetUsername, perms })
}

export function revokePermission(fileId: string, targetUsername: string) {
  socket.emit(SocketEvent.REVOKE_PERMISSION, { fileId, targetUsername })
}

/* -------------------------------------------------------------------
   PERMISSION LISTENERS
-------------------------------------------------------------------- */

socket.on(SocketEvent.PERMISSION_REQUEST, (payload) => {
  console.log("Permission request received:", payload)

  if (window && (window as any).showPermissionRequestModal)
    (window as any).showPermissionRequestModal(payload)
})

socket.on(SocketEvent.PERMISSION_UPDATED, ({ fileId, perms, owner }) => {
  console.log(`Permissions updated by ${owner} for file ${fileId}`)

  if (window && (window as any).enableFileActions)
    (window as any).enableFileActions(fileId, perms)
})

socket.on(SocketEvent.PERMISSION_REVOKED, ({ fileId }) => {
  if (window && (window as any).disableFileActions)
    (window as any).disableFileActions(fileId)
})

socket.on(SocketEvent.PERMISSION_DENIED, ({ action, fileId }) => {
  console.warn(`Permission denied for ${action} on ${fileId}`)
})

socket.on(SocketEvent.PERMISSION_ERROR, ({ reason }) => {
  console.warn("Permission Error:", reason)
})

/* -------------------------------------------------------------------
   GLOBAL UI HELPERS
-------------------------------------------------------------------- */
declare global {
  interface Window {
    showPermissionRequestModal?: Function
    enableFileActions?: Function
    disableFileActions?: Function
    currentPermissions?: any
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
    if (!window.currentPermissions) return
    delete window.currentPermissions[fileId]
  }
}

/* -------------------------------------------------------------------
   EXPORT DEFAULT SOCKET
-------------------------------------------------------------------- */
export default socket
