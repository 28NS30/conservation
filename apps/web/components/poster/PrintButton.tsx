"use client";

/** Opens the browser's print dialog; the page's print styles make it a poster. */
export default function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-11 items-center rounded-md bg-forest-900 px-5 text-sm font-medium text-paper-50 hover:bg-forest-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-900"
    >
      {label}
    </button>
  );
}
