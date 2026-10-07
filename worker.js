const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

async function ensureSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS fit_mad_state (
      id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}

async function api(request, env) {
  const url = new URL(request.url);

  if (!env.DB) {
    return json({ ok: false, error: "D1 binding DB is not available." }, 500);
  }

  await ensureSchema(env.DB);

  if (url.pathname === "/api/health" && request.method === "GET") {
    await env.DB.prepare("SELECT 1").run();
    return json({ ok: true, database: "fit-mad-db" });
  }

  if (url.pathname === "/api/state" && request.method === "GET") {
    const row = await env.DB
      .prepare("SELECT state_json, updated_at FROM fit_mad_state WHERE id = ?1")
      .bind("default")
      .first();

    if (!row) {
      return json({ ok: true, state: null, updated_at: null });
    }

    let state;
    try {
      state = JSON.parse(row.state_json);
    } catch {
      return json({ ok: false, error: "Stored FIT MAD state is invalid JSON." }, 500);
    }

    return json({
      ok: true,
      state,
      updated_at: row.updated_at
    });
  }

  if (url.pathname === "/api/state" && request.method === "PUT") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON body." }, 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json({ ok: false, error: "State must be a JSON object." }, 400);
    }

    const stateJson = JSON.stringify(body);

    if (stateJson.length > 900000) {
      return json({ ok: false, error: "FIT MAD state is too large." }, 413);
    }

    const now = new Date().toISOString();

    await env.DB
      .prepare(`
        INSERT INTO fit_mad_state (id, state_json, updated_at)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(id) DO UPDATE SET
          state_json = excluded.state_json,
          updated_at = excluded.updated_at
      `)
      .bind("default", stateJson, now)
      .run();

    return json({ ok: true, updated_at: now });
  }

  return json({ ok: false, error: "Endpoint not found." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname.startsWith("/api/")) {
        return await api(request, env);
      }

      const assetResponse = await env.ASSETS.fetch(request);
      const contentType = assetResponse.headers.get("content-type") || "";

      if (contentType.includes("text/html")) {
        return new HTMLRewriter()
          .on("body", {
            element(element) {
              element.append(
                '<script src="/cloud-sync.js" defer></script>',
                { html: true }
              );
            }
          })
          .transform(assetResponse);
      }

      return assetResponse;
    } catch (error) {
      console.error("FIT MAD Worker error", error);
      return new Response("FIT MAD service error", { status: 500 });
    }
  }
};
