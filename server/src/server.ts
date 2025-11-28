import express, { Response, Request } from "express"
import dotenv from "dotenv"
import http from "http"
import cors from "cors"
import { SocketEvent, SocketId } from "./types/socket"
import { USER_CONNECTION_STATUS, User } from "./types/user"
import { Server, Socket } from "socket.io"
import path from "path"

dotenv.config()

const app = express()

app.use(express.json())
app.use(cors())
app.use(express.static(path.join(__dirname, "public")))

const server = http.createServer(app)
const io = new Server(server, {
	cors: {
		origin: "*",
	},
	maxHttpBufferSize: 1e8,
	pingTimeout: 60000,
})

/* --------------------------------------
        USER STORAGE
---------------------------------------- */
let userSocketMap: User[] = []

function getUsersInRoom(roomId: string): User[] {
	return userSocketMap.filter((user) => user.roomId === roomId)
}

function getRoomId(socketId: SocketId): string | null {
	const user = userSocketMap.find((u) => u.socketId === socketId)
	return user?.roomId ?? null
}

function getUserBySocketId(socketId: SocketId): User | null {
	return userSocketMap.find((u) => u.socketId === socketId) ?? null
}

/* --------------------------------------
        PERMISSION SYSTEM
---------------------------------------- */

// Map: fileId / dirId → { username → { canEdit, canDelete } }
const filePermissions: Record<
	string,
	Record<string, { canEdit: boolean; canDelete: boolean }>
> = {}

// Give the creator permission for new file/directory
function givePermission(resourceId: string, username: string) {
	if (!resourceId) return
	if (!filePermissions[resourceId]) filePermissions[resourceId] = {}
	filePermissions[resourceId][username] = { canEdit: true, canDelete: true }
}

function checkEdit(socket: Socket, resourceId: string): boolean {
	const user = getUserBySocketId(socket.id)
	if (!user) return false
	return !!filePermissions[resourceId]?.[user.username]?.canEdit
}

function checkDelete(socket: Socket, resourceId: string): boolean {
	const user = getUserBySocketId(socket.id)
	if (!user) return false
	return !!filePermissions[resourceId]?.[user.username]?.canDelete
}

