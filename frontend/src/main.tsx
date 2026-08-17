import "./index.css";
import { initializeMsalBeforeReact } from "./lib/microsoftAuth";

async function start() {
  // Start the app chunks downloading immediately. Previously this waited for MSAL
  // to finish two network round-trips to Microsoft first, so the 600 kB app bundle
  // only began downloading once sign-in had already completed — the two slowest
  // steps ran back to back instead of together.
  const appReady = Promise.all([
    import("react-dom/client"),
    import("./App.tsx"),
  ]);

  // Must still finish before React mounts: MSAL has to read the redirect response
  // out of the URL before BrowserRouter rewrites it.
  await initializeMsalBeforeReact();

  const [{ createRoot }, { default: App }] = await appReady;
  createRoot(document.getElementById("root")!).render(<App />);
}

void start();
