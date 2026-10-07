(() => {
  "use strict";

  const KEY = "madhavaWellnessV33";
  const API = "/api/state";
  const LOCAL_STAMP_KEY = KEY + "_cloud_local_updated_at";
  const CLOUD_STAMP_KEY = KEY + "_cloud_last_remote_updated_at";

  let suppressLocalSync = false;
  let saveTimer = null;
  let syncBusy = false;
  let localDirtyAt = Number(localStorage.getItem(LOCAL_STAMP_KEY) || 0);
  let lastRemoteAt = Date.parse(localStorage.getItem(CLOUD_STAMP_KEY) || "") || 0;

  const nativeSetItem = Storage.prototype.setItem;

  function notifySafe(message) {
    try {
      if (typeof notify === "function") notify(message);
    } catch (_) {}
  }

  function stateFromStorage(value) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : null;
    } catch (_) {
      return null;
    }
  }

  function scheduleUpload(value) {
    if (suppressLocalSync) return;

    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      uploadState(value).catch(() => {});
    }, 800);
  }

  async function uploadState(value) {
    const state = stateFromStorage(value);
    if (!state || syncBusy) return;

    syncBusy = true;
    try {
      const response = await fetch(API, {
        method: "PUT",
        headers: {
          "content-type": "application/json"
        },
        cache: "no-store",
        body: JSON.stringify(state)
      });

      if (!response.ok) throw new Error("Cloud save failed: " + response.status);

      const result = await response.json();
      const remoteAt = Date.parse(result.updated_at || "") || Date.now();

      lastRemoteAt = remoteAt;
      localDirtyAt = 0;

      localStorage.setItem(CLOUD_STAMP_KEY, new Date(remoteAt).toISOString());
      console.log("[FIT MAD] Cloud save complete", result.updated_at);
    } catch (error) {
      console.warn("[FIT MAD] Cloud save unavailable; local data remains safe.", error);
    } finally {
      syncBusy = false;
    }
  }

  async function readCloud() {
    const response = await fetch(API, {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) throw new Error("Cloud read failed: " + response.status);
    return response.json();
  }

  function applyCloudState(state, updatedAt) {
    if (!state || typeof state !== "object") return;

    suppressLocalSync = true;

    try {
      db = state;

      nativeSetItem.call(
        localStorage,
        KEY,
        JSON.stringify(state)
      );

      const ts = Date.parse(updatedAt || "") || Date.now();
      lastRemoteAt = ts;
      localDirtyAt = 0;

      nativeSetItem.call(
        localStorage,
        CLOUD_STAMP_KEY,
        new Date(ts).toISOString()
      );

      if (typeof applyTheme === "function") applyTheme();
      if (typeof applyDevice === "function") applyDevice();
      if (typeof render === "function") render();
    } finally {
      suppressLocalSync = false;
    }
  }

  async function syncNow(initial = false) {
    try {
      const remote = await readCloud();

      if (!remote.state) {
        const localValue = localStorage.getItem(KEY);
        if (localValue) {
          await uploadState(localValue);
          notifySafe("FIT MAD cloud backup enabled");
        }
        return;
      }

      const remoteAt = Date.parse(remote.updated_at || "") || 0;

      if (localDirtyAt && localDirtyAt > remoteAt) {
        await uploadState(localStorage.getItem(KEY));
        return;
      }

      if (initial || remoteAt > lastRemoteAt) {
        applyCloudState(remote.state, remote.updated_at);
        notifySafe("FIT MAD synced from cloud");
      }
    } catch (error) {
      console.warn("[FIT MAD] Cloud sync unavailable; using local data.", error);
    }
  }

  Storage.prototype.setItem = function (key, value) {
    nativeSetItem.call(this, key, value);

    if (this === localStorage && key === KEY && !suppressLocalSync) {
      localDirtyAt = Date.now();
      nativeSetItem.call(
        localStorage,
        LOCAL_STAMP_KEY,
        String(localDirtyAt)
      );
      scheduleUpload(value);
    }
  };

  window.FIT_MAD_CLOUD = {
    syncNow,
    upload: () => uploadState(localStorage.getItem(KEY))
  };

  window.addEventListener("online", () => {
    syncNow(false).catch(() => {});
  });

  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      syncNow(false).catch(() => {});
    }
  });

  setInterval(() => {
    if (!document.hidden) syncNow(false).catch(() => {});
  }, 15000);

  syncNow(true).catch(() => {});
})();
