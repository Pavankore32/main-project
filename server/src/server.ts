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
    cors: { origin: "*" },
    maxHttpBufferSize: 1e8,
    pingTimeout: 60000,
})

/* --------------------------------------
        USER STORAGE
---------------------------------------- */
let userSocketMap: User[] = []

function getUsersInRoom(roomId: string): User[] {
    return userSocketMap.filter((u) => u.roomId === roomId)
}

function getRoomId(socketId: SocketId): string | null {
    return userSocketMap.find((u) => u.socketId === socketId)?.roomId ?? null
}

function getUserBySocketId(socketId: SocketId): User | null {
    return userSocketMap.find((u) => u.socketId === socketId) ?? null
}

/* --------------------------------------
     FILE OWNERSHIP + PERMISSIONS
---------------------------------------- */

const fileOwners: Record<string, string> = {}   // fileId → owner username
const filePermissions: Record<
    string,
    Record<string, { canEdit: boolean; canDelete: boolean }>
> = {}

function setOwner(fileId: string, username: string) {
    if (!fileId) return
    fileOwners[fileId] = username

    if (!filePermissions[fileId]) filePermissions[fileId] = {}

    filePermissions[fileId][username] = {
        canEdit: true,
        canDelete: true,
    }
}

function isOwner(socket: Socket, fileId: string): boolean {
    const user = getUserBySocketId(socket.id)
    if (!user) return false
    return fileOwners[fileId] === user.username
}

function hasEditPermission(socket: Socket, fileId: string): boolean {
    const user = getUserBySocketId(socket.id)
    if (!user) return false
    return !!filePermissions[fileId]?.[user.username]?.canEdit
}

function hasDeletePermission(socket: Socket, fileId: string): boolean {
    const user = getUserBySocketId(socket.id)
    if (!user) return false
    return !!filePermissions[fileId]?.[user.username]?.canDelete
}

/* --------------------------------------
        SOCKET EVENTS
---------------------------------------- */

io.on("connection", (socket) => {

    /* JOIN ROOM */
    socket.on(SocketEvent.JOIN_REQUEST, ({ roomId, username }) => {
        const exists = getUsersInRoom(roomId).some(
            (u) => u.username === username
        )

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
      PERMISSION REQUEST SYSTEM (STRICT)
    ---------------------------------------- */

    socket.on("request-permission", ({ fileId, requestType, message }) => {
        const requester = getUserBySocketId(socket.id)
        if (!requester) return

        const ownerUsername = fileOwners[fileId]
        if (!ownerUsername) {
            io.to(socket.id).emit("permission-error", {
                reason: "owner-not-found",
            })
            return
        }

        const owner = userSocketMap.find(
            (u) => u.username === ownerUsername && u.roomId === requester.roomId
        )

        if (!owner) {
            io.to(socket.id).emit("permission-error", {
                reason: "owner-offline",
            })
            return
        }

        io.to(owner.socketId).emit("permission-request", {
            fileId,
            requester: requester.username,
            requestType,
            message,
        })

        io.to(socket.id).emit("permission-request-sent", {
            fileId,
            owner: ownerUsername,
        })
    })

    socket.on("grant-permission", ({ fileId, targetUsername, perms }) => {
        if (!isOwner(socket, fileId)) {
            io.to(socket.id).emit("permission-denied", {
                action: "grant-permission",
            })
            return
        }

        if (!filePermissions[fileId]) filePermissions[fileId] = {}

        filePermissions[fileId][targetUsername] = {
            canEdit: !!perms.canEdit,
            canDelete: !!perms.canDelete,
        }

        const target = userSocketMap.find(
            (u) => u.username === targetUsername
        )

        if (target) {
            io.to(target.socketId).emit("permission-updated", {
                fileId,
                perms,
                owner: fileOwners[fileId],
            })
        }

        io.to(socket.id).emit("grant-confirmation", {
            fileId,
            targetUsername,
            perms,
        })
    })

    socket.on("revoke-permission", ({ fileId, targetUsername }) => {
        if (!isOwner(socket, fileId)) return

        if (filePermissions[fileId]) {
            delete filePermissions[fileId][targetUsername]
        }

        const target = userSocketMap.find((u) => u.username === targetUsername)
        if (target) {
            io.to(target.socketId).emit("permission-revoked", { fileId })
        }

        io.to(socket.id).emit("revoke-confirmation", {
            fileId,
            targetUsername,
        })
    })

    /* --------------------------------------
            FILE EVENTS
    ---------------------------------------- */

    socket.on(SocketEvent.FILE_CREATED, ({ parentDirId, newFile }) => {
        const user = getUserBySocketId(socket.id)
        if (!user) return

        if (newFile?.id) {
            setOwner(newFile.id, user.username)
        }

        socket.broadcast
            .to(user.roomId)
            .emit(SocketEvent.FILE_CREATED, { parentDirId, newFile })
    })

    socket.on(SocketEvent.FILE_UPDATED, ({ fileId, newContent }) => {
        if (!hasEditPermission(socket, fileId)) {
            io.to(socket.id).emit("permission-denied", {
                action: SocketEvent.FILE_UPDATED,
                fileId,
            })
            return
        }

        const roomId = getRoomId(socket.id)
        socket.broadcast.to(roomId!).emit(SocketEvent.FILE_UPDATED, {
            fileId,
            newContent,
        })
    })

    socket.on(SocketEvent.FILE_DELETED, ({ fileId }) => {
        if (!hasDeletePermission(socket, fileId)) {
            io.to(socket.id).emit("permission-denied", {
                action: SocketEvent.FILE_DELETED,
                fileId,
            })
            return
        }

        const roomId = getRoomId(socket.id)
        socket.broadcast.to(roomId!).emit(SocketEvent.FILE_DELETED, { fileId })
    })

    /* --------------------------------------
        (UNCHANGED) MESSAGES / CURSOR / DRAW
    ---------------------------------------- */

    socket.on(SocketEvent.SEND_MESSAGE, ({ message }) => {
        const roomId = getRoomId(socket.id)
        if (!roomId) return
        socket.broadcast.to(roomId).emit(SocketEvent.RECEIVE_MESSAGE, { message })
    })

    socket.on(SocketEvent.TYPING_START, ({ cursorPosition }) => {
        const user = getUserBySocketId(socket.id)
        if (!user) return
        socket.broadcast.to(user.roomId).emit(SocketEvent.TYPING_START, { user })
    })

    socket.on(SocketEvent.TYPING_PAUSE, () => {
        const user = getUserBySocketId(socket.id)
        if (!user) return
        socket.broadcast.to(user.roomId).emit(SocketEvent.TYPING_PAUSE, { user })
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
