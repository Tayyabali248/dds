// Must match host_permissions in both manifest.chrome.json and
// manifest.firefox.json, and the running dds/server.js instance's PORT.
//
// Using the desktop's LAN IP (not "localhost") so this also works from a
// phone on the same Wi-Fi network, where "localhost" would mean the phone
// itself. If this machine's IP changes (different network, DHCP renewal),
// update this and both manifests' host_permissions, then rebuild.
export const BACKEND_URL = 'https://dds-jade-five.vercel.app';
