import {
  TOKEN_KEY,
  SPACETIME_DB,
  SPACETIME_URI,
} from "../spacetime/connection";
import { expiryKey, renewKey } from "../spacetime/visitRenewal";
function download(data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "berigame-character-recovery.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function exportRecovery() {
  const response = await fetch("/api/play/v1/recovery", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${localStorage.getItem(renewKey(TOKEN_KEY)) ?? ""}`,
    },
    body: JSON.stringify({ token: localStorage.getItem(TOKEN_KEY) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error?.message ?? "Recovery export is unavailable on this server",
    );
  download({ ...data, uri: SPACETIME_URI, database: SPACETIME_DB });
}
export async function restoreRecovery(file: File) {
  const saved = JSON.parse(await file.text());
  if (
    saved.uri !== SPACETIME_URI ||
    saved.database !== SPACETIME_DB ||
    !/^bgk_[A-Za-z0-9_-]{43}$/.test(saved.recoveryToken ?? "")
  )
    throw new Error("Choose a recovery file for this world");
  const response = await fetch("/api/play/v1/recover", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${saved.recoveryToken}`,
    },
    body: "{}",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? "Recovery failed");
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(renewKey(TOKEN_KEY), data.renewToken);
  localStorage.setItem(expiryKey(TOKEN_KEY), "0");
  download({
    recoveryToken: data.recoveryToken,
    uri: SPACETIME_URI,
    database: SPACETIME_DB,
    playerId: data.playerId,
    expiresAt: data.expiresAt,
  });
  location.reload();
}
