// server/src/socket.ts
import http from "http";
import fs from "fs/promises";
import path from "path";
import { Server, Socket } from "socket.io";

/* Use the same event names your UI expects */
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
}

/* ---------- simple disk persistence (safe default) ---------- */
const FILE_STORE_DIR = path.resolve(__dirname, "../files");
async function ensureFileStore() {
  await fs.mkdir(FILE_STORE_DIR, { recursive: true });
}
async function saveFileToDisk(fileId: string, content: string) {
  await ensureFileStore();
  const filePath = path.join(FILE_STORE_DIR, `${fileId}.txt`);
  await fs.writeFile(filePath, content ?? "", "utf8");
  const stat = await fs.stat(filePath);
  return { filePath, updatedAt: stat.mtimeMs };
}

/* ---------- initSocket attaches socket.io to your http.Server ---------- */
export function initSocket(server: http.Server) {
  const io = new Server(server, {
    path: "/socket.io",
    cors: { origin: "*", methods: ["GET", "POST"] },
  });

  io.on("connection", (socket: Socket) => {
    console.log("[server] socket connected", socket.id);

    // Debug: print every event received (safe; won't change UI)
    socket.onAny((ev, ...args) => {
      console.log("[server recv]", ev, args);
    });

    /* JOIN: join the requested room, ack to client, notify others */
    socket.on(SocketEvent.JOIN_REQUEST, (payload: any, callback?: (ack: any) => void) => {
      const { roomId, username } = payload || {};
      if (!roomId) {
        if (typeof callback === "function") callback({ ok: false, error: "missing roomId" });
        return;
      }
      socket.join(roomId);
      console.log(`[server] ${socket.id} joined room ${roomId} (username=${username})`);

      // notify others in the room (UI listeners will receive USER_JOINED)
      socket.to(roomId).emit(SocketEvent.USER_JOINED, { socketId: socket.id, username });

      // ack the join — UI expects an ack to clear waiting state
      if (typeof callback === "function") callback({ ok: true, roomId });
    });

    /* FILE CREATED: persist if content provided, broadcast to room, ack */
    socket.on(SocketEvent.FILE_CREATED, async (payload: any, callback?: (ack: any) => void) => {
      const { roomId, parentDirId, newFile } = payload || {};
      if (!roomId || !newFile || !newFile.id) {
        if (typeof callback === "function") callback({ ok: false, error: "missing payload" });
        return;
      }
      try {
        if (typeof newFile.content === "string") {
          await saveFileToDisk(newFile.id, newFile.content);
        }
        // broadcast to other clients in the room (UI should react with file-created listener)
        socket.to(roomId).emit(SocketEvent.FILE_CREATED, { parentDirId, newFile, serverTs: Date.now() });
        if (typeof callback === "function") callback({ ok: true, fileId: newFile.id, savedAt: Date.now() });
      } catch (err: any) {
        console.error("[server] FILE_CREATED error:", err);
        if (typeof callback === "function") callback({ ok: false, error: err.message || "save-failed" });
      }
    });

    /* FILE UPDATED: persist and broadcast; always call callback so UI spinner clears */
    socket.on(SocketEvent.FILE_UPDATED, async (payload: any, callback?: (ack: any) => void) => {
      const { roomId, fileId, content } = payload || {};
      if (!roomId || !fileId) {
        if (typeof callback === "function") callback({ ok: false, error: "missing ids" });
        return;
      }
      try {
        if (typeof content === "string") {
          const saved = await saveFileToDisk(fileId, content);
          socket.to(roomId).emit(SocketEvent.FILE_UPDATED, { fileId, content, serverTs: Date.now() });
          if (typeof callback === "function") callback({ ok: true, savedAt: saved.updatedAt });
        } else {
          // broadcast anyway (if non-string content)
          socket.to(roomId).emit(SocketEvent.FILE_UPDATED, { fileId, content, serverTs: Date.now() });
          if (typeof callback === "function") callback({ ok: true, savedAt: Date.now() });
        }
      } catch (err: any) {
        console.error("[server] FILE_UPDATED error:", err);
        if (typeof callback === "function") callback({ ok: false, error: err.message || "save-failed" });
      }
    });

    /* TYPING presence: forward to other clients in same room */
    socket.on(SocketEvent.TYPING_START, (payload: any) => {
      const { roomId, cursorPosition } = payload || {};
      if (!roomId) return;
      socket.to(roomId).emit(SocketEvent.TYPING_START, { socketId: socket.id, cursorPosition });
    });

    socket.on(SocketEvent.TYPING_PAUSE, (payload: any) => {
      const { roomId } = payload || {};
      if (!roomId) return;
      socket.to(roomId).emit(SocketEvent.TYPING_PAUSE, { socketId: socket.id });
    });

    /* leave-room (UI may call this) */
    socket.on("leave-room", (payload: any) => {
      const { roomId } = payload || {};
      if (roomId) {
        socket.leave(roomId);
        socket.to(roomId).emit(SocketEvent.USER_DISCONNECTED, { socketId: socket.id });
      }
    });

    /* disconnect: notify rooms the socket was in */
    socket.on("disconnect", (reason) => {
      console.log("[server] socket disconnect", socket.id, reason);
      const rooms = Array.from(socket.rooms).filter((r) => r !== socket.id);
      rooms.forEach((r) => socket.to(r).emit(SocketEvent.USER_DISCONNECTED, { socketId: socket.id, reason }));
    });
  });

  return io;
}
