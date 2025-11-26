// client/src/types/socket.ts
import { Socket } from "socket.io-client";

type SocketId = string;

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
  REQUEST_PERMISSION = "request-permission",
  GRANT_PERMISSION = "grant-permission",
  REVOKE_PERMISSION = "revoke-permission",
  PERMISSION_REQUEST = "permission-request",
  PERMISSION_UPDATED = "permission-updated",
  PERMISSION_REVOKED = "permission-revoked",
  PERMISSION_ERROR = "permission-error",
  PERMISSION_DENIED = "permission-denied",
}

interface SocketContext {
  socket: Socket;
}

export { SocketEvent, SocketContext, SocketId };
export type { SocketId as SocketIdType };
export default SocketEvent;
