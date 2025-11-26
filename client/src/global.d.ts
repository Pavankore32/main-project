// client/src/global.d.ts
// Tell TypeScript that these local modules exist even if no .d.ts types are present.
// This avoids TS2307 "Cannot find module" errors during Render build.

declare module "./socket";
declare module "./socket.ts";
declare module "@/socket";
