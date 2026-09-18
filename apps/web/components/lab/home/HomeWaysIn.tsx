import { getTranslations } from "next-intl/server";
import Button from "@/components/lab/ui/Button";
import Section from "@/components/lab/ui/Section";
import { List, DataRow } from "@/components/lab/ui/DataRow";
import Binomial from "@/components/lab/ui/Binomial";
import { getLabCopy } from "@/lib/lab/copy";
import { labHref, type LabDirection } from "@/lib/lab/directions";
import {
  LAB_MAP_PLACES,
  mapPlaceHref,
  mapSpeciesHref,
} from "@/lib/lab/mapPlaces";
import type { EntrySpecies } from "@/lib/stats";

/**
 * Ways into the map, with no picture of the map in them.
 *
 * This block stands where the rejected version drew every record at 500m in the
 * shape of the island. The owner did not want the page to lead with a count and
 * did not want the data as art, and it was also the page's heaviest element by
 * far. What replaces it is seven ways to start — four places and three animals,
 * each opening the map already at that view — and it loads nothing of the map:
 * MapLibre stays on the map route, where it is the point.
 *
 * The names are at `text-head` in the FUNCTIONAL face, not the display one
 * (§4). Seven 28px names in the sign weight is the forestry-bureau look §2.3's
 * two-headings-per-viewport rule exists to prevent, and these are destinations
 * rather than headings.
 *
 * The species are `mapEntrySpecies`, which is restricted to taxa with no
 * sensitivity rating and no protected status — a front-page button leading
 * straight to where a sensitive animal is found would be a strange thing to
 * build, blurred or not. No row prints a coordinate; a place's coordinates are
 * in its link because they are a map view, not a record.
 */
export default async function HomeWaysIn({
  direction,
  locale,
  surface,
  heading,
  species,
}: {
  direction: LabDirection;
  locale: string;
  surface: "paper" | "plate" | "field";
  heading: "block" | "margin";
  species: EntrySpecies[];
}) {
  const t = await getTranslations("home");
  const copy = getLabCopy(locale);
  const inEnglish = locale.startsWith("en");
  const map = labHref(direction, "/map");

  const columnLabel = "t-note t-label mb-2 block font-bold text-(--fg-quiet)";

  return (
    <Section
      surface={surface}
      heading={heading}
      title={copy.home.mapSectionTitle}
      titleId="lab-home-ways"
      className="py-16"
    >
      <div className="grid gap-10 md:grid-cols-2">
        <div>
          <p id="lab-home-places" className={columnLabel}>
            {t("mapPlacesLabel")}
          </p>
          <List aria-labelledby="lab-home-places">
            {LAB_MAP_PLACES.map((place) => (
              <DataRow
                key={place.key}
                href={mapPlaceHref(map, place)}
                nameSize="head"
                name={t(`places.${place.key}`)}
              />
            ))}
          </List>
        </div>
        <div>
          <p id="lab-home-species" className={columnLabel}>
            {t("mapSpeciesLabel")}
          </p>
          <List aria-labelledby="lab-home-species">
            {species.map((taxon) => (
              <DataRow
                key={taxon.id}
                href={mapSpeciesHref(map, taxon.id)}
                nameSize="head"
                // The Chinese common name is the name for a Taiwanese reader;
                // these taxa have no English one, so on /en the binomial is
                // promoted to the name and the Chinese sits under it.
                name={
                  inEnglish ? (
                    <Binomial>{taxon.scientificName}</Binomial>
                  ) : (
                    taxon.commonNameZh
                  )
                }
                binomial={inEnglish ? undefined : taxon.scientificName}
                meta={
                  inEnglish ? (
                    <span lang="zh-TW">{taxon.commonNameZh}</span>
                  ) : undefined
                }
              />
            ))}
          </List>
        </div>
      </div>
      <div className="mt-10">
        <Button href={map} variant="secondary">
          {copy.home.openFullMap}
        </Button>
      </div>
    </Section>
  );
}
