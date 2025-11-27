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
function getUsersInRoom(roomId: string): User[] {
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

  // JOIN_REQUEST
  socket.on(
    SocketEvent.JOIN_REQUEST,
    (payload: { roomId?: string; username?: string } = {}, callback?: (ack: any) => void) => {
      const roomId = typeof payload.roomId === "string" ? payload.roomId.trim() : undefined;
      const username = payload.username;

      if (!roomId) {
        if (typeof callback === "function") callback({ ok: false, error: "missing roomId" });
        return;
      }

      // Check is username exist in the room
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

      // ack the join so client unblocks
      io.to(socket.id).emit(SocketEvent.JOIN_ACCEPTED, { user, users });
      if (typeof callback === "function") callback({ ok: true, user, users });
    }
  );

  // disconnecting
  socket.on("disconnecting", () => {
    const user = getUserBySocketId(socket.id);
    if (!user) return;
    const roomId = user.roomId;
    socket.broadcast.to(roomId).emit(SocketEvent.USER_DISCONNECTED, { user });
    userSocketMap = userSocketMap.filter((u) => u.socketId !== socket.id);
    socket.leave(roomId);
  });

  // SYNC_FILE_STRUCTURE (send to target socketId)
  socket.on(
    SocketEvent.SYNC_FILE_STRUCTURE,
    (payload: { fileStructure?: any; openFiles?: any; activeFile?: any; socketId?: string } = {}) => {
      const { fileStructure, openFiles, activeFile, socketId } = payload;
      if (socketId) {
        io.to(socketId).emit(SocketEvent.SYNC_FILE_STRUCTURE, { fileStructure, openFiles, activeFile });
      }
    }
  );

  // DIRECTORY_CREATED
  socket.on(SocketEvent.DIRECTORY_CREATED, (payload: { parentDirId?: any; newDirectory?: any } = {}) => {
    const { parentDirId, newDirectory } = payload;
    const roomId = getRoomId(socket.id);
    if (!roomId) return;
    socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_CREATED, { parentDirId, newDirectory });
  });

  // DIRECTORY_UPDATED
  socket.on(SocketEvent.DIRECTORY_UPDATED, (payload: { dirId?: any; children?: any } = {}) => {
    const { dirId, children } = payload;
    const roomId = getRoomId(socket.id);
    if (!roomId) return;
    socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_UPDATED, { dirId, children });
  });

  // DIRECTORY_RENAMED
  socket.on(SocketEvent.DIRECTORY_RENAMED, (payload: { dirId?: any; newName?: string } = {}) => {
    const { dirId, newName } = payload;
    const roomId = getRoomId(socket.id);
    if (!roomId) return;
    socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_RENAMED, { dirId, newName });
  });

  // DIRECTORY_DELETED
  socket.on(SocketEvent.DIRECTORY_DELETED, (payload: { dirId?: any } = {}) => {
    const { dirId } = payload;
    const roomId = getRoomId(socket.id);
    if (!roomId) return;
    socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_DELETED, { dirId });
  });

  // FILE_CREATED with ack
  socket.on(
    SocketEvent.FILE_CREATED,
    (payload: { parentDirId?: any; newFile?: { id?: string; content?: string } } = {}, callback?: (ack: any) => void) => {
      const { parentDirId, newFile } = payload;
      const roomId = getRoomId(socket.id);
      if (!roomId) {
        if (typeof callback === "function") callback({ ok: false, error: "no-room" });
        return;
      }
      // broadcast to others in room
      socket.broadcast.to(roomId).emit(SocketEvent.FILE_CREATED, { parentDirId, newFile });

      // ack the creator
      if (typeof callback === "function") callback({ ok: true, fileId: newFile?.id ?? null });
    }
  );

  // FILE_UPDATED with ack
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

  // FILE_RENAMED
  socket.on(SocketEvent.FILE_RENAMED, (payload: { fileId?: string; newName?: string } = {}) => {
    const { fileId, newName } = payload;
    const roomId = getRoomId(socket.id);
    if (!roomId) return;
    socket.broadcast.to(roomId).emit(SocketEvent.FILE_RENAMED, { fileId, newName });
  });

  // FILE_DELETED
  socket.on(SocketEvent.FILE_DELETED, (payload: { fileId?: string } = {}) => {
    const { fileId } = payload;
    const roomId = getRoomId(socket.id);
    if (!roomId) return;
    socket.broadcast.to(roomId).emit(SocketEvent.FILE_DELETED, { fileId });
  });

  // USER_OFFLINE
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

  // USER_ONLINE
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

  // SEND_MESSAGE
  socket.on(SocketEvent.SEND_MESSAGE, (payload: { message?: any } = {}) => {
    const { message } = payload;
    const roomId = getRoomId(socket.id);
    if (!roomId) return;
    socket.broadcast.to(roomId).emit(SocketEvent.RECEIVE_MESSAGE, { message });
  });

  // TYPING_START
  socket.on(SocketEvent.TYPING_START, (payload: { cursorPosition?: number } = {}) => {
    const { cursorPosition } = payload;
    userSocketMap = userSocketMap.map((user) => {
      if (user.socketId === socket.id) {
        return { ...user, typing: true, cursorPosition: cursorPosition ?? user.cursorPosition };
      }
      return user;
    });
    const user = getUserBySocketId(socket.id);
    if (!user) return;
    const roomId = user.roomId;
    socket.broadcast.to(roomId).emit(SocketEvent.TYPING_START, { user });
  });

  // TYPING_PAUSE
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

  // REQUEST_DRAWING
  socket.on(SocketEvent.REQUEST_DRAWING, () => {
    const roomId = getRoomId(socket.id);
    if (!roomId) return;
    socket.broadcast.to(roomId).emit(SocketEvent.REQUEST_DRAWING, { socketId: socket.id });
  });

  // SYNC_DRAWING -> target specific socket via io.to
  socket.on(SocketEvent.SYNC_DRAWING, (payload: { drawingData?: any; socketId?: string } = {}) => {
    const { drawingData, socketId } = payload;
    if (!socketId) return;
    io.to(socketId).emit(SocketEvent.SYNC_DRAWING, { drawingData });
  });

  // DRAWING_UPDATE
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
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

server.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
