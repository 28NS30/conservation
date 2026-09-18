/**
 * What the map is drawing, and what the colour means.
 *
 * Two words rather than one enum of six, because they are independent: any of
 * the three geometries can be coloured by density or by type, and both ride in
 * the same tile — so switching either is a repaint or a visibility flip, never
 * a refetch. That is why they are worth separating at all.
 *
 * Kept here rather than in a component so the panel, the legend and the map can
 * each import the type without importing each other.
 */
export type LabMapMode = "bins" | "dots" | "heat";
export type LabMapColour = "density" | "type";
