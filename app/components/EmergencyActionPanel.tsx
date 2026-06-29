"use client";

import { useCallback, useEffect, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// EmergencyActionPanel — "The Last Minute Life Saver".
//
// Renders a prominent, auto-appearing emergency response panel when Override is
// confident a real emergency is happening. The whole point is MINIMAL FRICTION:
// a panicking user only needs ONE tap per action, because everything (location,
// summary, maps query, SMS body) is pre-prepared the moment the panel mounts.
//
// HONESTY NOTE (intentional, do not "fix" this away):
//   * Browsers cannot auto-dial a phone number without a user gesture — that is
//     a deliberate security restriction. So "Call" is a `tel:` link that opens
//     the dialler pre-filled; the user taps once to place the call.
//   * There is no public API to dispatch real 112/100/108 PSAP centres without
//     official emergency-service partnership. One-tap dial + one-tap location
//     share is the correct, honest, functionally-equivalent demo behaviour.
//
// Uses only standard browser/web-platform APIs and the keyless Google Maps
// embed (`output=embed`) — no third-party React map library is imported, so
// there is nothing extra to install.
// ─────────────────────────────────────────────────────────────────────────────

const EMERGENCY_NUMBER = "112"; // India unified emergency number
const CONTACT_STORAGE_KEY = "override_emergency_contact";

interface Coords {
  lat: number;
  lng: number;
}

interface EmergencyActionPanelProps {
  /** CVL / risk confidence as a 0..1 float. */
  riskScore: number;
  /** Human-readable emergency type (from Gemini or the risk engine). */
  emergencyType: string;
  /** Best-known device coordinates, or null if not yet fetched. */
  location: Coords | null;
  /** One-line incident summary for sharing / clipboard. */
  summary: string;
}

type ShareState = "idle" | "shared" | "copied" | "error";

export function EmergencyActionPanel({
  riskScore,
  emergencyType,
  location,
  summary,
}: EmergencyActionPanelProps) {
  // Coordinates: prefer the prop, otherwise try to acquire them ourselves so
  // the share/maps actions are ready the instant the user taps.
  const [coords, setCoords] = useState<Coords | null>(location);
  const [shareState, setShareState] = useState<ShareState>("idle");
  const [contact, setContact] = useState<string>("");
  const [contactDraft, setContactDraft] = useState<string>("");
  const [editingContact, setEditingContact] = useState(false);

  // Keep local coords in sync if the parent later supplies a real location.
  useEffect(() => {
    if (location) setCoords(location);
  }, [location]);

  // On mount, eagerly request the device position (best-effort, silent on fail)
  // so "Share My Location" and the nearby-help map are pre-prepared.
  useEffect(() => {
    if (coords) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        /* silent — user can still call without location */
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load any pre-configured emergency contact from localStorage.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CONTACT_STORAGE_KEY);
      if (stored) {
        setContact(stored);
        setContactDraft(stored);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const mapsLink = coords
    ? `https://www.google.com/maps?q=${coords.lat},${coords.lng}`
    : null;

  // The pre-prepared alert text shared via Web Share / clipboard / SMS.
  const buildAlertText = useCallback(() => {
    const lines = [
      "🚨 EMERGENCY ALERT (sent via Override)",
      `Type: ${emergencyType || "Emergency detected"}`,
      `Confidence: ${Math.round(riskScore * 100)}%`,
    ];
    if (coords) {
      lines.push(`Location: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`);
      lines.push(`Google Maps: ${mapsLink}`);
    } else {
      lines.push("Location: not available");
    }
    if (summary && summary.trim()) lines.push(`Details: ${summary.trim()}`);
    return lines.join("\n");
  }, [emergencyType, riskScore, coords, mapsLink, summary]);

  const handleShare = useCallback(async () => {
    const text = buildAlertText();
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: "Emergency Alert — Override", text });
        setShareState("shared");
      } else if (
        typeof navigator !== "undefined" &&
        navigator.clipboard?.writeText
      ) {
        await navigator.clipboard.writeText(text);
        setShareState("copied");
      } else {
        setShareState("error");
      }
    } catch {
      // User cancelled the share sheet, or share failed — fall back to copy.
      try {
        await navigator.clipboard.writeText(text);
        setShareState("copied");
      } catch {
        setShareState("error");
      }
    }
  }, [buildAlertText]);

  const handleCopy = useCallback(async () => {
    const text = buildAlertText();
    try {
      await navigator.clipboard.writeText(text);
      setShareState("copied");
    } catch {
      setShareState("error");
    }
  }, [buildAlertText]);

  const saveContact = useCallback(() => {
    const cleaned = contactDraft.replace(/[^\d+]/g, "").trim();
    setContact(cleaned);
    try {
      if (cleaned) localStorage.setItem(CONTACT_STORAGE_KEY, cleaned);
      else localStorage.removeItem(CONTACT_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setEditingContact(false);
  }, [contactDraft]);

  // SMS deep link with the location pre-filled in the body.
  const smsBody = coords
    ? `🚨 I need help! ${emergencyType || "Emergency"}. My location: ${mapsLink}`
    : `🚨 I need help! ${emergencyType || "Emergency"}.`;
  const smsLink = contact
    ? `sms:${contact}?&body=${encodeURIComponent(smsBody)}`
    : null;

  // Keyless Google Maps Embed (search mode) for nearby hospitals + police.
  const nearbyMapSrc = coords
    ? `https://www.google.com/maps?q=hospital+OR+police+near+${coords.lat},${coords.lng}&z=14&output=embed`
    : null;

  const confidencePct = Math.round(riskScore * 100);

  return (
    <section
      role="alert"
      aria-live="assertive"
      className="w-full overflow-hidden rounded-2xl border-2 border-red-500 bg-gradient-to-br from-red-950 via-red-900 to-orange-950 shadow-[0_0_40px_-8px_rgba(239,68,68,0.8)]"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 bg-red-700/60 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl animate-pulse" aria-hidden>
            🚨
          </span>
          <div>
            <p className="text-lg font-black uppercase tracking-wide text-white">
              Emergency Detected
            </p>
            <p className="text-sm font-medium text-red-100">
              {emergencyType || "Emergency"} — Risk: {confidencePct}%
            </p>
          </div>
        </div>
        <span className="rounded-full bg-black/30 px-3 py-1 text-xs font-bold uppercase tracking-widest text-red-100">
          One-Tap Response
        </span>
      </div>

      <div className="flex flex-col gap-3 p-5">
        {/* ── Primary: Call emergency services (ONE TAP) ── */}
        <a
          href={`tel:${EMERGENCY_NUMBER}`}
          className="flex items-center justify-center gap-3 rounded-xl bg-white px-5 py-4 text-center text-lg font-black text-red-700 shadow-lg transition-transform hover:scale-[1.02] active:scale-95"
        >
          📞 Call Emergency Services ({EMERGENCY_NUMBER})
        </a>
        <p className="-mt-1 text-center text-[11px] text-red-200/80">
          Opens your dialler with {EMERGENCY_NUMBER} pre-filled — one tap to call
          (browsers cannot auto-dial).
        </p>

        {/* ── Secondary action row ── */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={handleShare}
            className="flex items-center justify-center gap-2 rounded-xl border border-white/30 bg-white/10 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-white/20"
          >
            📤 Share My Location Now
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center justify-center gap-2 rounded-xl border border-white/30 bg-white/10 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-white/20"
          >
            📋 Copy Emergency Details
          </button>
        </div>

        {/* Share status toast */}
        {shareState !== "idle" && (
          <p
            className={
              shareState === "error"
                ? "text-center text-sm font-medium text-yellow-200"
                : "text-center text-sm font-medium text-green-300"
            }
          >
            {shareState === "shared" && "✓ Share sheet opened"}
            {shareState === "copied" && "✓ Emergency details copied to clipboard"}
            {shareState === "error" &&
              "Sharing not supported on this device — copy the details manually"}
          </p>
        )}

        {/* ── Emergency contact (SMS, pre-configured) ── */}
        <div className="rounded-xl border border-white/15 bg-black/20 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-white">📱 Emergency Contact</p>
            <button
              type="button"
              onClick={() => {
                setContactDraft(contact);
                setEditingContact((e) => !e);
              }}
              className="text-xs font-medium text-red-200 underline-offset-2 hover:underline"
            >
              {contact ? "Edit" : "Add contact"}
            </button>
          </div>

          {editingContact ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="tel"
                inputMode="tel"
                value={contactDraft}
                onChange={(e) => setContactDraft(e.target.value)}
                placeholder="+91XXXXXXXXXX"
                className="flex-1 rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-red-200/40 focus:border-white/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={saveContact}
                className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-100"
              >
                Save
              </button>
            </div>
          ) : contact && smsLink ? (
            <a
              href={smsLink}
              className="mt-3 flex items-center justify-center gap-2 rounded-lg border border-white/30 bg-white/10 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-white/20"
            >
              📨 Text {contact} my location
            </a>
          ) : (
            <p className="mt-2 text-xs text-red-200/70">
              Add a trusted contact to one-tap text them your location during an
              emergency. Stored only on this device.
            </p>
          )}
        </div>

        {/* ── Nearest help map (keyless Google Maps embed) ── */}
        <div className="rounded-xl border border-white/15 bg-black/20 p-4">
          <p className="text-sm font-bold text-white">🏥 Nearest Help</p>
          {nearbyMapSrc ? (
            <>
              <p className="mb-2 mt-1 text-xs text-red-200/70">
                Hospitals &amp; police stations near your location.
              </p>
              <div className="overflow-hidden rounded-lg border border-white/20">
                <iframe
                  title="Nearby hospitals and police"
                  width="100%"
                  height="220"
                  style={{ border: 0 }}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  src={nearbyMapSrc}
                />
              </div>
            </>
          ) : (
            <p className="mt-1 text-xs text-red-200/70">
              Waiting for your location to show nearby hospitals and police…
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
