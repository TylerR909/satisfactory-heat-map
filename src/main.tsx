import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { loadWasmEngine } from "@/lib/wasm/loadEngine";
import App from "./App";
import "./index.css";

async function boot() {
  const el = document.getElementById("root");
  if (!el) throw new Error("root element missing");

  try {
    await loadWasmEngine();
  } catch (e) {
    console.error(e);
    el.innerHTML = `<pre style="padding:1rem;color:#fca5a5;background:#0f172a">WASM engine failed to load.
Run: npm run wasm:build
Then reload.

${e instanceof Error ? e.message : String(e)}</pre>`;
    return;
  }

  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
