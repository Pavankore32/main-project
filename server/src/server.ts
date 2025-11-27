// src/server.ts
import express, { Response, Request } from "express";
import dotenv from "dotenv";
import http from "http";
import cors from "cors";
import { SocketEvent, SocketId } from "./types/socket";
import { USER_CONNECTION_STATUS, User } from "./types/user";
import { Server, Socket } from "socket.io";
import path from "path";

dotenv.config();

const app = express();

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "public"))); // Serve static files

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
  maxHttpBufferSize: 1e8,
  pingTimeout: 60000,
});

let userSocketMap: User[] = [];

/** Helpers -------------------------------------------------- */
/** Accept undefined roomId safely — return empty array when missing */
function getUsersInRoom(roomId?: string): User[] {
  if (!roomId) return [];
  return userSocketMap.filter((user) => user.roomId === roomId);
}

function getRoomId(socketId: SocketId): string | null {
  const roomId = userSocketMap.find((user) => user.socketId === socketId)?.roomId;
  if (!roomId) {
    console.error("Room ID is undefined for socket ID:", socketId);
    return null;
  }
  return roomId;
}

function getUserBySocketId(socketId: SocketId): User | null {
  const user = userSocketMap.find((user) => user.socketId === socketId);
  if (!user) {
    console.error("User not found for socket ID:", socketId);
    return null;
  }
  return user;
}

