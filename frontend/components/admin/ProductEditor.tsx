"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  ImagePlus,
  ImageIcon,
  Package,
  Search,
  ShieldCheck,
  Snowflake,
  Trash2,
  Video,
} from "lucide-react";
import { z } from "zod";
import { ApiError, apiRequest } from "../../lib/api-client";
import {
  adminMultipart,
  imageReceipt,
  MAX_PRODUCT_IMAGES,
  MAX_VIDEO_BYTES,
  productBody,
  productRecord,
  readResource,
  validateCatalogImage,
  videoReceipt,
  type ProductRecord,
} from "../../lib/admin-management";
import {
  productMediaUrl,
  productNameWithStrength,
  productSeoDescription,
  productSeoTitle,
  productSlug,
} from "../../lib/product-form";
import { useAdminOperation } from "../../hooks/useAdminOperation";
import { CatalogImage } from "../catalog/CatalogImage";
import { AdminLink } from "./AdminShell";
import { AdminOperationFeedback } from "./AdminOperationFeedback";
import { MasterPicker } from "./MasterPicker";
import { ProductDescriptionEditor } from "./ProductDescriptionEditor";

type Language = "en" | "zhCN";
type Translation = {
  brand_name: string;
  slug: string;
  description: string;
  seo_title: string;
  meta_description: string;
  indication_summary: string;
  usage_notes: string;
  storage_condition: string;
  image_alt_text: string;
};
const blankTranslation = (): Translation => ({
  brand_name: "",
  slug: "",
  description: "",
  seo_title: "",
  meta_description: "",
  indication_summary: "",
  usage_notes: "",
  storage_condition: "",
  image_alt_text: "",
});
const translationsFor = (record: ProductRecord | null) => ({
  en: { ...blankTranslation(), ...record?.translations.en },
  zhCN: { ...blankTranslation(), ...record?.translations.zhCN },
});
const fieldsFor = (record: ProductRecord | null) => ({
  sku: record?.sku ?? "",
  strength: record?.strength ?? "",
  dosage_form: record?.dosage_form ?? "",
  pack_size: record?.pack_size ?? "",
  packaging_unit: record?.packaging_unit ?? "",
  storage_condition: record?.storage_condition ?? "",
});

function Card({
  title,
  icon,
  children,
  subtitle,
  className = '',
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  subtitle?: string;
  className?: string;
}) {
  return (
    <section className={`product-form-card ${className}`}>
      <header>
        <span>{icon}</span>
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </header>
      <div className="product-form-card-body">{children}</div>
    </section>
  );
}

