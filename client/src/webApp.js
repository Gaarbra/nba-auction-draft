let pendingInstall = null;
export const canPromptInstall = () => Boolean(pendingInstall);
export const isAppInstalled = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

export function setupWebApp() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    pendingInstall = event;
  });
  window.addEventListener("appinstalled", () => { pendingInstall = null; });
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL, updateViaCache: "none" }).catch(() => {});
    }, { once: true });
  }
}

export async function promptInstall() {
  const event = pendingInstall;
  if (!event) return false;
  pendingInstall = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === "accepted";
}
