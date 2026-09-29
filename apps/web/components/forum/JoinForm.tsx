"use client";

import { useActionState, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { joinForum } from "@/app/[locale]/(site)/community/actions";
import { displayNickname, generateNickname, handleOf, type Nickname } from "@/lib/forum/nickname";
import { btnPrimary, btnSecondary, hint, label, link } from "./styles";

/**
 * Joining: a generated name, an age group, a guardian's say-so for 13–17, and
 * the guidelines.
 *
 * The name is chosen on the server when the page renders and can be swapped
 * here for another from the same list; the join action accepts only a name
 * the list could have produced (lib/forum/nickname.ts parseHandle), so editing
 * the request to say anything else gets nowhere.
 *
 * The age question offers "under 13" as an honest answer rather than hiding
 * it: a form that makes the right answer impossible teaches people to lie to
 * it. Saying under 13 is refused kindly, nothing about it is stored, and the
 * browser is not allowed to change its answer and try again for a day.
 */
export default function JoinForm({ initial }: { initial: Nickname }) {
  const t = useTranslations("forum.join");
  const tm = useTranslations("forum.msg");
  const tn = useTranslations("nav");
  const locale = useLocale();
  const [nickname, setNickname] = useState<Nickname>(initial);
  const [age, setAge] = useState<string>("");
  const [state, action, pending] = useActionState(joinForum, null);

  if (state?.message === "tooYoung") {
    return (
      <div role="status" className="border-l-4 border-forest-900 bg-paper-100 px-5 py-5">
        <p className="font-display text-[24px] font-bold leading-tight text-forest-900">{t("tooYoungTitle")}</p>
        <p className="mt-2 text-[16px] leading-relaxed text-ink-800">{t("tooYoungBody")}</p>
        <p className="mt-4 flex flex-wrap gap-3">
          <Link href="/map" className={btnSecondary}>
            {tn("map")}
          </Link>
          <Link href="/species" className={btnSecondary}>
            {tn("species")}
          </Link>
        </p>
      </div>
    );
  }

  const radio = "flex min-h-11 items-center gap-3 text-[16px] text-ink-800";

  return (
    <form action={action} className="space-y-8" aria-busy={pending || undefined}>
      <fieldset disabled={pending} className="min-w-0 space-y-8">
        <div>
          <p className={label} id="nickname-label">
            {t("nicknameLabel")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <output
              aria-labelledby="nickname-label"
              aria-live="polite"
              className="inline-flex min-h-11 items-center border-2 border-forest-900 bg-white px-4 font-display text-[22px] font-bold text-forest-900"
            >
              {displayNickname(nickname, locale)}
            </output>
            <button type="button" onClick={() => setNickname(generateNickname())} className={btnSecondary}>
              {t("another")}
            </button>
          </div>
          <input type="hidden" name="nickname" value={handleOf(nickname)} />
          <p className={hint}>{t("nicknameHelp")}</p>
        </div>

        <fieldset>
          <legend className={label}>{t("ageLegend")}</legend>
          <p className={hint}>{t("ageHelp")}</p>
          <div className="mt-2 grid gap-1">
            {(
              [
                ["under_13", t("under13")],
                ["13_17", t("age13to17")],
                ["18_plus", t("age18plus")],
              ] as const
            ).map(([value, text]) => (
              <label key={value} className={radio}>
                <input
                  type="radio"
                  name="ageBand"
                  value={value}
                  required
                  checked={age === value}
                  onChange={() => setAge(value)}
                  className="size-5 accent-leaf-600"
                />
                {text}
              </label>
            ))}
          </div>
          {/* Shown for 13–17 only, but rendered for everyone until the page
              is interactive, so the form still works before JavaScript. */}
          <div className={age && age !== "13_17" ? "hidden" : "mt-3"}>
            <label className="flex min-h-11 items-start gap-3 text-[16px] leading-relaxed text-ink-800">
              <input type="checkbox" name="guardian" className="mt-1 size-5 shrink-0 accent-leaf-600" />
              <span>
                {t("guardianLabel")}
                <span className="mt-1 block text-[14px] text-ink-600">{t("guardianHelp")}</span>
              </span>
            </label>
          </div>
        </fieldset>

        <div className="border border-ink-900/12 bg-white/60 px-5 py-5">
          <p className="font-display text-[22px] font-bold text-forest-900">{t("guidelinesTitle")}</p>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-[15px] leading-relaxed text-ink-800">
            <li>{t("summary1")}</li>
            <li>{t("summary2")}</li>
            <li>{t("summary3")}</li>
            <li>{t("summary4")}</li>
            <li>{t("summary5")}</li>
          </ol>
          <Link href="/community/guidelines" className={`${link} mt-2 inline-flex min-h-11 items-center text-[15px]`}>
            {t("readAll")}
          </Link>
          <label className="mt-3 flex min-h-11 items-start gap-3 text-[16px] font-semibold leading-relaxed text-ink-900">
            <input type="checkbox" name="guidelines" required className="mt-1 size-5 shrink-0 accent-leaf-600" />
            {t("guidelinesLabel")}
          </label>
        </div>

        <button type="submit" className={btnPrimary}>
          {t("submit")}
        </button>
      </fieldset>
      {state?.message && (
        <p role={state.ok ? "status" : "alert"} className="text-[15px] text-ember-700">
          {tm(state.message)}
        </p>
      )}
    </form>
  );
}
