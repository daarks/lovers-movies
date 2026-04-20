import type { ImgHTMLAttributes } from "react";
import { cx } from "./cx";

export type TmdbSize = "w92" | "w154" | "w185" | "w342" | "w500" | "w780" | "original";

export interface MediaPosterProps extends ImgHTMLAttributes<HTMLImageElement> {
  path?: string | null;
  size?: TmdbSize;
  title?: string;
  rounded?: "sm" | "md" | "lg" | "xl";
  /** Lista de sizes para srcset (TMDB). Defaults to responsive ladder. */
  srcSetSizes?: TmdbSize[];
  /** sizes attribute para a responsividade do browser. */
  sizes?: string;
}

const DEFAULT_LADDER: TmdbSize[] = ["w185", "w342", "w500", "w780"];

function sizeToWidth(size: TmdbSize): number {
  if (size === "w92") return 92;
  if (size === "w154") return 154;
  if (size === "w185") return 185;
  if (size === "w342") return 342;
  if (size === "w500") return 500;
  if (size === "w780") return 780;
  return 1000;
}

export function MediaPoster({
  path,
  size = "w342",
  title,
  rounded = "md",
  className,
  srcSetSizes,
  sizes,
  ...rest
}: MediaPosterProps) {
  const radiusClass =
    rounded === "sm" ? "rx-radius-sm" : rounded === "lg" ? "rx-radius-lg" : rounded === "xl" ? "rx-radius-xl" : "rx-radius";
  if (!path) {
    return (
      <div
        className={cx("rx-poster-ph", className)}
        aria-hidden="true"
        data-rounded={radiusClass}
      >
        🎬
      </div>
    );
  }
  const src = `https://image.tmdb.org/t/p/${size}${path}`;
  const ladder = srcSetSizes && srcSetSizes.length > 0 ? srcSetSizes : DEFAULT_LADDER;
  const srcSet = ladder
    .map((s) => `https://image.tmdb.org/t/p/${s}${path} ${sizeToWidth(s)}w`)
    .join(", ");
  const computedSizes =
    sizes ?? "(max-width: 520px) 42vw, (max-width: 900px) 28vw, 220px";
  return (
    <img
      src={src}
      srcSet={srcSet}
      sizes={computedSizes}
      alt={title ?? ""}
      loading="lazy"
      decoding="async"
      className={cx("rx-poster-img", className)}
      data-rounded={radiusClass}
      {...rest}
    />
  );
}
