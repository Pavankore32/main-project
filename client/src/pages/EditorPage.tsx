import SplitterComponent from "@/components/SplitterComponent";
import ConnectionStatusPage from "@/components/connection/ConnectionStatusPage";
import Sidebar from "@/components/sidebar/Sidebar";
import WorkSpace from "@/components/workspace";
import { useAppContext } from "@/context/AppContext";
import { useSocket } from "@/context/SocketContext";
import useFullScreen from "@/hooks/useFullScreen";
import useUserActivity from "@/hooks/useUserActivity";
import { SocketEvent } from "@/types/socket";
import { USER_STATUS, User } from "@/types/user";
import { useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

/**
 * EditorPage (enhanced):
 * - uses server ACK on join so client receives { ok, user, users, files }
 * - subscribes to FILE_CREATED, PERMISSION_UPDATED, PERMISSION_REVOKED, TYPING_* events
 * - publishes initial files & subsequent file-created events onto `window` so WorkSpace or Sidebar
 *   can consume them without further changes.
 *
 * NOTE: If you prefer to update WorkSpace directly, I can patch WorkSpace to subscribe to socket directly.
 */

function EditorPage() {
  // Listen user online/offline status
  useUserActivity();
  // Enable fullscreen mode
  useFullScreen();

  const navigate = useNavigate();
  const { roomId } = useParams();
  const { status, setCurrentUser, currentUser } = useAppContext();
  const { socket } = useSocket();
  const location = useLocation();

  useEffect(() => {
    // If user already set (hot reload / navigation) don't re-join
    if (currentUser && currentUser.username && currentUser.username.length > 0) return;

    const usernameFromState = location.state?.username;
    const usernameToUse = usernameFromState ?? (localStorage.getItem("cs_username") || undefined);

    if (!usernameToUse) {
      // No username => send back to home to collect username
      navigate("/", {
        state: { roomId },
      });
      return;
    }

    if (!roomId) {
      // no room in params: navigate home
      navigate("/");
      return;
    }

    const user: User = { username: usernameToUse, roomId };

    // Save current user in app context
    setCurrentUser(user);

    // Use socket ack callback to wait for server join confirmation and initial files
    socket.emit(
      SocketEvent.JOIN_REQUEST,
      user,
      // acknowledgement callback (server will call this with { ok, user, users, files })
      (ack: { ok: boolean; user?: any; users?: any[]; files?: any[]; reason?: string }) => {
        console.log("[EditorPage] join ack:", ack);
        if (!ack || !ack.ok) {
          // join failed: show connection error or navigate back
          console.warn("Join request failed:", ack?.reason);
          // navigate back to home to allow retry
          navigate("/", { state: { roomId } });
          return;
        }

        // Persist username locally so reload retains it (optional)
        try {
          localStorage.setItem("cs_username", user.username);
          localStorage.setItem("cs_roomId", user.roomId);
        } catch (e) {
          // ignore storage errors
        }

        // If server sent the current files, place them on window for WorkSpace to consume.
        // This is a non-invasive way to pass initial state to existing components without deep changes.
        if (Array.isArray(ack.files)) {
          ;(window as any).initialRoomFiles = ack.files;
          // dispatch an event so other components can react immediately
          window.dispatchEvent(new CustomEvent("cs:initial-files", { detail: ack.files }));
        }
      }
    );

    // --- Register listeners for key events and dispatch events for internal components ---

    // FILE_CREATED listener => dispatch custom event 'cs:file-created'
    const handleFileCreated = (payload: any) => {
      console.debug("[EditorPage] file-created received:", payload);
      // normalize payload to include a `file` object for older/newer server shapes
      const file = payload?.newFile ?? payload?.file ?? null;
      if (file) {
        window.dispatchEvent(new CustomEvent("cs:file-created", { detail: file }));
      } else {
        // If server broadcasts { parentDirId, newFile }, provide that newFile too
        if (payload?.newFile) window.dispatchEvent(new CustomEvent("cs:file-created", { detail: payload.newFile }));
      }
    };
    socket.on(SocketEvent.FILE_CREATED, handleFileCreated);

    // PERMISSION_UPDATED => dispatch 'cs:permission-updated'
    const handlePermissionUpdated = (payload: any) => {
      console.debug("[EditorPage] permission-updated", payload);
      window.dispatchEvent(new CustomEvent("cs:permission-updated", { detail: payload }));
    };
    socket.on("permission-updated", handlePermissionUpdated);

    // PERMISSION_REVOKED
    const handlePermissionRevoked = (payload: any) => {
      console.debug("[EditorPage] permission-revoked", payload);
      window.dispatchEvent(new CustomEvent("cs:permission-revoked", { detail: payload }));
    };
    socket.on("permission-revoked", handlePermissionRevoked);

    // TYPING presence: server broadcasts TYPING_START / TYPING_PAUSE with user info
    const handleTypingStart = (payload: any) => {
      // payload.user expected (or payload.username)
      window.dispatchEvent(new CustomEvent("cs:typing-start", { detail: payload }));
    };
    const handleTypingPause = (payload: any) => {
      window.dispatchEvent(new CustomEvent("cs:typing-pause", { detail: payload }));
    };
    socket.on(SocketEvent.TYPING_START, handleTypingStart);
    socket.on(SocketEvent.TYPING_PAUSE, handleTypingPause);

    // Clean up listeners on unmount
    return () => {
      try {
        socket.off(SocketEvent.FILE_CREATED, handleFileCreated);
        socket.off("permission-updated", handlePermissionUpdated);
        socket.off("permission-revoked", handlePermissionRevoked);
        socket.off(SocketEvent.TYPING_START, handleTypingStart);
        socket.off(SocketEvent.TYPING_PAUSE, handleTypingPause);
      } catch (e) {
        // ignore errors on cleanup
      }
    };
    // We intentionally depend on socket, setCurrentUser, navigate, roomId
  }, [currentUser.username, location.state?.username, navigate, roomId, setCurrentUser, socket]);

  if (status === USER_STATUS.CONNECTION_FAILED) {
    return <ConnectionStatusPage />;
  }

  return (
    <SplitterComponent>
      <Sidebar />
      <WorkSpace />
    </SplitterComponent>
  );
}

export default EditorPage;
