import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { displayHandle } from "@/lib/forum/nickname";
import { badge } from "./styles";

/**
 * A member, as the forum shows people: their generated name, linked to their
 * page, with a badge if they moderate. A member who deleted their account is
 * "deleted member" and links nowhere.
 */
export default async function Nickname({
  handle,
  locale,
  moderator = false,
}: {
  handle: string | null;
  locale: string;
  moderator?: boolean;
}) {
  const t = await getTranslations("forum");
  const name = displayHandle(handle, locale);
  if (!handle || !name) return <span className="text-ink-600">{t("deletedMember")}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <Link
        href={`/community/u/${handle}`}
        className="inline-flex min-h-11 items-center font-semibold text-forest-900 underline-offset-2 hover:underline"
      >
        {name}
      </Link>
      {moderator && <span className={`${badge} bg-forest-900 text-paper-50`}>{t("moderatorBadge")}</span>}
    </span>
  );
}
