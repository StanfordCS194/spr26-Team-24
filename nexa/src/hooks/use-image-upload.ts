"use client";

import { useState, useCallback } from "react";

// Server enforces a ~4.5MB request body limit (Vercel default). Modern phone
// photos are 5–10MB after base64, so we resize before sending.
const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.82;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = src;
  });
}

async function resizeImage(file: File): Promise<string> {
  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);

  const longest = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

export function useImageUpload() {
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);

  const processFile = useCallback(async (file: File) => {
    try {
      const resized = await resizeImage(file);
      setImagePreview(resized);
      setImageBase64(resized);
    } catch {
      // Fall back to the raw file if anything in the resize pipeline fails.
      // Upload may still 413, but the user at least sees their photo.
      const raw = await readAsDataUrl(file);
      setImagePreview(raw);
      setImageBase64(raw);
    }
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void processFile(file);
    },
    [processFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (file?.type.startsWith("image/")) void processFile(file);
    },
    [processFile],
  );

  const clearImage = useCallback(() => {
    setImagePreview(null);
    setImageBase64(null);
  }, []);

  return { imagePreview, imageBase64, handleFileInput, handleDrop, clearImage };
}
