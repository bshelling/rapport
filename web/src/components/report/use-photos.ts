"use client";

import { useCallback, useState } from "react";
import {
  confirmUpload,
  type Draft,
  deletePhoto,
  reservePhoto,
  uploadToS3,
} from "@/lib/api";
import { preparePhoto } from "@/lib/image";

export const MAX_PHOTOS = 3;

export type PhotoItem = {
  id: string; // server photo id, or a temp id while preparing
  previewUrl: string;
  status: "uploading" | "done" | "error";
};

/**
 * Photo uploads for a draft: prepare in the browser (read GPS, strip EXIF),
 * upload straight to S3, then tell the API so AI triage can start.
 */
export function usePhotos(
  draft: Draft,
  {
    onGps,
    onUploaded,
  }: {
    onGps?: (point: { lat: number; lng: number }) => void;
    onUploaded?: (draft: Draft) => void;
  } = {},
) {
  const [photos, setPhotos] = useState<PhotoItem[]>(() =>
    draft.photos.map((p) => ({
      id: p.id,
      previewUrl: p.url ?? "",
      status: "done",
    })),
  );

  const addFiles = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files) return;
      const room = MAX_PHOTOS - photos.length;
      for (const file of Array.from(files).slice(0, room)) {
        const tempId = crypto.randomUUID();
        try {
          const prepared = await preparePhoto(file);
          setPhotos((p) => [
            ...p,
            {
              id: tempId,
              previewUrl: prepared.previewUrl,
              status: "uploading",
            },
          ]);
          if (prepared.gps) onGps?.(prepared.gps);
          const upload = await reservePhoto(draft.id);
          try {
            await uploadToS3(upload, prepared.blob);
          } catch (err) {
            await deletePhoto(draft.id, upload.photo.id).catch(() => undefined);
            throw err;
          }
          const updated = await confirmUpload(draft.id, upload.photo.id);
          setPhotos((p) =>
            p.map((x) =>
              x.id === tempId
                ? { ...x, id: upload.photo.id, status: "done" }
                : x,
            ),
          );
          onUploaded?.(updated);
        } catch (err) {
          console.error(err);
          setPhotos((p) =>
            p.map((x) => (x.id === tempId ? { ...x, status: "error" } : x)),
          );
        }
      }
    },
    [draft.id, onGps, onUploaded, photos.length],
  );

  const removePhoto = useCallback(
    async (item: PhotoItem) => {
      setPhotos((p) => p.filter((x) => x.id !== item.id));
      if (item.status === "done") {
        const updated = await deletePhoto(draft.id, item.id).catch(() => null);
        if (updated) onUploaded?.(updated);
      }
    },
    [draft.id, onUploaded],
  );

  return {
    photos,
    addFiles,
    removePhoto,
    uploading: photos.some((p) => p.status === "uploading"),
  };
}
