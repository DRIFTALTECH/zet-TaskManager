import "./index.css";
import { initializeMsalBeforeReact } from "./lib/microsoftAuth";

async function start() {
  await initializeMsalBeforeReact();
  const [{ createRoot }, { default: App }] = await Promise.all([
    import("react-dom/client"),
    import("./App.tsx"),
  ]);
  createRoot(document.getElementById("root")!).render(<App />);
}

void start();
