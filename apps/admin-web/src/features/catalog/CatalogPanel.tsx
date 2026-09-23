import { useState } from "react";
import type { FormEvent } from "react";
import { ALLERGENS } from "../../../../../src/allergens.js";
import type { BundleItem, ModifierGroup, Product, VatPercent } from "@zhaoyun/domain";
import type { AdminProductInput } from "@zhaoyun/api-client";
import type { ProductFilter } from "../../app/types";
import { formatMoney, useI18n } from "../../app/i18n";
import type { AdminLanguage, Translate } from "../../app/i18n";

interface Props {
  products: Product[];
  editing: Product | null;
  filter: ProductFilter;
  mediaUrl: (path: string) => string;
  onFilter: (filter: ProductFilter) => void;
  onEdit: (product: Product | null) => void;
  onSave: (input: AdminProductInput, id: string | null, media: File | null) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}

function readText(form: FormData, name: string): string { return String(form.get(name) || "").trim(); }

function isModifierGroup(value: unknown): value is ModifierGroup {
  if (!value || typeof value !== "object") return false;
  const group = value as Partial<ModifierGroup>;
  const names = group.names;
  return typeof group.id === "string" && Boolean(group.id.trim()) &&
    (group.selection === "single" || group.selection === "multi") &&
    Boolean(names) && typeof names === "object" &&
    ["zh", "de", "en"].every((language) => typeof names[language as keyof typeof names] === "string") &&
    Array.isArray(group.options) && group.options.every((option) => {
      if (!option || typeof option !== "object") return false;
      const item = option as ModifierGroup["options"][number];
      return typeof item.id === "string" && Boolean(item.id.trim()) &&
        item.names && ["zh", "de", "en"].every((language) => typeof item.names[language as keyof typeof item.names] === "string") &&
        Number.isInteger(item.priceCents) && item.priceCents >= 0;
    });
}

function readModifiers(form: FormData, t: Translate): ModifierGroup[] {
  const raw = readText(form, "modifiers");
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(t("modifiersInvalid"));
  }
  if (!Array.isArray(parsed) || !parsed.every(isModifierGroup)) throw new Error(t("modifiersInvalid"));
  return parsed;
}

/** A dish's name in the console's language, falling back through the others. */
function nameIn(product: Product, language: AdminLanguage): string {
  return product.names[language] || product.names.zh || product.names.de || product.names.en;
}

/** Kept in sync by `BundleFieldset`'s hidden input, the same way the raw
 *  modifiers textarea above feeds `readModifiers`. */
function readBundleItems(form: FormData): BundleItem[] {
  const raw = readText(form, "bundleItems");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is BundleItem => Boolean(item) && typeof item.productId === "string" && Number.isInteger(item.quantity) && item.quantity >= 1);
  } catch {
    return [];
  }
}

/**
 * 套餐 (combo) is an ordinary product that also lists the existing dishes it
 * packages. This picks them from the catalogue already loaded rather than
 * asking the admin to type ids, and keeps its own state in sync with a hidden
 * input so `submit` below can read it exactly like the modifiers textarea.
 * It remounts (and its state resets) with the rest of the form whenever the
 * admin switches which product they are editing, via the form's own `key`.
 */
function BundleFieldset({ product, products }: { product: Product | null; products: Product[] }) {
  const { t, language } = useI18n();
  const [items, setItems] = useState<BundleItem[]>(() => (product?.bundleItems ?? []).map((item) => ({ ...item })));
  const candidates = products.filter((candidate) => candidate.id !== product?.id);

  function toggle(productId: string, checked: boolean) {
    setItems((current) => checked ? [...current, { productId, quantity: 1 }] : current.filter((item) => item.productId !== productId));
  }
  function setQuantity(productId: string, quantity: number) {
    setItems((current) => current.map((item) => item.productId === productId ? { ...item, quantity: Math.max(1, Math.min(99, quantity)) } : item));
  }

  return <fieldset className="bundle-picker">
    <legend>{t("bundleLegend")}</legend>
    <input type="hidden" name="bundleItems" value={JSON.stringify(items)} readOnly />
    <div className="bundle-picker-list">{candidates.length ? candidates.map((candidate) => {
      const selected = items.find((item) => item.productId === candidate.id);
      return <label key={candidate.id} className="bundle-picker-row">
        <input type="checkbox" checked={Boolean(selected)} onChange={(event) => toggle(candidate.id, event.target.checked)} />
        <span>{nameIn(candidate, language)}</span>
        {selected && <input type="number" min={1} max={99} value={selected.quantity} onChange={(event) => setQuantity(candidate.id, Number(event.target.value) || 1)} />}
      </label>;
    }) : <p className="bundle-picker-empty">{t("bundleEmpty")}</p>}</div>
  </fieldset>;
}