export function ProductEditor({
  initial,
  units,
  onCreated,
}: {
  initial: ProductRecord | null;
  units: string[];
  onCreated: (record: ProductRecord) => void;
}) {
  const [record, setRecord] = useState(initial);
  const [content, setContent] = useState(() => translationsFor(initial));
  const [fields, setFields] = useState(() => fieldsFor(initial));
  const [language, setLanguage] = useState<Language>("en");
  const [chinese, setChinese] = useState(!!initial?.translations.zhCN);
  const [cold, setCold] = useState(initial?.cold_chain_required ?? false);
  const [status, setStatus] = useState<ProductRecord["status"]>(
    initial?.status ?? "DRAFT",
  );
  const [images, setImages] = useState(initial?.image_keys ?? []);
  const [video, setVideo] = useState(initial?.video_key ?? "");
  const [seoImage, setSeoImage] = useState(initial?.seo_image_key ?? "");
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<"images" | "video" | "seo" | null>(
    null,
  );
  const [mediaError, setMediaError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [pickerVersion, setPickerVersion] = useState(0);
  const [review, setReview] = useState(!!initial?.review_metadata);
  const [reviewKind, setReviewKind] = useState<"TECHNICAL" | "MEDICAL">(
    initial?.review_metadata?.kind ?? "TECHNICAL",
  );
  const [reviewName, setReviewName] = useState(
    initial?.review_metadata?.reviewer_name ?? "",
  );
  const [reviewDate, setReviewDate] = useState(
    initial?.review_metadata?.reviewed_at.slice(0, 16) ?? "",
  );
  const uploadLock = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const { operation, state } = useAdminOperation();
  useEffect(() => setReady(true), []);
  const disabled = !ready || state.busy || state.blocked || uploading !== null;
  const mediaUrl = (key: string) => mediaUrls[key] ?? productMediaUrl(key);
  const locale = language === "en" ? "EN" : "ZH";
  const translated = content[language];
  const slugFor = (lang: Language) =>
    content[lang].slug ||
    productSlug(
      productNameWithStrength(content[lang].brand_name, fields.strength),
    );
  const previewPath = `/${language === "en" ? "en" : "zh-CN"}/products/${encodeURIComponent(slugFor(language))}`;
  const site =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://medaxisglobalpharma.com";
  const errorFor = (path: string) =>
    errors[path] ? (
      <span className="product-field-error" role="alert">
        {errors[path]}
      </span>
    ) : null;
  function changeContent(key: keyof Translation, value: string) {
    setContent((old) => ({
      ...old,
      [language]: { ...old[language], [key]: value },
    }));
  }
  function textField(
    key: keyof typeof fields,
    label: string,
    placeholder: string,
    maxLength = 100,
  ) {
    return (
      <label>
        <span>
          {label} <small>Required</small>
        </span>
        <input
          name={key}
          aria-label={key === "sku" ? "sku" : label}
          value={fields[key]}
          placeholder={placeholder}
          maxLength={maxLength}
          aria-invalid={!!errors[key]}
          onChange={(event) =>
            setFields((old) => ({ ...old, [key]: event.target.value }))
          }
        />
        {errorFor(key)}
      </label>
    );
  }
  async function uploadImages(
    files: File[],
    target: "main" | "additional" | "seo",
  ) {
    if (!files.length || uploadLock.current || state.busy) return;
    setMediaError("");
    if (
      target === "additional" &&
      images.length + files.length > MAX_PRODUCT_IMAGES
    ) {
      setMediaError("Keep one main image and up to 5 additional pictures.");
      return;
    }
    uploadLock.current = true;
    setUploading(target === "seo" ? "seo" : "images");
    try {
      for (const file of files) await validateCatalogImage(file);
      for (const file of files) {
        const data = new FormData();
        data.set("image", file);
        const receipt = await adminMultipart(
          "/api/admin/catalog/images",
          data,
          imageReceipt,
        );
        setMediaUrls((old) => ({ ...old, [receipt.object_key]: receipt.url }));
        if (target === "seo") setSeoImage(receipt.object_key);
        else if (target === "main")
          setImages((old) =>
            old.length
              ? [receipt.object_key, ...old.slice(1)]
              : [receipt.object_key],
          );
        else setImages((old) => [...old, receipt.object_key]);
      }
    } catch (error: unknown) {
      setMediaError(
        error instanceof ApiError && error.status === 422
          ? "Choose valid JPEG, PNG or WebP pictures, up to 5 MiB each."
          : "Image upload could not be completed. Check the connection and select the file again to retry.",
      );
    } finally {
      uploadLock.current = false;
      setUploading(null);
    }
  }
  async function uploadVideo(file: File) {
    if (uploadLock.current || state.busy) return;
    setMediaError("");
    if (
      !["video/mp4", "video/webm"].includes(file.type) ||
      !file.size ||
      file.size > MAX_VIDEO_BYTES
    ) {
      setMediaError("Choose an MP4 or WebM video up to 50 MiB.");
      return;
    }
    uploadLock.current = true;
    setUploading("video");
    try {
      const data = new FormData();
      data.set("video", file);
      const receipt = await adminMultipart(
        "/api/admin/catalog/videos",
        data,
        videoReceipt,
      );
      setMediaUrls((old) => ({ ...old, [receipt.object_key]: receipt.url }));
      setVideo(receipt.object_key);
    } catch {
      setMediaError(
        "Video upload could not be completed. Use a readable MP4 or WebM up to 50 MiB, then select it again to retry.",
      );
    } finally {
      uploadLock.current = false;
      setUploading(null);
    }
  }
  function load(saved: ProductRecord) {
    setRecord(saved);
    setContent(translationsFor(saved));
    setFields(fieldsFor(saved));
    setChinese(!!saved.translations.zhCN);
    setLanguage("en");
    setCold(saved.cold_chain_required);
    setStatus(saved.status);
    setImages(saved.image_keys);
    setVideo(saved.video_key ?? "");
    setSeoImage(saved.seo_image_key ?? "");
    setReview(!!saved.review_metadata);
    setReviewKind(saved.review_metadata?.kind ?? "TECHNICAL");
    setReviewName(saved.review_metadata?.reviewer_name ?? "");
    setReviewDate(saved.review_metadata?.reviewed_at.slice(0, 16) ?? "");
    setErrors({});
    setPickerVersion((old) => old + 1);
  }
  async function refresh() {
    if (!record) return;
    const saved = productRecord.parse({
      ...(await readResource("products", record.id)),
      _id: record.id,
    });
    if (saved.updated_at !== record.updated_at)
      operation.reconcileAdvancedVersion();
    load(saved);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || uploadLock.current) return;
    const button = (event.nativeEvent as SubmitEvent).submitter;
    const requestedStatus =
      button instanceof HTMLButtonElement && button.value
        ? button.value
        : status;
    const data = new FormData(event.currentTarget);
    const translate = (lang: Language) =>
      Object.fromEntries(
        Object.entries({ ...content[lang], slug: slugFor(lang) })
          .filter(([, value]) => value.trim())
          .map(([key, value]) => [key, value.trim()]),
      );
    const candidate = {
      ...fields,
      sku: fields.sku.trim().toUpperCase(),
      manufacturer_id: data.get("manufacturer_id"),
      generic_id: data.get("generic_id"),
      category_ids: data.getAll("category_ids"),
      translations: {
        en: translate("en"),
        ...(chinese ? { zhCN: translate("zhCN") } : {}),
      },
      cold_chain_required: cold,
      image_keys: images,
      video_key: video || null,
      seo_image_key: seoImage || null,
      status: requestedStatus,
      review_metadata: review
        ? {
            kind: reviewKind,
            reviewer_name: reviewName,
            reviewed_at: reviewDate
              ? new Date(`${reviewDate}Z`).toISOString()
              : "",
          }
        : null,
    };
    // Optional empty storage values must be omitted; explicit null clears optional media.
    if (!candidate.storage_condition)
      delete (candidate as Partial<typeof candidate>).storage_condition;
    const parsed = productBody.safeParse(candidate);
    if (!parsed.success) {
      const issues = Object.fromEntries(
        parsed.error.issues.map((issue) => [
          issue.path.join("."),
          issue.path.includes("image_keys")
            ? "Use at most 6 product images in total."
            : "Complete this field with a valid value.",
        ]),
      );
      setErrors(issues);
      if (
        Object.keys(issues).some((key) => key.startsWith("translations.zhCN"))
      )
        setLanguage("zhCN");
      else if (
        Object.keys(issues).some((key) => key.startsWith("translations.en"))
      )
        setLanguage("en");
      requestAnimationFrame(() => errorSummary.current?.focus());
      return;
    }
    setErrors({});
    await operation.run(
      async () => {
        const completeTranslation = (
          value: typeof parsed.data.translations.en,
        ) => ({
          ...Object.fromEntries(
            [
              "description",
              "seo_title",
              "meta_description",
              "indication_summary",
              "usage_notes",
              "storage_condition",
              "image_alt_text",
            ].map((key) => [key, null]),
          ),
          ...value,
        });
        const payload = record
          ? {
              ...parsed.data,
              storage_condition: parsed.data.storage_condition ?? null,
              translations: {
                en: completeTranslation(parsed.data.translations.en),
                zhCN:
                  chinese && parsed.data.translations.zhCN
                    ? completeTranslation(parsed.data.translations.zhCN)
                    : null,
              },
            }
          : { ...parsed.data, review_metadata: parsed.data.review_metadata ?? undefined };
        try {
          return (
            await apiRequest(
              `/v1/admin/catalog/products${record ? "/" + record.id : ""}`,
              productRecord,
              {
                method: record ? "PATCH" : "POST",
                json: z.json().parse(JSON.parse(JSON.stringify(payload))),
                timeoutMs: 20_000,
              },
            )
          ).data;
        } catch (error: unknown) {
          if (
            error instanceof ApiError &&
            error.responseValidated &&
            error.status === 422
          ) {
            setErrors(
              Object.fromEntries(
                error.details.map((detail) => [
                  detail.field,
                  detail.field.includes("slug")
                    ? "This page slug is already in use or reserved. Choose another slug."
                    : detail.field === "sku"
                      ? "This SKU is already in use. Enter or generate another SKU."
                      : "Check this field and try again.",
                ]),
              ),
            );
            requestAnimationFrame(() => errorSummary.current?.focus());
          }
          throw error;
        }
      },
      refresh,
      (saved) => {
        if (!record) onCreated(saved);
        else load(saved);
      },
    );
  }

  return (
    <div className="admin-product-editor">
      <div className="admin-page-heading">
        <div>
          <AdminLink href="/admin/catalog/products">Product list</AdminLink>
          <h1>
            <Package size={27} />
            {record ? "Edit Product" : "Add New Product"}
          </h1>
          <p>Medicine details, product media and search appearance.</p>
        </div>
        {record && (
          <button
            type="button"
            className="button secondary"
            disabled={disabled && !state.blocked}
            onClick={() => void operation.refresh(refresh)}
          >
            Refresh saved state
          </button>
        )}
      </div>
      <AdminOperationFeedback state={state} />
      <form ref={form} noValidate onSubmit={submit}>
        {!!Object.keys(errors).length && (
          <div
            ref={errorSummary}
            tabIndex={-1}
            className="product-form-errors"
            role="alert"
          >
            <strong>Check the highlighted fields before saving.</strong>
            <ul>
              {Object.entries(errors).map(([key, issue]) => (
                <li key={key}>
                  {key.replaceAll("_", " ").replaceAll("translations.", "")}:{" "}
                  {issue}
                </li>
              ))}
            </ul>
          </div>
        )}
        <fieldset disabled={disabled} className="product-form-fields">
          <Card title="Product information" icon={<Package size={21} />}>
            <div className="product-language-bar">
              <div role="tablist" aria-label="Product language">
                <button
                  type="button"
                  role="tab"
                  aria-selected={language === "en"}
                  onClick={() => setLanguage("en")}
                >
                  English (EN)
                </button>
                {chinese && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={language === "zhCN"}
                    onClick={() => setLanguage("zhCN")}
                  >
                    中文 (ZH)
                  </button>
                )}
              </div>
              <label className="product-translation-toggle">
                <input
                  type="checkbox"
                  checked={chinese}
                  onChange={(event) => {
                    setChinese(event.target.checked);
                    if (!event.target.checked) setLanguage("en");
                  }}
                />
                Chinese translation
              </label>
            </div>
            {(["en", "zhCN"] as const).map((lang) => (
              <div
                key={lang}
                hidden={language !== lang}
                className="product-language-panel"
                role="tabpanel"
                aria-label={
                  lang === "en"
                    ? "English product information"
                    : "Chinese product information"
                }
              >
                <label>
                  <span>
                    Product name ({lang === "en" ? "EN" : "ZH"}){" "}
                    <small>Required</small>
                  </span>
                  <input
                    name={`${lang}_brand_name`}
                    lang={lang === "en" ? "en" : "zh-CN"}
                    maxLength={200}
                    placeholder="e.g. Medicine brand name"
                    value={content[lang].brand_name}
                    aria-invalid={!!errors[`translations.${lang}.brand_name`]}
                    onChange={(event) =>
                      setContent((old) => ({
                        ...old,
                        [lang]: {
                          ...old[lang],
                          brand_name: event.target.value,
                        },
                      }))
                    }
                  />
                  {errorFor(`translations.${lang}.brand_name`)}
                </label>
                <ProductDescriptionEditor
                  label={`Description (${lang === "en" ? "EN" : "ZH"})`}
                  lang={lang === "en" ? "en" : "zh-CN"}
                  value={content[lang].description}
                  disabled={disabled}
                  onChange={(value) =>
                    setContent((old) => ({
                      ...old,
                      [lang]: { ...old[lang], description: value },
                    }))
                  }
                />
                {errorFor(`translations.${lang}.description`)}
              </div>
            ))}
          </Card>

          <Card
            title="Medicine details"
            className="product-medicine-card"
            icon={<ShieldCheck size={21} />}
            subtitle="Choose existing directory entries so the medicine is linked correctly."
          >
            <div className="product-master-grid" key={pickerVersion}>
              <div>
                <MasterPicker
                  kind="manufacturers"
                  label="Manufacturer"
                  name="manufacturer_id"
                  initial={record ? [{ id: record.manufacturer_id }] : []}
                />
                {errorFor("manufacturer_id")}
              </div>
              <div>
                <MasterPicker
                  kind="generics"
                  label="Generic"
                  name="generic_id"
                  initial={record ? [{ id: record.generic_id }] : []}
                />
                {errorFor("generic_id")}
              </div>
              <div>
                <MasterPicker
                  kind="categories"
                  label="Categories"
                  name="category_ids"
                  multiple
                  initial={record?.category_ids.map((id) => ({ id }))}
                />
                {errorFor("category_ids")}
              </div>
            </div>
            <div className="product-fields-grid">
              {textField("strength", "Strength", "e.g. 80 mg")}
              {textField("dosage_form", "Dosage form", "e.g. Tablet")}
              <div className="product-sku-field">
                {textField("sku", "Product SKU", "e.g. MED-80MG-BOX", 200)}
                <button
                  type="button"
                  onClick={() =>
                    setFields((old) => ({
                      ...old,
                      sku: `MED-${crypto.randomUUID().slice(0, 12).replaceAll("-", "").toUpperCase()}`,
                    }))
                  }
                >
                  Generate SKU
                </button>
              </div>
            </div>
          </Card>

          <Card title="Packaging & storage" icon={<Snowflake size={21} />}>
            <div className="product-fields-grid">
              {textField("pack_size", "Pack size", "e.g. 30 tablets")}
              <label>
                <span>
                  Packaging unit <small>Required</small>
                </span>
                <select
                  name="packaging_unit"
                  value={fields.packaging_unit}
                  aria-invalid={!!errors.packaging_unit}
                  onChange={(event) =>
                    setFields((old) => ({
                      ...old,
                      packaging_unit: event.target.value,
                    }))
                  }
                >
                  <option value="">Select unit</option>
                  {[
                    ...new Set([
                      ...units,
                      ...(record ? [record.packaging_unit] : []),
                    ]),
                  ].map((unit) => (
                    <option key={unit}>{unit}</option>
                  ))}
                </select>
                {errorFor("packaging_unit")}
              </label>
              <label>
                <span>
                  Storage instructions <small>Optional</small>
                </span>
                <input
                  name="storage_condition"
                  value={fields.storage_condition}
                  maxLength={200}
                  placeholder="e.g. Store below 25°C"
                  onChange={(event) =>
                    setFields((old) => ({
                      ...old,
                      storage_condition: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <label className="product-cold-toggle">
              <span>
                <strong>Cold chain required</strong>
                <small>
                  Enable only when the product requires temperature-controlled
                  handling.
                </small>
              </span>
              <input
                type="checkbox"
                name="cold_chain_required"
                checked={cold}
                onChange={(event) => setCold(event.target.checked)}
              />
            </label>
          </Card>

          <Card
            title="Product images"
            icon={<ImageIcon size={21} />}
            subtitle="One main image and up to 5 additional pictures. JPEG, PNG or WebP, up to 5 MiB each."
          >
            <div className="product-media-grid">
              <div className="product-main-media">
                <h3>Main image</h3>
                <div className="product-image-frame">
                  {images[0] ? (
                    <CatalogImage unoptimized
                      key={images[0]} src={mediaUrl(images[0])}
                      alt="Main product image preview"
                      width={280}
                      height={280}
                      sizes="280px"
                      fallbackLabel="Preview unavailable"
                    />
                  ) : (
                    <ImagePlus size={46} />
                  )}
                </div>
                <label className="product-file-button">
                  {images.length ? "Replace main image" : "Upload main image"}
                  <input
                    className="sr-only"
                    type="file"
                    aria-label="Upload product image"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void uploadImages([file], "main");
                    }}
                  />
                </label>
                {images[0] && (
                  <button
                    type="button"
                    className="product-remove"
                    onClick={() => setImages((old) => old.slice(1))}
                  >
                    Remove main image
                  </button>
                )}
                <p className="product-field-help">
                  Square images recommended. Keep the packaging readable.
                </p>
              </div>
              <div>
                <h3>
                  Additional pictures{" "}
                  <span className="product-media-count">
                    {Math.max(0, images.length - 1)}/5
                  </span>
                </h3>
                <div className="product-additional-grid">
                  {images.slice(1).map((key, index) => (
                    <div className="product-additional-image" key={key}>
                      <CatalogImage unoptimized
                        src={mediaUrl(key)}
                        alt={`Additional product image ${index + 1}`}
                        width={180}
                        height={180}
                        sizes="180px"
                        fallbackLabel="Preview unavailable"
                      />
                      <div>
                        <button
                          type="button"
                          onClick={() =>
                            setImages((old) => [
                              key,
                              ...old.filter((item) => item !== key),
                            ])
                          }
                        >
                          Set as main
                        </button>
                        <button
                          type="button"
                          aria-label={`Move additional image ${index + 1} earlier`}
                          disabled={index === 0}
                          onClick={() =>
                            setImages((old) => {
                              const next = [...old];
                              [next[index], next[index + 1]] = [
                                next[index + 1]!,
                                next[index]!,
                              ];
                              return next;
                            })
                          }
                        >
                          Move earlier
                        </button>
                        <button
                          type="button"
                          className="product-remove"
                          aria-label={`Remove additional image ${index + 1}`}
                          onClick={() =>
                            setImages((old) =>
                              old.filter((item) => item !== key),
                            )
                          }
                        >
                          <Trash2 size={15} />
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <label
                  className={`product-upload-zone ${images.length >= MAX_PRODUCT_IMAGES ? "is-full" : ""}`}
                >
                  <ImagePlus size={30} />
                  <strong>
                    {images.length >= MAX_PRODUCT_IMAGES
                      ? "All 5 additional slots are filled"
                      : "Add additional pictures"}
                  </strong>
                  <span>Select one or more pictures</span>
                  <input
                    type="file"
                    multiple
                    className="sr-only"
                    aria-label="Upload additional pictures"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={images.length >= MAX_PRODUCT_IMAGES}
                    onChange={(event) => {
                      const files = [...(event.target.files ?? [])];
                      event.target.value = "";
                      void uploadImages(files, "additional");
                    }}
                  />
                </label>
              </div>
            </div>
            <label>
              <span>
                Image alt text ({locale}) <small>Optional</small>
              </span>
              <input
                value={translated.image_alt_text}
                maxLength={200}
                placeholder="Describe the product packaging"
                onChange={(event) =>
                  changeContent("image_alt_text", event.target.value)
                }
              />
            </label>
            {errorFor("image_keys")}
          </Card>

          <Card
            title="Product video"
            icon={<Video size={21} />}
            subtitle="Optional. Upload one MP4 or WebM video, up to 50 MiB."
          >
            {video && mediaUrl(video) && (
              <video
                className="product-video-preview"
                controls
                playsInline
                preload="metadata"
                src={mediaUrl(video)!}
                aria-label="Product video preview"
              />
            )}
            <div className="product-video-actions">
              <label className="product-file-button">
                {video ? "Replace video" : "Upload video"}
                <input
                  className="sr-only"
                  type="file"
                  aria-label="Upload product video"
                  accept="video/mp4,video/webm"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void uploadVideo(file);
                  }}
                />
              </label>
              {video && (
                <button
                  type="button"
                  className="product-remove"
                  onClick={() => setVideo("")}
                >
                  Remove video
                </button>
              )}
            </div>
            {!video && (
              <p className="product-field-help">
                You can publish the product without adding a video.
              </p>
            )}
          </Card>

          <Card
            title="Search engine details"
            icon={<Search size={21} />}
            subtitle={`Editing ${language === "en" ? "English" : "Chinese"} search appearance. Use the language tabs above to switch.`}
          >
            <div className="product-seo-grid">
              <div className="product-seo-fields">
                <label>
                  <span>Page slug ({locale})</span>
                  <input
                    value={translated.slug}
                    placeholder={
                      slugFor(language) || "generated-from-product-name"
                    }
                    maxLength={200}
                    onChange={(event) =>
                      changeContent("slug", event.target.value)
                    }
                    aria-invalid={!!errors[`translations.${language}.slug`]}
                  />
                  {errorFor(`translations.${language}.slug`)}
                  <small className="product-url-preview">
                    {site}
                    {previewPath}
                  </small>
                </label>
                <label>
                  <span>
                    Meta title ({locale}) <small>Optional</small>
                  </span>
                  <input
                    value={translated.seo_title}
                    maxLength={200}
                    placeholder={productNameWithStrength(
                      translated.brand_name,
                      fields.strength,
                    )}
                    onChange={(event) =>
                      changeContent("seo_title", event.target.value)
                    }
                  />
                  <small className="product-field-help">
                    {translated.seo_title.length}/200 · Site name is appended
                    automatically.
                  </small>
                </label>
                <label>
                  <span>
                    Meta description ({locale}) <small>Optional</small>
                  </span>
                  <textarea
                    value={translated.meta_description}
                    rows={4}
                    maxLength={500}
                    placeholder="A concise, factual summary of this product and sourcing enquiry."
                    onChange={(event) =>
                      changeContent("meta_description", event.target.value)
                    }
                  />
                  <small className="product-field-help">
                    {translated.meta_description.length}/500 · Keep it concise
                    and specific to this medicine.
                  </small>
                </label>
              </div>
              <div className="product-social-image">
                <h3>
                  Social sharing image <small>Optional</small>
                </h3>
                <div className="product-social-frame">
                  {seoImage || images[0] ? (
                    <CatalogImage unoptimized
                      key={seoImage || images[0]} src={mediaUrl(seoImage || images[0]!)}
                      alt="Social sharing preview"
                      width={480}
                      height={252}
                      sizes="(max-width: 700px) 90vw, 400px"
                      fallbackLabel="Preview unavailable"
                    />
                  ) : (
                    <ImagePlus size={36} />
                  )}
                </div>
                <label className="product-file-button">
                  Upload social image
                  <input
                    className="sr-only"
                    type="file"
                    aria-label="Upload social sharing image"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void uploadImages([file], "seo");
                    }}
                  />
                </label>
                {seoImage && (
                  <button
                    type="button"
                    className="product-remove"
                    onClick={() => setSeoImage("")}
                  >
                    Use main product image
                  </button>
                )}
                <p className="product-field-help">
                  1200 × 630 recommended. Uses the main image when no separate
                  image is selected.
                </p>
              </div>
            </div>
            <div
              className="product-search-preview"
              aria-label="Search result preview"
            >
              <span>Search preview · {locale}</span>
              <p className="product-preview-url">
                {site}
                {previewPath}
              </p>
              <h3>
                {productSeoTitle(
                  translated.brand_name,
                  fields.strength,
                  translated.seo_title,
                )}
              </h3>
              <p>
                {translated.meta_description ||
                  productSeoDescription(
                    translated.description,
                    translated.brand_name,
                    fields.strength,
                  )}
              </p>
              <small>
                Search engines may display a different title or snippet.
              </small>
            </div>
          </Card>

          <details className="product-form-card product-additional-details">
            <summary>
              <ChevronDown size={19} />
              Additional information <small>Optional</small>
            </summary>
            <div className="product-form-card-body">
              <div className="product-fields-grid">
                <label>
                  Indications ({locale})
                  <textarea
                    value={translated.indication_summary}
                    maxLength={2000}
                    rows={3}
                    onChange={(event) =>
                      changeContent("indication_summary", event.target.value)
                    }
                  />
                </label>
                <label>
                  Usage notes ({locale})
                  <textarea
                    value={translated.usage_notes}
                    maxLength={2000}
                    rows={3}
                    onChange={(event) =>
                      changeContent("usage_notes", event.target.value)
                    }
                  />
                </label>
                <label>
                  Localized storage instructions ({locale})
                  <input
                    value={translated.storage_condition}
                    maxLength={500}
                    onChange={(event) =>
                      changeContent("storage_condition", event.target.value)
                    }
                  />
                </label>
              </div>
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={review}
                  onChange={(event) => setReview(event.target.checked)}
                />
                Record an actual completed review
              </label>
              {review && (
                <div className="product-fields-grid">
                  <label>
                    Review kind
                    <select
                      value={reviewKind}
                      onChange={(event) =>
                        setReviewKind(event.target.value as typeof reviewKind)
                      }
                    >
                      <option>TECHNICAL</option>
                      <option>MEDICAL</option>
                    </select>
                  </label>
                  <label>
                    Reviewer name
                    <input
                      value={reviewName}
                      maxLength={200}
                      onChange={(event) => setReviewName(event.target.value)}
                    />
                  </label>
                  <label>
                    Reviewed at (UTC)
                    <input
                      type="datetime-local"
                      value={reviewDate}
                      onChange={(event) => setReviewDate(event.target.value)}
                    />
                  </label>
                </div>
              )}
            </div>
          </details>
        </fieldset>
        {uploading && (
          <p role="status" className="product-upload-status">
            Uploading{" "}
            {uploading === "video"
              ? "video"
              : uploading === "seo"
                ? "social image"
                : "pictures"}
            … Keep this page open.
          </p>
        )}
        {mediaError && (
          <p role="alert" className="product-form-errors">
            {mediaError}
          </p>
        )}
        <div className="product-publish-bar">
          <div>
            <label>
              Status
              <select
                aria-label="Status"
                disabled={disabled}
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as typeof status)
                }
              >
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
                {record && <option value="ARCHIVED">Archived</option>}
              </select>
            </label>
            <p>
              Pricing and availability are handled through private quotations.
            </p>
          </div>
          <div className="product-publish-actions">
            <AdminLink
              href="/admin/catalog/products"
              className="button secondary"
            >
              Back to list
            </AdminLink>
            <button
              type="submit"
              name="save_action"
              value="DRAFT"
              className="button secondary"
              disabled={disabled}
            >
              Save draft
            </button>
            {record && (
              <button
                type="submit"
                name="save_action"
                value={status}
                className="button secondary"
                disabled={disabled}
              >
                Save changes
              </button>
            )}
            <button
              type="submit"
              name="save_action"
              value="PUBLISHED"
              className="button primary"
              disabled={disabled}
            >
              {state.busy ? "Saving…" : "Publish product"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
