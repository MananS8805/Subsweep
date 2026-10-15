/**
 * Always-mounted screen-reader announcements. Because the regions never unmount and their text only changes
 * when the message does, a re-render with the same message is not announced again.
 */
export default function LiveRegion({ polite, assertive }: { polite: string; assertive: string }) {
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{polite}</div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">{assertive}</div>
    </>
  );
}
