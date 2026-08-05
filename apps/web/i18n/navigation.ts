import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * Locale-aware replacements for next/link and the router hooks. Use these rather
 * than importing from `next/link` directly, or links will drop the active locale
 * and bounce English readers back to Chinese.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
