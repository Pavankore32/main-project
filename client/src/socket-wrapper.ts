// client/src/socket-wrapper.ts
import { io, Socket as ClientSocket } from "socket.io-client";

/* -----------------------------------------------------
   BACKEND URL RESOLUTION
------------------------------------------------------ */
const DEFAULT_BACKEND = "http://localhost:3000";

function getViteBackend(): string | undefined {
  try {
    // Vite exposes env on import.meta.env
    // @ts-ignore
    const env = (import.meta as any)?.env;
    if (env && env.VITE_BACKEND_URL) return String(env.VITE_BACKEND_URL);
  } catch (e) {
    // ignore
  }
  return undefined;
}

const BACKEND_URL =
  getViteBackend() ||
  (typeof process !== "undefined"
    ? (process.env.REACT_APP_BACKEND_URL as string | undefined)
    : undefined) ||
  DEFAULT_BACKEND;

/* -----------------------------------------------------
   CREATE SINGLE SOCKET INSTANCE
------------------------------------------------------ */
export const socket: ClientSocket = io(BACKEND_URL, {
  path: "/socket.io",
  transports: ["websocket"],
  autoConnect: true,
  reconnectionAttempts: 5,
});

/* DEBUG LOGS – Keep them ON while fixing sync issue */
socket.on("connect", () =>
  console.log("[socket] connected:", socket.id)
);
socket.on("disconnect", (reason) =>
  console.log("[socket] disconnected:", reason)
);
socket.onAny((event, ...args) => {
  console.log("[socket recv]", event, args);
});

/* -----------------------------------------------------
   EVENT ENUM (SHARED WITH SERVER)
------------------------------------------------------ */
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

/* -----------------------------------------------------
   INTERNAL ROOM TRACKING
------------------------------------------------------ */
let currentRoomId: string | null = null;

/* -----------------------------------------------------
   JOIN ROOM (MANDATORY BEFORE ANY EMIT)
------------------------------------------------------ */
export function joinRoom(
  roomId: string,
  username?: string
): Promise<{ ok: boolean; files?: any[]; reason?: string }> {
  return new Promise((resolve) => {
    const normalized = String(roomId || "").trim();

    socket.emit(
      SocketEvent.JOIN_REQUEST,
      { roomId: normalized, username },
      (ack: any) => {
        if (ack && ack.ok) {
          currentRoomId = normalized;
          console.log("[socket] Joined room:", normalized);
        } else {
          console.warn("[socket] Failed to join room:", ack);
        }

        resolve(ack || { ok: false, reason: "no-ack" });
      }
    );
  });
}

/* -----------------------------------------------------
   FILE CREATION
------------------------------------------------------ */
export function emitFileCreate(
  parentDirId: string | null,
  newFile: any
) {
  if (!currentRoomId) {
    console.warn(
      "[socket] emitFileCreate called before joinRoom()!"
    );
  }

  const payload = {
    roomId: currentRoomId,
    parentDirId: parentDirId ?? null,
    newFile,
  };

  console.log("[socket] → FILE_CREATED", payload);

  socket.emit(SocketEvent.FILE_CREATED, payload, (ack: any) => {
    console.log("[socket ack] FILE_CREATED:", ack);
  });
}

/* -----------------------------------------------------
   FILE UPDATE
------------------------------------------------------ */
export function emitFileUpdate(fileId: string, content: string) {
  if (!currentRoomId) {
    console.warn("[socket] emitFileUpdate called before joinRoom()");
  }

  const payload = {
    roomId: currentRoomId,
    fileId,
    content,
  };

  socket.emit(SocketEvent.FILE_UPDATED, payload, (ack: any) => {
    console.log("[socket ack] FILE_UPDATED:", ack);
  });
}

/* -----------------------------------------------------
   PERMISSIONS
------------------------------------------------------ */
export type RequestType = "edit" | "delete" | "both";
export type Perms = { canEdit?: boolean; canDelete?: boolean };

export function requestPermission(
  fileId: string,
  requestType: RequestType = "edit",
  message = ""
) {
  socket.emit(SocketEvent.REQUEST_PERMISSION, {
    roomId: currentRoomId,
    fileId,
    requestType,
    message,
  });
}

export function grantPermission(
  fileId: string,
  targetUsername: string,
  perms: Perms
) {
  socket.emit(SocketEvent.GRANT_PERMISSION, {
    roomId: currentRoomId,
    fileId,
    targetUsername,
    perms,
  });
}

export function revokePermission(
  fileId: string,
  targetUsername: string
) {
  socket.emit(SocketEvent.REVOKE_PERMISSION, {
    roomId: currentRoomId,
    fileId,
    targetUsername,
  });
}

/* -----------------------------------------------------
   TYPING STATUS
------------------------------------------------------ */
export function emitTypingStart(cursorPosition?: number) {
  socket.emit(SocketEvent.TYPING_START, {
    roomId: currentRoomId,
    cursorPosition,
  });
}

export function emitTypingPause() {
  socket.emit(SocketEvent.TYPING_PAUSE, {
    roomId: currentRoomId,
  });
}

/* -----------------------------------------------------
   CLIENT LISTENER HELPERS
------------------------------------------------------ */
type Callback = (payload: any) => void;

export function onFileCreated(cb: Callback) {
  socket.on(SocketEvent.FILE_CREATED, cb);
}
export function offFileCreated(cb?: Callback) {
  if (cb) socket.off(SocketEvent.FILE_CREATED, cb);
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

export function onTypingStart(cb: Callback) {
  socket.on(SocketEvent.TYPING_START, cb);
}
export function onTypingPause(cb: Callback) {
  socket.on(SocketEvent.TYPING_PAUSE, cb);
}

/* -----------------------------------------------------
   LEAVE ROOM
------------------------------------------------------ */
export function leaveCurrentRoom() {
  if (currentRoomId) {
    socket.emit("leave-room", { roomId: currentRoomId });
    currentRoomId = null;
  }
}

export default socket;
