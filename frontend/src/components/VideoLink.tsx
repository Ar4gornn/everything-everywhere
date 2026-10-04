import { useRef, useState } from "react";

import { youtubeId, youtubeStart } from "../gym/youtube";
import { useT } from "../i18n";

/**
 * Epic 54.5: an exercise video. A YouTube link is a "Watch" button that loads nothing until
 * tapped, then an inline youtube-nocookie player. Any other https link is a plain external
 * link; anything that is not https renders nothing.
 */
export function VideoLink({ url, label }: { url: string; label?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const watchRef = useRef<HTMLButtonElement>(null);

  const id = youtubeId(url);
  if (id === null) {
    let https = false;
    try {
      https = new URL(url).protocol === "https:";
    } catch {
      https = false;
    }
    if (!https) return null;
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {label ?? url}
      </a>
    );
  }

  const start = youtubeStart(url);
  const src = `https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0${
    start !== null ? `&start=${start}` : ""
  }`;

  if (!open) {
    return (
      <button
        type="button"
        className="quiet"
        ref={watchRef}
        aria-label={t("gymVideo.watchLabel")}
        onClick={() => setOpen(true)}
      >
        {t("gymVideo.watch")}
      </button>
    );
  }

  return (
    <div className="video-link-player">
      <div className="video-link-frame">
        <iframe
          src={src}
          title={t("gymVideo.frameTitle")}
          allow="encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
        />
      </div>
      <div className="video-link-actions">
        <button
          type="button"
          className="quiet"
          aria-label={t("gymVideo.closeLabel")}
          onClick={() => {
            setOpen(false);
            // The Watch button is re-created by the state change; focus it once it exists.
            setTimeout(() => watchRef.current?.focus(), 0);
          }}
        >
          {t("gymVideo.close")}
        </button>
        <a href={url} target="_blank" rel="noopener noreferrer">
          {t("gymVideo.openOnYoutube")}
        </a>
      </div>
    </div>
  );
}
