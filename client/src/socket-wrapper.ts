// client/src/socket-wrapper.ts
import { io, Socket as ClientSocket } from "socket.io-client";

const DEFAULT_BACKEND = "http://localhost:3000";

function getViteBackend(): string | undefined {
  try {
    // Vite exposes env on import.meta.env
    // @ts-ignore
    const env = (import.meta as any)?.env;
    if (env && env.VITE_BACKEND_URL) return String(env.VITE_BACKEND_URL);
  } catch (e) {
    // import.meta may not exist in non-Vite envs — ignore
  }
  return undefined;
}

const BACKEND_URL =
  getViteBackend() ||
  (typeof process !== "undefined" ? (process.env.REACT_APP_BACKEND_URL as string | undefined) : undefined) ||
  DEFAULT_BACKEND;

export const socket: ClientSocket = io(BACKEND_URL, {
  autoConnect: true,
});

/* Event names (shared with server) */
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
  REQUEST_PERMISSION = "request-permission",
  GRANT_PERMISSION = "grant-permission",
  REVOKE_PERMISSION = "revoke-permission",
  PERMISSION_REQUEST = "permission-request",
  PERMISSION_UPDATED = "permission-updated",
  PERMISSION_REVOKED = "permission-revoked",
  PERMISSION_ERROR = "permission-error",
  PERMISSION_DENIED = "permission-denied",
}

/* -----------------------------
   Join / file-create helpers
   ----------------------------- */

export function joinRoom(
  roomId: string,
  username?: string
): Promise<{ ok: boolean; files?: any[]; reason?: string }> {
  return new Promise((resolve) => {
    const normalized = String(roomId || "").trim();
    socket.emit(SocketEvent.JOIN_REQUEST, { roomId: normalized, username }, (ack: any) => {
      resolve(ack || { ok: false, reason: "no-ack" });
    });
  });
}

/**
 * server expects payload shape { parentDirId, newFile }
 */
export function emitFileCreate(parentDirId: string | null, newFile: any) {
  const payload = { parentDirId: parentDirId ?? null, newFile };
  console.log("[socket] emit file-created -> server", payload);
  socket.emit(SocketEvent.FILE_CREATED, payload, (ack: any) => {
    console.log("[socket] file-created ack:", ack);
  });
}

/* -----------------------------
   Permission helpers (client -> server)
   ----------------------------- */

export type RequestType = "edit" | "delete" | "both";
export type Perms = { canEdit?: boolean; canDelete?: boolean };

export function requestPermission(fileId: string, requestType: RequestType = "edit", message = "") {
  socket.emit(SocketEvent.REQUEST_PERMISSION, { fileId, requestType, message });
}

export function grantPermission(fileId: string, targetUsername: string, perms: Perms) {
  socket.emit(SocketEvent.GRANT_PERMISSION, { fileId, targetUsername, perms });
}

export function revokePermission(fileId: string, targetUsername: string) {
  socket.emit(SocketEvent.REVOKE_PERMISSION, { fileId, targetUsername });
}

/* -----------------------------
   Typing helpers
   ----------------------------- */

export function emitTypingStart(cursorPosition?: number) {
  socket.emit(SocketEvent.TYPING_START, { cursorPosition });
}

export function emitTypingPause() {
  socket.emit(SocketEvent.TYPING_PAUSE);
}

/* -----------------------------
   Listener helpers (component side)
   ----------------------------- */

type Callback = (payload: any) => void;

export function onFileCreated(cb: Callback) {
  socket.on(SocketEvent.FILE_CREATED, (payload: any) => {
    cb(payload);
  });
}

export function offFileCreated(cb?: Callback) {
  if (cb) socket.off(SocketEvent.FILE_CREATED, cb as any);
  else socket.off(SocketEvent.FILE_CREATED);
}

export function onPermissionRequest(cb: Callback) {
  socket.on(SocketEvent.PERMISSION_REQUEST, cb);
}
export function onPermissionUpdated(cb: Callback) {
  socket.on(SocketEvent.PERMISSION_UPDATED, cb);
}
export function onPermissionRevoked(cb: Callback) {
  socket.on(SocketEvent.PERMISSION_REVOKED, cb);
}
export function onPermissionDenied(cb: Callback) {
  socket.on(SocketEvent.PERMISSION_DENIED, cb);
}

/* typing presence listeners */
export function onTypingStart(cb: Callback) {
  socket.on(SocketEvent.TYPING_START, cb);
}
export function onTypingPause(cb: Callback) {
  socket.on(SocketEvent.TYPING_PAUSE, cb);
}

export default socket;
