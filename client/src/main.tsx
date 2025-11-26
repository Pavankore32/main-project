// client/src/main.tsx
import ReactDOM from "react-dom/client";
import { useEffect, useState, useCallback } from "react";
import AppProvider from "./context/AppProvider";
import "@/styles/global.css";

import socket, { joinRoom, onFileCreated, offFileCreated, emitFileCreate } from "./socket-wrapper";

;(window as any).socket = socket;

type RequestType = "edit" | "delete" | "both";
type PermissionRequestPayload = {
  fileId: string;
  requester: string;
  requestType: RequestType;
  message?: string;
};

;(window as any).showPermissionRequestModal = function (payload: PermissionRequestPayload) {
  const { fileId, requester, requestType, message } = payload;
  const allow = confirm(
    `${requester} wants ${requestType} access to file: ${fileId}\n\n` +
      `Message: ${message || "(no message)"}\n\n` +
      `Do you approve?`
  );

  if (allow) {
    socket.emit("grant-permission", {
      fileId,
      targetUsername: requester,
      perms: {
        canEdit: requestType === "edit" || requestType === "both",
        canDelete: requestType === "delete" || requestType === "both",
      },
    });
    alert(`You granted ${requestType} access to ${requester}.`);
  } else {
    socket.emit("deny-permission", {
      fileId,
      targetUsername: requester,
    });
    alert(`You denied permission to ${requester}.`);
  }
};

// A simple Root that demonstrates join + create file + listen
function Root() {
  const [roomId, setRoomId] = useState("room-1");
  const [joined, setJoined] = useState(false);
  const [files, setFiles] = useState<any[]>([]);

  useEffect(() => {
    // ensure we join on connect
    const tryJoin = async () => {
      if (!socket.connected) {
        socket.on("connect", async () => {
          console.log("[client] socket connected", socket.id);
          const ack = await joinRoom(roomId, "pavan");
          if (ack.ok) {
            setJoined(true);
            if (Array.isArray(ack.files)) setFiles(ack.files);
          } else {
            console.warn("join failed:", ack.reason);
            alert("Failed to join room: " + ack.reason);
          }
        });
      } else {
        const ack = await joinRoom(roomId, "pavan");
        if (ack.ok) {
          setJoined(true);
          if (Array.isArray(ack.files)) setFiles(ack.files);
        }
      }
    };

    tryJoin();

    const onCreated = (payload: any) => {
      if (payload && payload.file) {
        setFiles((prev) => {
          const exists = prev.some((f) => f.id === payload.file.id);
          if (exists) return prev;
          return [...prev, payload.file];
        });
      } else {
        console.warn("file-created payload malformed", payload);
      }
    };

    onFileCreated(onCreated);
    return () => {
      offFileCreated();
    };
  }, [roomId]);

  const createFile = useCallback(() => {
    const newFile = {
      id: String(Date.now()),
      name: "New file " + Date.now(),
      content: "Hello world",
      ownerId: socket.id,
    };

    emitFileCreate(roomId, newFile);

    // local optimistic update (server may also broadcast to sender)
    setFiles((prev) => {
      const exists = prev.some((f) => f.id === newFile.id);
      if (exists) return prev;
      return [...prev, newFile];
    });
  }, [roomId]);

  return (
    <div style={{ padding: 20 }}>
      <h2>Collab Room: {roomId}</h2>
      <div style={{ marginBottom: 12 }}>
        <label>
          Room:
          <input value={roomId} onChange={(e) => setRoomId(e.target.value)} style={{ marginLeft: 8 }} />
        </label>
        <button style={{ marginLeft: 8 }} onClick={() => window.location.reload()}>
          Join
        </button>
      </div>

      <div>
        <button onClick={createFile} disabled={!joined}>
          Create File
        </button>
      </div>

      <h3>Files</h3>
      <ul>
        {files.map((f) => (
          <li key={f.id}>
            {f.name} — owner: {f.ownerId}
          </li>
        ))}
      </ul>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <AppProvider>
    <Root />
  </AppProvider>
);
