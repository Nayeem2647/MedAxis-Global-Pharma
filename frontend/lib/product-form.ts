import { plainText, publicAssetUrl, publicVideoUrl } from "./public-catalog";

export const productSlug = (value: string) =>
  value
    .normalize("NFC")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 200)
    .replace(/-$/, "");

export function productNameWithStrength(name: string, strength: string) {
  return strength && !name.toLowerCase().includes(strength.toLowerCase())
    ? `${name} ${strength}`.trim()
    : name;
}

export function productSeoTitle(name: string, strength = "", custom = "") {
  const title = plainText(
    custom || productNameWithStrength(name, strength),
  ).trim();
  return `${title || "Medicine sourcing"} | MedAxis Global Pharma`;
}

export function productSeoDescription(
  description: string,
  name: string,
  strength = "",
) {
  const text = plainText(description).trim();
  return (
    text ||
    `Request sourcing information and a private quotation for ${productNameWithStrength(name, strength) || "this medicine"} from MedAxis Global Pharma.`
  ).slice(0, 300);
}

/** Existing keys are rendered through the same approved origins as public assets. */
export function productMediaUrl(key: string | null | undefined) {
  if (
    !key ||
    !/^products\/[a-zA-Z0-9/_-]+\.(?:jpg|jpeg|png|webp|mp4|webm)$/.test(key)
  )
    return null;
  const local = key.startsWith("products/local/");
  const base =
    local && process.env.NODE_ENV !== "production"
      ? `${process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "")}/v1/public/media`
      : key.startsWith("products/s3/")
        ? process.env.NEXT_PUBLIC_S3_PUBLIC_BASE_URL
        : (process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL ??
          process.env.NEXT_PUBLIC_S3_PUBLIC_BASE_URL);
  if (!base) return null;
  const url = `${base.replace(/\/$/, "")}/${key}`;
  return /\.(?:mp4|webm)$/.test(key)
    ? publicVideoUrl(url)
    : publicAssetUrl(url);
}
