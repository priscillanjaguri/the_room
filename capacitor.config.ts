import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.gleam.room",
  appName: "The room",
  webDir: "dist",
  backgroundColor: "#0b0d10",
  android: {
    backgroundColor: "#0b0d10",
  },
  plugins: {
    // Light status-bar icons on the dark room.
    SystemBars: { style: "DARK", initialViewportFitValueHint: "cover" },
  },
};

export default config;
