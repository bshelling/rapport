"use client";

import { useId, useRef, useState } from "react";
import { RichText } from "@/components/report/rich-text";
import { StepNav } from "@/components/report/step-nav";
import {
  type ApiError,
  type Draft,
  type DraftLocation,
  deletePhoto,
  patchDraft,
  type Report,
  reservePhoto,
  submitDraft,
  uploadToS3,
} from "@/lib/api";
import { inNewOrleans } from "@/lib/geo";
import { preparePhoto } from "@/lib/image";

const MAX_PHOTOS = 3;
const MIN_TEXT = 10;
const MAX_TEXT = 2000;

type PhotoItem = {
  id: string; // server photo id, or a temp id while preparing
  previewUrl: string;
  status: "uploading" | "done" | "error";
};

export function StepDescribe({
  draft,
  onSaved,
  onBack,
  onSubmitted,
}: {
  draft: Draft;
  onSaved: (d: Draft) => void;
  onBack: () => void;
  onSubmitted: (r: Report) => void;
}) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [location, setLocation] = useState<DraftLocation | null>(
    draft.location,
  );
  const [address, setAddress] = useState(draft.location?.address ?? "");
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PhotoItem[]>(
    draft.photos.map((p) => ({
      id: p.id,
      previewUrl: p.url ?? "",
      status: "done",
    })),
  );
  const [html, setHtml] = useState(draft.description_html ?? "");
  const [textLength, setTextLength] = useState(
    (draft.description_html ?? "").replace(/<[^>]+>/g, "").trim().length,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setPoint = (
    lat: number,
    lng: number,
    source: DraftLocation["source"],
  ) => {
    if (!inNewOrleans(lat, lng)) {
      setLocationNote(
        "That spot is outside New Orleans. Rapport only covers Orleans Parish.",
      );
      return false;
    }
    setLocation({ lat, lng, source, address: address || null });
    setLocationNote(null);
    return true;
  };

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) {
      setLocationNote("Your browser can't share its location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setPoint(pos.coords.latitude, pos.coords.longitude, "gps");
      },
      () => {
        setLocating(false);
        setLocationNote(
          "We couldn't get your location. Check your browser's location permission.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const room = MAX_PHOTOS - photos.length;
    for (const file of Array.from(files).slice(0, room)) {
      const tempId = crypto.randomUUID();
      try {
        const prepared = await preparePhoto(file);
        setPhotos((p) => [
          ...p,
          { id: tempId, previewUrl: prepared.previewUrl, status: "uploading" },
        ]);
        if (
          prepared.gps &&
          !location &&
          setPoint(prepared.gps.lat, prepared.gps.lng, "photo")
        ) {
          setLocationNote("Location set from your photo.");
        }
        const upload = await reservePhoto(draft.id);
        try {
          await uploadToS3(upload, prepared.blob);
        } catch (err) {
          await deletePhoto(draft.id, upload.photo.id).catch(() => undefined);
          throw err;
        }
        setPhotos((p) =>
          p.map((x) =>
            x.id === tempId ? { ...x, id: upload.photo.id, status: "done" } : x,
          ),
        );
      } catch (err) {
        console.error(err);
        setPhotos((p) =>
          p.map((x) => (x.id === tempId ? { ...x, status: "error" } : x)),
        );
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  const removePhoto = async (item: PhotoItem) => {
    setPhotos((p) => p.filter((x) => x.id !== item.id));
    if (item.status === "done")
      await deletePhoto(draft.id, item.id).catch(() => undefined);
  };

  const uploading = photos.some((p) => p.status === "uploading");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!location) return setError("Add the location of the problem.");
    if (textLength < MIN_TEXT)
      return setError(
        `Describe the problem (at least ${MIN_TEXT} characters).`,
      );
    if (textLength > MAX_TEXT)
      return setError(`Keep the description under ${MAX_TEXT} characters.`);
    setBusy(true);
    try {
      onSaved(
        await patchDraft(draft.id, {
          location: { ...location, address: address.trim() || null },
          description_html: html,
        }),
      );
      onSubmitted(await submitDraft(draft.id));
    } catch (err) {
      const missing = (err as ApiError)?.detail as
        | { detail?: { missing?: string[] } }
        | undefined;
      setError(
        missing?.detail?.missing?.includes("photos")
          ? "A photo didn't finish uploading. Remove it or try again."
          : "Couldn't submit your report. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate aria-label="Describe the request">
      <h2 className="text-xl font-semibold">
        Where is it, and what does it look like?
      </h2>

      <section className="mt-5" aria-labelledby={`${id}-loc`}>
        <h3 id={`${id}-loc`} className="font-medium">
          Location
        </h3>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            className="rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-brand/10 disabled:opacity-50"
          >
            {locating ? "Locating…" : "📍 Use my current location"}
          </button>
          {location && (
            <span className="text-sm text-muted" data-testid="location-set">
              {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
              {location.source === "photo" && " (from photo)"}
            </span>
          )}
        </div>
        {locationNote && (
          <p className="mt-2 text-sm text-muted">{locationNote}</p>
        )}
        <label
          htmlFor={`${id}-address`}
          className="mt-3 mb-1 block text-sm font-medium"
        >
          Nearest address or landmark{" "}
          <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id={`${id}-address`}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          maxLength={200}
          placeholder="e.g. corner of Napoleon Ave & Magazine St"
          className="w-full rounded-xl border border-border bg-background px-3 py-2 outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
        {!location && (
          <p className="mt-2 text-xs text-muted">
            Use your current location, or add a photo taken at the spot.
          </p>
        )}
      </section>

      <section className="mt-6" aria-labelledby={`${id}-photos`}>
        <h3 id={`${id}-photos`} className="font-medium">
          Photos{" "}
          <span className="font-normal text-muted">
            (up to {MAX_PHOTOS}, optional)
          </span>
        </h3>
        <div className="mt-2 flex flex-wrap gap-3">
          {photos.map((p) => (
            <div
              key={p.id}
              className="relative h-24 w-24 overflow-hidden rounded-xl border border-border"
            >
              {p.previewUrl && (
                // biome-ignore lint/performance/noImgElement: local blob/presigned previews
                <img
                  src={p.previewUrl}
                  alt="Report"
                  className="h-full w-full object-cover"
                />
              )}
              {p.status !== "done" && (
                <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-center text-xs text-white">
                  {p.status === "uploading" ? "Uploading…" : "Failed"}
                </span>
              )}
              <button
                type="button"
                onClick={() => removePhoto(p)}
                aria-label="Remove photo"
                className="absolute top-1 right-1 rounded-full bg-black/60 px-1.5 text-sm text-white"
              >
                ×
              </button>
            </div>
          ))}
          {photos.length < MAX_PHOTOS && (
            <label className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-border text-sm text-muted hover:border-brand/50">
              <span aria-hidden className="text-2xl">
                +
              </span>
              Add photo
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => addFiles(e.target.files)}
                data-testid="photo-input"
              />
            </label>
          )}
        </div>
        <p className="mt-2 text-xs text-muted">
          Photos are resized and stripped of location and device data before
          upload.
        </p>
      </section>

      <section className="mt-6">
        <h3 id={`${id}-desc`} className="mb-2 font-medium">
          Description
        </h3>
        <RichText
          id={`${id}-desc-input`}
          labelledBy={`${id}-desc`}
          value={html}
          onChange={(h, t) => {
            setHtml(h);
            setTextLength(t.trim().length);
          }}
        />
        <p
          className={`mt-1 text-right text-xs ${textLength > MAX_TEXT ? "text-red-600" : "text-muted"}`}
        >
          {textLength} / {MAX_TEXT}
        </p>
      </section>

      <StepNav
        onBack={onBack}
        busy={busy}
        disabled={uploading}
        nextLabel={uploading ? "Uploading photos…" : "Submit report"}
        error={error}
      />
    </form>
  );
}
