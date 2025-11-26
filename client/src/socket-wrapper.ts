// client/src/socket-wrapper.ts
import { io, Socket as ClientSocket } from "socket.io-client";

/* ---- BACKEND URL - update if necessary ---- */
const BACKEND_URL = "https://main-project-ghf9.onrender.com"; // keep your existing URL

/* ---- SINGLE SOCKET INSTANCE ---- */
export const socket: ClientSocket = io(BACKEND_URL, {
  autoConnect: true,
});

/* -------------------------------------------------------------------
   EVENTS (shared names used by client + server)
-------------------------------------------------------------------- */
export enum SocketEvent {
  JOIN_REQUEST = "join-request",
  JOIN_ACCEPTED = "join-accepted",
  USER_JOINED = "user-joined",
  USER_DISCONNECTED = "user-disconnected",
  SYNC_FILE_STRUCTURE = "sync-file-structure",
  FILE_CREATED = "file-created",
  FILE_UPDATED = "file-updated",
  FILE_DELETED = "file-deleted",
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
   HELPERS (client → server)
   - joinRoom returns an ack object { ok: boolean, files?: [] }
   - emitFileCreate emits file-created to server with ack
-------------------------------------------------------------------- */
export function joinRoom(roomId: string, username?: string): Promise<{ ok: boolean; files?: any[]; reason?: string }> {
  return new Promise((resolve) => {
    const normalized = String(roomId || "").trim();
    console.log("[socket] joinRoom ->", normalized, username);
    socket.emit(
      SocketEvent.JOIN_REQUEST,
      { roomId: normalized, username },
      (ack: { ok: boolean; files?: any[]; reason?: string }) => {
        console.log("[socket] join ack:", ack);
        resolve(ack || { ok: false, reason: "no-ack" });
      }
    );
  });
}

export function emitFileCreate(roomId: string, file: any) {
  const normalized = String(roomId || "").trim();
  console.log("[socket] emit file-created", { roomId: normalized, file });
  socket.emit(SocketEvent.FILE_CREATED, { roomId: normalized, file }, (ack: any) => {
    console.log("[socket] file-created ack:", ack);
  });
}

/* -------------------------------------------------------------------
   LISTENER helpers (component code uses these)
-------------------------------------------------------------------- */
type Callback = (payload: any) => void;

export function onFileCreated(cb: Callback) {
  socket.on(SocketEvent.FILE_CREATED, (payload: any) => {
    console.log("[socket] received file-created:", payload);
    try {
      cb(payload);
    } catch (err) {
      console.error("onFileCreated handler error:", err);
    }
  });
}

export function offFileCreated(cb?: Callback) {
  if (cb) socket.off(SocketEvent.FILE_CREATED, cb as any);
  else socket.off(SocketEvent.FILE_CREATED);
}

/* -------------------------------------------------------------------
   Permission listeners (still useful)
-------------------------------------------------------------------- */
socket.on(SocketEvent.PERMISSION_REQUEST, (payload) => {
  console.log("[socket] permission-request received", payload);
  if ((window as any).showPermissionRequestModal) (window as any).showPermissionRequestModal(payload);
});

socket.on(SocketEvent.PERMISSION_UPDATED, (payload) => {
  console.log("[socket] permission-updated", payload);
  if ((window as any).enableFileActions) (window as any).enableFileActions(payload.fileId, payload.perms);
});

socket.on(SocketEvent.PERMISSION_REVOKED, (payload) => {
  console.log("[socket] permission-revoked", payload);
  if ((window as any).disableFileActions) (window as any).disableFileActions(payload.fileId);
});

socket.on(SocketEvent.PERMISSION_DENIED, (payload) => {
  console.warn("[socket] permission-denied", payload);
});

socket.on(SocketEvent.PERMISSION_ERROR, (payload) => {
  console.warn("[socket] permission-error", payload);
});

/* -------------------------------------------------------------------
   Global UI helpers (window.*) - keep as your app expects
-------------------------------------------------------------------- */
declare global {
  interface Window {
    showPermissionRequestModal?: Function;
    enableFileActions?: Function;
    disableFileActions?: Function;
    currentPermissions?: any;
  }
}

if (!window.enableFileActions) {
  window.enableFileActions = (fileId: string, perms: { canEdit?: boolean; canDelete?: boolean }) => {
    window.currentPermissions = window.currentPermissions || {};
    window.currentPermissions[fileId] = perms;
  };
}
if (!window.disableFileActions) {
  window.disableFileActions = (fileId: string) => {
    if (!window.currentPermissions) return;
    delete window.currentPermissions[fileId];
  };
}

/* -------------------------------------------------------------------
   Export default socket
-------------------------------------------------------------------- */
export default socket;
