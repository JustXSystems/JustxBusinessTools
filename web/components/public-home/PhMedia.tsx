import { resolveMediaUrl, hasRenderableMedia } from "@/lib/public-home/style";
import type { MediaRef } from "@/lib/public-home/types";

export function PhMedia({
  media,
  className = "",
}: {
  media?: MediaRef | null;
  className?: string;
}) {
  if (!hasRenderableMedia(media) || !media) return null;
  const src = resolveMediaUrl(media.url);
  const fit = media.objectFit === "contain" ? "is-contain" : "";
  const cls = `ph-media ${fit} ${className}`.trim();

  if (media.kind === "video") {
    return (
      <video
        className={cls}
        src={src}
        poster={media.posterUrl ? resolveMediaUrl(media.posterUrl) : undefined}
        autoPlay
        muted
        loop
        playsInline
        aria-label={media.alt || undefined}
      />
    );
  }

  if (media.kind === "svg" && src.includes("<svg")) {
    return (
      <span
        className={cls}
        role="img"
        aria-label={media.alt || undefined}
        dangerouslySetInnerHTML={{ __html: media.url }}
      />
    );
  }

  return <img className={cls} src={src} alt={media.alt || ""} />;
}