/** Socket handlers ----------------------------------------- */
io.on("connection", (socket: Socket) => {
  console.log("[server] socket connected", socket.id);

  // Debug: log all incoming events
  socket.onAny((ev, ...args) => {
    console.log("[server recv]", ev, args);
  });

  // Handle user join (with ack)
  socket.on(
    SocketEvent.JOIN_REQUEST,
    (payload: { roomId?: string; username?: string } = {}, callback?: (ack: any) => void) => {
      const roomId = typeof payload.roomId === "string" ? payload.roomId.trim() : undefined;
      const username = payload.username;

      if (!roomId) {
        if (typeof callback === "function") callback({ ok: false, error: "missing roomId" });
        return;
      }

      // Check if username exists in room
      const isUsernameExist = getUsersInRoom(roomId).filter((u) => u.username === username);
      if (isUsernameExist.length > 0) {
        io.to(socket.id).emit(SocketEvent.USERNAME_EXISTS);
        if (typeof callback === "function") callback({ ok: false, reason: "username-exists" });
        return;
      }

      const user: User = {
        username,
        roomId,
        status: USER_CONNECTION_STATUS.ONLINE,
        cursorPosition: 0,
        typing: false,
        socketId: socket.id,
        currentFile: null,
      };
      userSocketMap.push(user);
      socket.join(roomId);
      socket.broadcast.to(roomId).emit(SocketEvent.USER_JOINED, { user });
      const users = getUsersInRoom(roomId);

      // Ack and notify the joining socket
      io.to(socket.id).emit(SocketEvent.JOIN_ACCEPTED, { user, users });
      if (typeof callback === "function") callback({ ok: true, user, users });
    }
  );

  // Handle disconnecting
  socket.on("disconnecting", () => {
    const user = getUserBySocketId(socket.id);
    if (!user) return;
    const roomId = user.roomId;
    socket.broadcast.to(roomId).emit(SocketEvent.USER_DISCONNECTED, { user });
    userSocketMap = userSocketMap.filter((u) => u.socketId !== socket.id);
    socket.leave(roomId);
  });

  /** FILE / DIRECTORY actions (with safe payload types) **/

  socket.on(
    SocketEvent.SYNC_FILE_STRUCTURE,
    (payload: { fileStructure?: any; openFiles?: any; activeFile?: any; socketId?: string } = {}) => {
      const { fileStructure, openFiles, activeFile, socketId } = payload;
      if (socketId) {
        io.to(socketId).emit(SocketEvent.SYNC_FILE_STRUCTURE, { fileStructure, openFiles, activeFile });
      }
    }
  );

  socket.on(SocketEvent.DIRECTORY_CREATED, (payload: { parentDirId?: any; newDirectory?: any } = {}) => {
    const { parentDirId, newDirectory } = payload;
    const roomId = getRoomId(socket.id);
    if (!roomId) return;
    socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_CREATED, { parentDirId, newDirectory });
  });

  socket.on(SocketEvent.DIRECTORY_UPDATED, (payload: { dirId?: any; children?: any } = {}) => {
    const { dirId, children } = payload;
    const roomId = getRoomId(socket.id);
    if (!roomId) return;
    socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_UPDATED, { dirId, children });
  });

  socket.on(SocketEvent.DIRECTORY_RENAMED, (payload: { dirId?: any; newName?: string } = {}) => {
    const { dirId, newName } = payload;
    const roomId = getRoomId(socket.id);
    if (!roomId) return;
    socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_RENAMED, { dirId, newName });
  });

  socket.on(SocketEvent.DIRECTORY_DELETED, (payload: { dirId?: any } = {}) => {
    const { dirId } = payload;
    const roomId = getRoomId(socket.id);
    if (!roomId) return;
    socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_DELETED, { dirId });
  });

  // FILE_CREATED (ack)
  socket.on(
    SocketEvent.FILE_CREATED,
    (payload: { parentDirId?: any; newFile?: { id?: string; content?: string } } = {}, callback?: (ack: any) => void) => {
      const { parentDirId, newFile } = payload;
      const roomId = getRoomId(socket.id);
      if (!roomId) {
        if (typeof callback === "function") callback({ ok: false, error: "no-room" });
        return;
      }

      socket.broadcast.to(roomId).emit(SocketEvent.FILE_CREATED, { parentDirId, newFile });

      if (typeof callback === "function") callback({ ok: true, fileId: newFile?.id ?? null });
    }
  );

  // FILE_UPDATED (ack)
  socket.on(
    SocketEvent.FILE_UPDATED,
    (payload: { fileId?: string; newContent?: any } = {}, callback?: (ack: any) => void) => {
      const { fileId, newContent } = payload;
      const roomId = getRoomId(socket.id);
      if (!roomId) {
        if (typeof callback === "function") callback({ ok: false, error: "no-room" });
        return;
      }

      socket.broadcast.to(roomId).emit(SocketEvent.FILE_UPDATED, { fileId, newContent });
      if (typeof callback === "function") callback({ ok: true, fileId: fileId ?? null, savedAt: Date.now() });
    }
  );

  socket.on(SocketEvent.FILE_RENAMED, (payload: { fileId?: string; newName?: string } = {}) => {
    const { fileId, newName } = payload;
    const roomId = getRoomId(socket.id);
    if (!roomId) return;
    socket.broadcast.to(roomId).emit(SocketEvent.FILE_RENAMED, { fileId, newName });
  });

  socket.on(SocketEvent.FILE_DELETED, (payload: { fileId?: string } = {}) => {
    const { fileId } = payload;
    const roomId = getRoomId(socket.id);
    if (!roomId) return;
    socket.broadcast.to(roomId).emit(SocketEvent.FILE_DELETED, { fileId });
  });

  /** USER status handlers **/

  socket.on(SocketEvent.USER_OFFLINE, (payload: { socketId?: SocketId } = {}) => {
    const { socketId } = payload;
    if (!socketId) return;
    userSocketMap = userSocketMap.map((user) => {
      if (user.socketId === socketId) {
        return { ...user, status: USER_CONNECTION_STATUS.OFFLINE };
      }
      return user;
    });
    const roomId = getRoomId(socketId);
    if (!roomId) return;
    socket.broadcast.to(roomId).emit(SocketEvent.USER_OFFLINE, { socketId });
  });

  socket.on(SocketEvent.USER_ONLINE, (payload: { socketId?: SocketId } = {}) => {
    const { socketId } = payload;
    if (!socketId) return;
    userSocketMap = userSocketMap.map((user) => {
      if (user.socketId === socketId) {
        return { ...user, status: USER_CONNECTION_STATUS.ONLINE };
      }
      return user;
    });
    const roomId = getRoomId(socketId);
    if (!roomId) return;
    socket.broadcast.to(roomId).emit(SocketEvent.USER_ONLINE, { socketId });
  });

  /** CHAT **/
  socket.on(SocketEvent.SEND_MESSAGE, (payload: { message?: any } = {}) => {
    const { message } = payload;
    const roomId = getRoomId(socket.id);
    if (!roomId) return;
    socket.broadcast.to(roomId).emit(SocketEvent.RECEIVE_MESSAGE, { message });
  });

  /** TYPING & CURSOR **/

  socket.on(SocketEvent.TYPING_START, (payload: { cursorPosition?: number; selectionStart?: number; selectionEnd?: number } = {}) => {
    const { cursorPosition, selectionStart, selectionEnd } = payload;
    userSocketMap = userSocketMap.map((user) => {
      if (user.socketId === socket.id) {
        return {
          ...user,
          typing: true,
          cursorPosition: typeof cursorPosition === "number" ? cursorPosition : user.cursorPosition,
          selectionStart: typeof selectionStart === "number" ? selectionStart : (user as any).selectionStart,
          selectionEnd: typeof selectionEnd === "number" ? selectionEnd : (user as any).selectionEnd,
        };
      }
      return user;
    });
    const user = getUserBySocketId(socket.id);
    if (!user) return;
    const roomId = user.roomId;
    socket.broadcast.to(roomId).emit(SocketEvent.TYPING_START, { user });
  });

  socket.on(SocketEvent.TYPING_PAUSE, () => {
    userSocketMap = userSocketMap.map((user) => {
      if (user.socketId === socket.id) {
        return { ...user, typing: false };
      }
      return user;
    });
    const user = getUserBySocketId(socket.id);
    if (!user) return;
    const roomId = user.roomId;
    socket.broadcast.to(roomId).emit(SocketEvent.TYPING_PAUSE, { user });
  });

  // CURSOR_MOVE (separate from typing)
  socket.on(SocketEvent.CURSOR_MOVE, (payload: { cursorPosition?: number; selectionStart?: number; selectionEnd?: number } = {}) => {
    const { cursorPosition, selectionStart, selectionEnd } = payload;
    userSocketMap = userSocketMap.map((user) => {
      if (user.socketId === socket.id) {
        return {
          ...user,
          cursorPosition: typeof cursorPosition === "number" ? cursorPosition : user.cursorPosition,
          selectionStart: typeof selectionStart === "number" ? selectionStart : (user as any).selectionStart,
          selectionEnd: typeof selectionEnd === "number" ? selectionEnd : (user as any).selectionEnd,
        };
      }
      return user;
    });
    const user = getUserBySocketId(socket.id);
    if (!user) return;
    const roomId = user.roomId;
    socket.broadcast.to(roomId).emit(SocketEvent.CURSOR_MOVE, { user });
  });

  /** DRAWING **/
  socket.on(SocketEvent.REQUEST_DRAWING, () => {
    const roomId = getRoomId(socket.id);
    if (!roomId) return;
    socket.broadcast.to(roomId).emit(SocketEvent.REQUEST_DRAWING, { socketId: socket.id });
  });

  socket.on(SocketEvent.SYNC_DRAWING, (payload: { drawingData?: any; socketId?: string } = {}) => {
    const { drawingData, socketId } = payload;
    if (!socketId) return;
    // send directly to the target socket
    io.to(socketId).emit(SocketEvent.SYNC_DRAWING, { drawingData });
  });

  socket.on(SocketEvent.DRAWING_UPDATE, (payload: { snapshot?: any } = {}) => {
    const { snapshot } = payload;
    const roomId = getRoomId(socket.id);
    if (!roomId) return;
    socket.broadcast.to(roomId).emit(SocketEvent.DRAWING_UPDATE, { snapshot });
  });
});

/** Routes & server start ------------------------------------ */
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.get("/", (req: Request, res: Response) => {
  // Send the index.html file
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

server.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
