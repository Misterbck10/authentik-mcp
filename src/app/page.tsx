import type { CSSProperties } from "react";
import { pingAuthentik } from "@/lib/authentik/health";
import { getEnv, type Env } from "@/lib/config/env";

export const dynamic = "force-dynamic";

// Public page: shows only connected/disconnected, never the failure reason.
async function serverStatus(): Promise<{ env: Env | null; connected: boolean }> {
  let env: Env;
  try {
    env = getEnv();
  } catch {
    return { env: null, connected: false };
  }
  const health = await pingAuthentik();
  return { env, connected: health.ok };
}

const green = "#5f7f68";

const card: CSSProperties = {
  background: "#ffffff",
  borderRadius: "16px",
  padding: "2.5rem 3rem",
  textAlign: "center",
  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.15)",
  maxWidth: "22rem",
  width: "100%",
};

const button: CSSProperties = {
  display: "inline-block",
  marginTop: "1.5rem",
  padding: "0.7rem 1.6rem",
  borderRadius: "8px",
  background: green,
  color: "#ffffff",
  textDecoration: "none",
  fontWeight: 600,
};

export default async function Home() {
  const { env, connected } = await serverStatus();
  return (
    <main style={card}>
      <h1 style={{ margin: 0, fontSize: "1.6rem", color: "#23332a" }}>authentik MCP</h1>
      <p style={{ margin: "1rem 0 0", fontSize: "1.05rem", color: "#4a5a50" }}>
        Status:{" "}
        <strong style={{ color: connected ? green : "#a94442" }}>
          {connected ? "Connected" : "Disconnected"}
        </strong>
      </p>
      {env?.MCP_HOME_LINK_URL && (
        <a href={env.MCP_HOME_LINK_URL} style={button} rel="noopener noreferrer">
          {env.MCP_HOME_LINK_LABEL}
        </a>
      )}
    </main>
  );
}
