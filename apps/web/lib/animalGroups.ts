/**
 * The everyday group an animal belongs to, from TaiCOL's class.
 *
 * For browsing the invasive species list, which is 209 names long and mostly
 * insects, fish and snails nobody has recorded here. Grouped by class name it
 * would read "Actinopteri", "Thecostraca", "Secernentea" — correct and no help
 * to a student looking for the frog they saw. So the classes fold into the
 * groups people use, in the order people look for them: the vertebrates that
 * hold the records first.
 *
 * Pure, with no imports, so the client list and a test can both use it.
 */
export const ANIMAL_GROUPS = [
  "birds",
  "reptiles",
  "amphibians",
  "mammals",
  "fish",
  "insects",
  "molluscs",
  "crustaceans",
  "arachnids",
  "other",
] as const;

export type AnimalGroup = (typeof ANIMAL_GROUPS)[number];

const BY_CLASS: Record<string, AnimalGroup> = {
  Aves: "birds",
  Reptilia: "reptiles",
  Amphibia: "amphibians",
  Mammalia: "mammals",
  // TaiCOL files ray-finned fish as Actinopteri; older checklists say
  // Actinopterygii. Sharks and rays are Elasmobranchii or Chondrichthyes.
  Actinopteri: "fish",
  Actinopterygii: "fish",
  Elasmobranchii: "fish",
  Chondrichthyes: "fish",
  Insecta: "insects",
  Gastropoda: "molluscs",
  Bivalvia: "molluscs",
  Cephalopoda: "molluscs",
  Malacostraca: "crustaceans",
  // Barnacles.
  Thecostraca: "crustaceans",
  Branchiopoda: "crustaceans",
  Arachnida: "arachnids",
};

/** The group for a TaiCOL class; anything unlisted is "other", never dropped. */
export function animalGroupOf(cls: string | null | undefined): AnimalGroup {
  return (cls && BY_CLASS[cls]) || "other";
}
