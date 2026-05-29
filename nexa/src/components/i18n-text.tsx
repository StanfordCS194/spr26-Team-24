"use client";

import Image, { type ImageProps } from "next/image";
import { useI18n } from "@/i18n/provider";
import type { MessageKey } from "@/i18n/messages";

export function T({
  k,
  params,
}: {
  k: MessageKey | string;
  params?: Record<string, string | number>;
}) {
  const { t } = useI18n();
  return <>{t(k, params)}</>;
}

export function TranslatedImage({
  altKey,
  ...props
}: Omit<ImageProps, "alt"> & { altKey: MessageKey }) {
  const { t } = useI18n();
  return <Image {...props} alt={t(altKey)} />;
}