export function CatalogPanel(props: Props) {
  const { t, language } = useI18n();
  // On a phone the list and the form cannot both be on screen, so the list
  // comes first and the form opens over it; on a wide screen both show and
  // this is ignored.
  const [editorOpen, setEditorOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const rows = props.products.filter((product) => props.filter === "all" || product.kind === props.filter);
  const kindLabels: Record<Product["kind"], string> = { food: t("kindFood"), drink: t("kindDrink"), sushi: t("kindSushi") };
  const stationOptions: Array<[AdminProductInput["printStation"], string]> = [
    ["kitchen", t("stationKitchen")], ["bar", t("stationBar")], ["sushi", t("stationSushi")], ["front", t("stationFront")]
  ];

  function open(product: Product | null) {
    props.onEdit(product);
    setFormError("");
    setEditorOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    let modifiers: ModifierGroup[];
    try {
      modifiers = readModifiers(data, t);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t("modifiersInvalid"));
      return;
    }
    setFormError("");
    const input: AdminProductInput = {
      sku: readText(data, "sku"),
      kind: readText(data, "kind") as AdminProductInput["kind"],
      category: readText(data, "category"),
      names: { zh: readText(data, "nameZh"), de: readText(data, "nameDe"), en: readText(data, "nameEn") },
      description: readText(data, "description"),
      price: Number(data.get("price")),
      details: { ingredients: readText(data, "ingredients"), time: readText(data, "time"), people: readText(data, "people"), level: readText(data, "level") },
      allergens: data.getAll("allergens").map((value) => String(value)),
      vatPercent: (Number(data.get("vatPercent")) || 10) as VatPercent,
      modifiers,
      bundleItems: readBundleItems(data),
      printStation: readText(data, "printStation") as AdminProductInput["printStation"],
      available: data.get("available") === "on",
      published: data.get("published") === "on"
    };
    const mediaInput = formElement.elements.namedItem("media") as HTMLInputElement;
    if (await props.onSave(input, props.editing?.id ?? null, mediaInput.files?.[0] ?? null)) setEditorOpen(false);
  }

  const product = props.editing;
  return <section id="catalogPanel" className="admin-panel active"><div className={`catalog-layout ${editorOpen ? "editor-open" : ""}`}>
    <aside className="editor-pane"><form key={product?.id ?? "new"} id="productForm" className="editor-form" onSubmit={(event) => void submit(event)}>
      <div className="form-title">
        <div><h2>{product ? t("catalogEdit") : t("catalogNew")}</h2></div>
        <button type="button" className="ghost-action editor-back" onClick={() => setEditorOpen(false)}>← {t("catalogBack")}</button>
      </div>
      <div className="segmented">{(["food", "drink", "sushi"] as const).map((value) => <label key={value}><input type="radio" name="kind" value={value} defaultChecked={(product?.kind ?? "food") === value} /><span>{kindLabels[value]}</span></label>)}</div>
      <label><span>{t("fieldNameZh")}</span><input name="nameZh" defaultValue={product?.names.zh ?? ""} /></label>
      <label><span>{t("fieldNameDe")}</span><input name="nameDe" defaultValue={product?.names.de ?? ""} /></label>
      <label><span>{t("fieldNameEn")}</span><input name="nameEn" defaultValue={product?.names.en ?? ""} /></label>
      <div className="field-grid">
        <label><span>{t("fieldPrice")}</span><input name="price" required type="number" min="0" step="0.01" inputMode="decimal" defaultValue={product ? product.priceCents / 100 : ""} /></label>
        <label><span>{t("fieldCategory")}</span><input name="category" required defaultValue={product?.category ?? ""} placeholder="RAMEN / BAO / WINE" /></label>
      </div>
      <label><span>{t("fieldDescription")}</span><textarea name="description" rows={3} defaultValue={product?.description ?? ""} /></label>
      <label><span>{t("fieldIngredients")}</span><input name="ingredients" defaultValue={product?.details.ingredients ?? ""} /></label>
      <div className="field-grid three"><label><span>{t("fieldTime")}</span><input name="time" defaultValue={product?.details.time ?? ""} /></label><label><span>{t("fieldPortion")}</span><input name="people" defaultValue={product?.details.people ?? ""} /></label><label><span>{t("fieldLevel")}</span><input name="level" defaultValue={product?.details.level ?? ""} /></label></div>
      <fieldset className="allergen-picker"><legend>{t("fieldAllergens")}</legend>{ALLERGENS.map((allergen) => <label key={allergen.code}><input type="checkbox" name="allergens" value={allergen.code} defaultChecked={product?.allergens.includes(allergen.code) ?? false} /><span><b>{allergen.code}</b> {language === "zh" ? allergen.zh : allergen.de}</span></label>)}</fieldset>
      <label className="upload-zone"><input name="media" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" /><b>{t("fieldMedia")}</b><small>{t("fieldMediaHint")}</small></label>
      <div className="switch-row"><label><input type="checkbox" name="available" defaultChecked={product?.available ?? true} /><span>{t("fieldAvailable")}</span></label><label><input type="checkbox" name="published" defaultChecked={product?.published ?? true} /><span>{t("fieldPublished")}</span></label></div>
      <BundleFieldset product={product} products={props.products} />
      {/* What a restaurant rarely touches: numbering, printing, tax and the raw
          option groups. Folded away so the form is the dish, not the plumbing. */}
      <details className="form-advanced">
        <summary>{t("advanced")}</summary>
        <div className="field-grid three">
          <label><span>{t("fieldSku")}</span><input name="sku" defaultValue={product?.sku ?? ""} placeholder={t("fieldSkuHint")} /></label>
          <label><span>{t("fieldStation")}</span><select name="printStation" defaultValue={product?.printStation ?? "kitchen"}>{stationOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>{t("fieldVat")}</span><select name="vatPercent" defaultValue={String(product?.vatPercent ?? 10)}>{[["10", t("vatFood")], ["13", "13%"], ["20", t("vatDrink")]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <label><span>{t("fieldModifiers")}</span><textarea name="modifiers" rows={8} spellCheck={false} defaultValue={JSON.stringify(product?.modifiers ?? [], null, 2)} placeholder={'[{"id":"spice","names":{"zh":"辣度","de":"Scharf","en":"Spice"},"selection":"single","options":[]}]'} /><small>{t("fieldModifiersHint")}</small></label>
      </details>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      <button className="primary-action" type="submit">{product ? t("saveProduct") : t("createProduct")}</button>
      {product && <button type="button" className="danger-action" onClick={() => { if (window.confirm(t("confirmDelete"))) void props.onDelete(product.id).then(() => setEditorOpen(false)); }}>{t("deleteProduct")}</button>}
    </form></aside>
    <section className="list-pane">
      <header className="list-head">
        <div><h1>{t("catalogTitle")}</h1><p>{t("catalogCount", { count: props.products.length })}</p></div>
        <div className="list-head-actions">
          <button className="icon-action" onClick={() => void props.onRefresh()} title={t("refresh")} aria-label={t("refresh")}>↻</button>
          <button className="primary-action" onClick={() => open(null)}>＋ {t("catalogNew")}</button>
        </div>
      </header>
      <div className="filter-tabs">{(["all", "food", "drink", "sushi"] as const).map((value) => <button key={value} className={props.filter === value ? "active" : ""} onClick={() => props.onFilter(value as ProductFilter)}>{value === "all" ? t("filterAll") : kindLabels[value]}</button>)}</div>
      <div className="product-list">{rows.length ? rows.map((row) => {
        const media = row.media[0];
        return <button className={`product-row ${product?.id === row.id ? "selected" : ""}`} key={row.id} onClick={() => open(row)}><span className="product-thumb">{media?.type === "image" ? <img src={props.mediaUrl(media.url)} alt="" /> : <span className="media-mark">{media?.type === "video" ? "▶" : row.kind === "drink" ? "杯" : row.kind === "sushi" ? "鮨" : "菜"}</span>}</span><span className="product-copy"><b>{nameIn(row, language)}</b><small>{row.sku} · {row.category}{row.modifiers?.length ? ` · ${t("modifierCount", { count: row.modifiers.length })}` : ""}{row.bundleItems?.length ? ` · ${t("bundleCount", { count: row.bundleItems.length })}` : ""}</small></span><span className="product-kind">{kindLabels[row.kind]}</span><strong>{formatMoney(row.priceCents, language)}</strong><i className={row.published && row.available ? "live" : ""} /></button>;
      }) : <div className="admin-empty">{t("catalogEmpty")}</div>}</div>
    </section>
  </div></section>;
}
