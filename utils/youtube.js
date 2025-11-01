// utils/youtube.js
export function extractYouTubeId(input) {
  if (!input) return null;

  try {
    // Accept plain IDs
    if (/^[\w-]{11}$/.test(input)) return input;

    const u = new URL(input);

    // youtu.be/<id>
    if (u.hostname === "youtu.be") {
      const id = u.pathname.replace("/", "").slice(0, 11);
      return /^[\w-]{11}$/.test(id) ? id : null;
    }

    // youtube.com/watch?v=<id>
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v;

      // shorts/<id> or embed/<id>
      const parts = u.pathname.split("/").filter(Boolean);
      const idx = ["shorts", "embed"].includes(parts[0]) ? 1 : -1;
      if (idx !== -1 && parts[idx] && /^[\w-]{11}$/.test(parts[idx])) return parts[idx];
    }
  } catch (_) {
    // not a URL, ignore
  }

  return null;
}

