/**
 * Epic 54.5 stub: the exercise video link. Story 54.5 turns a YouTube link into a tap-to-load
 * youtube-nocookie mini-player; until then it is the plain external link the app always had.
 * The props are the contract other stories build against: do not change them.
 */
export function VideoLink({ url, label }: { url: string; label?: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {label ?? url}
    </a>
  );
}