/* --------------------------------------
        SOCKET EVENTS
---------------------------------------- */
io.on("connection", (socket) => {

	/* JOIN ROOM */
	socket.on(SocketEvent.JOIN_REQUEST, ({ roomId, username }) => {
		const exists = getUsersInRoom(roomId).some((u) => u.username === username)
		if (exists) {
			io.to(socket.id).emit(SocketEvent.USERNAME_EXISTS)
			return
		}

		const newUser: User = {
			username,
			roomId,
			status: USER_CONNECTION_STATUS.ONLINE,
			cursorPosition: 0,
			typing: false,
			socketId: socket.id,
			currentFile: null,
		}

		userSocketMap.push(newUser)
		socket.join(roomId)

		socket.broadcast.to(roomId).emit(SocketEvent.USER_JOINED, { user: newUser })

		io.to(socket.id).emit(SocketEvent.JOIN_ACCEPTED, {
			user: newUser,
			users: getUsersInRoom(roomId),
		})
	})

	/* DISCONNECT */
	socket.on("disconnecting", () => {
		const user = getUserBySocketId(socket.id)
		if (!user) return

		const roomId = user.roomId
		socket.broadcast.to(roomId).emit(SocketEvent.USER_DISCONNECTED, { user })

		userSocketMap = userSocketMap.filter((u) => u.socketId !== socket.id)
	})

	/* --------------------------------------
	        FILE STRUCTURE SYNC
	---------------------------------------- */
	socket.on(
		SocketEvent.SYNC_FILE_STRUCTURE,
		({ fileStructure, openFiles, activeFile, socketId }) => {
			io.to(socketId).emit(SocketEvent.SYNC_FILE_STRUCTURE, {
				fileStructure,
				openFiles,
				activeFile,
			})
		}
	)

	/* --------------------------------------
	        DIRECTORY EVENTS
	---------------------------------------- */

	socket.on(SocketEvent.DIRECTORY_CREATED, ({ parentDirId, newDirectory }) => {
		const roomId = getRoomId(socket.id)
		if (!roomId) return

		const user = getUserBySocketId(socket.id)
		if (user && newDirectory?.id) givePermission(newDirectory.id, user.username)

		socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_CREATED, {
			parentDirId,
			newDirectory,
		})
	})

	socket.on(SocketEvent.DIRECTORY_UPDATED, ({ dirId, children }) => {
		const roomId = getRoomId(socket.id)
		if (!roomId) return

		if (!checkEdit(socket, dirId)) {
			io.to(socket.id).emit("permission-denied", {
				action: SocketEvent.DIRECTORY_UPDATED,
				dirId,
			})
			return
		}

		socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_UPDATED, {
			dirId,
			children,
		})
	})

	socket.on(SocketEvent.DIRECTORY_RENAMED, ({ dirId, newName }) => {
		const roomId = getRoomId(socket.id)
		if (!roomId) return

		if (!checkEdit(socket, dirId)) {
			io.to(socket.id).emit("permission-denied", {
				action: SocketEvent.DIRECTORY_RENAMED,
				dirId,
			})
			return
		}

		socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_RENAMED, {
			dirId,
			newName,
		})
	})

	socket.on(SocketEvent.DIRECTORY_DELETED, ({ dirId }) => {
		const roomId = getRoomId(socket.id)
		if (!roomId) return

		if (!checkDelete(socket, dirId)) {
			io.to(socket.id).emit("permission-denied", {
				action: SocketEvent.DIRECTORY_DELETED,
				dirId,
			})
			return
		}

		socket.broadcast.to(roomId).emit(SocketEvent.DIRECTORY_DELETED, { dirId })
	})

	/* --------------------------------------
	        FILE EVENTS
	---------------------------------------- */

	socket.on(SocketEvent.FILE_CREATED, ({ parentDirId, newFile }) => {
		const roomId = getRoomId(socket.id)
		if (!roomId) return

		const user = getUserBySocketId(socket.id)
		if (user && newFile?.id) givePermission(newFile.id, user.username)

		socket.broadcast.to(roomId).emit(SocketEvent.FILE_CREATED, {
			parentDirId,
			newFile,
		})
	})

	socket.on(SocketEvent.FILE_UPDATED, ({ fileId, newContent }) => {
		const roomId = getRoomId(socket.id)
		if (!roomId) return

		if (!checkEdit(socket, fileId)) {
			io.to(socket.id).emit("permission-denied", {
				action: SocketEvent.FILE_UPDATED,
				fileId,
			})
			return
		}

		socket.broadcast.to(roomId).emit(SocketEvent.FILE_UPDATED, {
			fileId,
			newContent,
		})
	})

	socket.on(SocketEvent.FILE_RENAMED, ({ fileId, newName }) => {
		const roomId = getRoomId(socket.id)
		if (!roomId) return

		if (!checkEdit(socket, fileId)) {
			io.to(socket.id).emit("permission-denied", {
				action: SocketEvent.FILE_RENAMED,
				fileId,
			})
			return
		}

		socket.broadcast.to(roomId).emit(SocketEvent.FILE_RENAMED, {
			fileId,
			newName,
		})
	})

	socket.on(SocketEvent.FILE_DELETED, ({ fileId }) => {
		const roomId = getRoomId(socket.id)
		if (!roomId) return

		if (!checkDelete(socket, fileId)) {
			io.to(socket.id).emit("permission-denied", {
				action: SocketEvent.FILE_DELETED,
				fileId,
			})
			return
		}

		socket.broadcast.to(roomId).emit(SocketEvent.FILE_DELETED, { fileId })
	})

	/* --------------------------------------
	        STATUS / CHAT / DRAW EVENTS
	---------------------------------------- */

	socket.on(SocketEvent.USER_OFFLINE, ({ socketId }) => {
		userSocketMap = userSocketMap.map((u) =>
			u.socketId === socketId
				? { ...u, status: USER_CONNECTION_STATUS.OFFLINE }
				: u
		)

		const roomId = getRoomId(socketId)
		if (!roomId) return

		socket.broadcast.to(roomId).emit(SocketEvent.USER_OFFLINE, { socketId })
	})

	socket.on(SocketEvent.USER_ONLINE, ({ socketId }) => {
		userSocketMap = userSocketMap.map((u) =>
			u.socketId === socketId
				? { ...u, status: USER_CONNECTION_STATUS.ONLINE }
				: u
		)

		const roomId = getRoomId(socketId)
		if (!roomId) return

		socket.broadcast.to(roomId).emit(SocketEvent.USER_ONLINE, { socketId })
	})

	socket.on(SocketEvent.SEND_MESSAGE, ({ message }) => {
		const roomId = getRoomId(socket.id)
		if (!roomId) return

		socket.broadcast.to(roomId).emit(SocketEvent.RECEIVE_MESSAGE, { message })
	})

	socket.on(SocketEvent.TYPING_START, ({ cursorPosition }) => {
		userSocketMap = userSocketMap.map((u) =>
			u.socketId === socket.id ? { ...u, typing: true, cursorPosition } : u
		)

		const user = getUserBySocketId(socket.id)
		if (!user) return

		socket.broadcast.to(user.roomId).emit(SocketEvent.TYPING_START, { user })
	})

	socket.on(SocketEvent.TYPING_PAUSE, () => {
		userSocketMap = userSocketMap.map((u) =>
			u.socketId === socket.id ? { ...u, typing: false } : u
		)

		const user = getUserBySocketId(socket.id)
		if (!user) return

		socket.broadcast.to(user.roomId).emit(SocketEvent.TYPING_PAUSE, { user })
	})

	socket.on(SocketEvent.REQUEST_DRAWING, () => {
		const roomId = getRoomId(socket.id)
		if (!roomId) return

		socket.broadcast.to(roomId).emit(SocketEvent.REQUEST_DRAWING, {
			socketId: socket.id,
		})
	})

	socket.on(SocketEvent.SYNC_DRAWING, ({ drawingData, socketId }) => {
		socket.broadcast.to(socketId).emit(SocketEvent.SYNC_DRAWING, {
			drawingData,
		})
	})

	socket.on(SocketEvent.DRAWING_UPDATE, ({ snapshot }) => {
		const roomId = getRoomId(socket.id)
		if (!roomId) return

		socket.broadcast.to(roomId).emit(SocketEvent.DRAWING_UPDATE, { snapshot })
	})
})

/* --------------------------------------
	    EXPRESS ROUTE
---------------------------------------- */
const PORT = process.env.PORT || 3000

app.get("/", (req: Request, res: Response) => {
	res.sendFile(path.join(__dirname, "..", "public", "index.html"))
})

server.listen(PORT, () => {
	console.log(`Listening on port ${PORT}`)
})
