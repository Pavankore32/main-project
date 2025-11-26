// client/src/components/workspace/index.tsx
import { useAppContext } from "@/context/AppContext";
import useResponsive from "@/hooks/useResponsive";
import { ACTIVITY_STATE } from "@/types/app";
import DrawingEditor from "../drawing/DrawingEditor";
import EditorComponent from "../editor/EditorComponent";
import { useEffect } from "react";

function ensureGlobalRooms() {
  if (!(window as any).roomFiles) (window as any).roomFiles = [];
}

function WorkSpace() {
  const { viewHeight } = useResponsive();
  const { activityState } = useAppContext();

  useEffect(() => {
    ensureGlobalRooms();

    const onInitialFiles = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail;
        if (Array.isArray(detail)) {
          (window as any).roomFiles = detail.slice();
        }
        window.dispatchEvent(new CustomEvent("workspace:files-changed", { detail: (window as any).roomFiles }));
      } catch (err) {
        console.warn("workspace: failed to process cs:initial-files", err);
      }
    };

    const onFileCreated = (e: Event) => {
      try {
        const detail = (e as CustomEvent).detail;
        const file = detail?.newFile ?? detail?.file ?? detail;
        if (!file || !file.id) return;
        ensureGlobalRooms();
        const files = (window as any).roomFiles as any[];
        if (!files.some((f) => f.id === file.id)) {
          files.push(file);
          window.dispatchEvent(new CustomEvent("workspace:files-changed", { detail: files }));
        }
      } catch (err) {
        console.warn("workspace: failed to process cs:file-created", err);
      }
    };

    window.addEventListener("cs:initial-files", onInitialFiles as EventListener);
    window.addEventListener("cs:file-created", onFileCreated as EventListener);

    const socket = (window as any).socket;
    const socketHandler = (payload: any) => {
      const file = payload?.newFile ?? payload?.file ?? payload;
      if (!file || !file.id) return;
      ensureGlobalRooms();
      const files = (window as any).roomFiles as any[];
      if (!files.some((f) => f.id === file.id)) {
        files.push(file);
        window.dispatchEvent(new CustomEvent("workspace:files-changed", { detail: files }));
      }
    };

    if (socket && typeof socket.on === "function") {
      socket.on("file-created", socketHandler);
    }

    return () => {
      window.removeEventListener("cs:initial-files", onInitialFiles as EventListener);
      window.removeEventListener("cs:file-created", onFileCreated as EventListener);
      if (socket && typeof socket.off === "function") {
        socket.off("file-created", socketHandler);
      }
    };
  }, []);

  return (
    <div
      className="absolute left-0 top-0 w-full max-w-full flex-grow overflow-x-hidden md:static"
      style={{ height: viewHeight }}
    >
      {activityState === ACTIVITY_STATE.DRAWING ? <DrawingEditor /> : <EditorComponent />}
    </div>
  );
}

export default WorkSpace;
