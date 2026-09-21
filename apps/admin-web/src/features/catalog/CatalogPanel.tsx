import { useState } from "react";
import type { FormEvent } from "react";
import { ALLERGENS } from "../../../../../src/allergens.js";
import { formatEuro } from "@zhaoyun/domain";
import type { BundleItem, ModifierGroup, Product, VatPercent } from "@zhaoyun/domain";
import type { AdminProductInput } from "@zhaoyun/api-client";
import type { ProductFilter } from "../../app/types";

interface Props {
  products: Product[];
  editing: Product | null;
  filter: ProductFilter;
  mediaUrl: (path: string) => string;
  onFilter: (filter: ProductFilter) => void;
  onEdit: (product: Product | null) => void;
  onSave: (input: AdminProductInput, id: string | null, media: File | null) => Promise<void>;
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

function readModifiers(form: FormData): ModifierGroup[] {
  const raw = readText(form, "modifiers");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isModifierGroup)) throw new Error("结构不完整");
    return parsed;
  } catch {
    throw new Error("选项配置必须包含 id、三语名称、选择方式、选项和 priceCents");
  }
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
  const [items, setItems] = useState<BundleItem[]>(() => (product?.bundleItems ?? []).map((item) => ({ ...item })));
  const candidates = products.filter((candidate) => candidate.id !== product?.id);

  function toggle(productId: string, checked: boolean) {
    setItems((current) => checked ? [...current, { productId, quantity: 1 }] : current.filter((item) => item.productId !== productId));
  }
  function setQuantity(productId: string, quantity: number) {
    setItems((current) => current.map((item) => item.productId === productId ? { ...item, quantity: Math.max(1, Math.min(99, quantity)) } : item));
  }

  return <fieldset className="bundle-picker">
    <legend>套餐搭配（可选：把已有菜品打包进这个新条目）</legend>
    <input type="hidden" name="bundleItems" value={JSON.stringify(items)} readOnly />
    <div className="bundle-picker-list">{candidates.length ? candidates.map((candidate) => {
      const selected = items.find((item) => item.productId === candidate.id);
      return <label key={candidate.id} className="bundle-picker-row">
        <input type="checkbox" checked={Boolean(selected)} onChange={(event) => toggle(candidate.id, event.target.checked)} />
        <span>{candidate.names.zh || candidate.names.de || candidate.names.en}</span>
        {selected && <input type="number" min={1} max={99} value={selected.quantity} onChange={(event) => setQuantity(candidate.id, Number(event.target.value) || 1)} />}
      </label>;
    }) : <p className="bundle-picker-empty">还没有其他商品可以打包</p>}</div>
  </fieldset>;
}

export function CatalogPanel(props: Props) {
  const rows = props.products.filter((product) => props.filter === "all" || product.kind === props.filter);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
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
      modifiers: readModifiers(data),
      bundleItems: readBundleItems(data),
      printStation: readText(data, "printStation") as AdminProductInput["printStation"],
      available: data.get("available") === "on",
      published: data.get("published") === "on"
    };
    const mediaInput = formElement.elements.namedItem("media") as HTMLInputElement;
    await props.onSave(input, props.editing?.id ?? null, mediaInput.files?.[0] ?? null);
  }

  const product = props.editing;
  return <section id="catalogPanel" className="admin-panel active"><div className="catalog-layout">
    <aside className="editor-pane"><form key={product?.id ?? "new"} id="productForm" className="editor-form" onSubmit={(event) => void submit(event)}>
      <div className="form-title"><div><h2>{product ? "编辑商品" : "新增商品"}</h2><p>菜品、酒水与寿司共用统一商品模型</p></div>{product && <button type="button" className="icon-action" onClick={() => props.onEdit(null)} title="新建商品">＋</button>}</div>
      <div className="segmented">{[["food", "菜品"], ["drink", "酒水"], ["sushi", "寿司"]].map(([value, label]) => <label key={value}><input type="radio" name="kind" value={value} defaultChecked={(product?.kind ?? "food") === value} /><span>{label}</span></label>)}</div>
      <div className="field-grid"><label><span>SKU</span><input name="sku" defaultValue={product?.sku ?? ""} placeholder="自动生成" /></label><label><span>分类</span><input name="category" required defaultValue={product?.category ?? ""} placeholder="MAIN / WINE / NIGIRI" /></label></div>
      <label><span>中文名称</span><input name="nameZh" defaultValue={product?.names.zh ?? ""} /></label>
      <label><span>德文名称</span><input name="nameDe" defaultValue={product?.names.de ?? ""} /></label>
      <label><span>英文名称</span><input name="nameEn" defaultValue={product?.names.en ?? ""} /></label>
      <label><span>简介</span><textarea name="description" rows={3} defaultValue={product?.description ?? ""} /></label>
      <div className="field-grid three"><label><span>价格 EUR（含税）</span><input name="price" required type="number" min="0" step="0.01" defaultValue={product ? product.priceCents / 100 : ""} /></label><label><span>出单档口</span><select name="printStation" defaultValue={product?.printStation ?? "kitchen"}>{[["kitchen", "厨房"], ["bar", "吧台"], ["sushi", "寿司台"], ["front", "前台"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>税率</span><select name="vatPercent" defaultValue={String(product?.vatPercent ?? 10)}>{[["10", "10%（餐食）"], ["13", "13%"], ["20", "20%（酒水）"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      <label><span>主要食材</span><input name="ingredients" defaultValue={product?.details.ingredients ?? ""} /></label>
      <div className="field-grid three"><label><span>制作时间</span><input name="time" defaultValue={product?.details.time ?? ""} /></label><label><span>份量</span><input name="people" defaultValue={product?.details.people ?? ""} /></label><label><span>口味/难度</span><input name="level" defaultValue={product?.details.level ?? ""} /></label></div>
      <fieldset className="allergen-picker"><legend>过敏原（奥地利 A–R 代码）</legend>{ALLERGENS.map((allergen) => <label key={allergen.code}><input type="checkbox" name="allergens" value={allergen.code} defaultChecked={product?.allergens.includes(allergen.code) ?? false} /><span><b>{allergen.code}</b> {allergen.zh} · {allergen.de}</span></label>)}</fieldset>
      <label><span>点餐选项（JSON）</span><textarea name="modifiers" rows={8} spellCheck={false} defaultValue={JSON.stringify(product?.modifiers ?? [], null, 2)} placeholder={'[{"id":"spice","names":{"zh":"辣度","de":"Scharf","en":"Spice"},"selection":"single","options":[]}]'} /><small>选项会进入订单和打印单；价格使用 priceCents（分）。</small></label>
      <BundleFieldset product={product} products={props.products} />
      <label className="upload-zone"><input name="media" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" /><b>选择图片或视频</b><small>JPEG、PNG、WebP、MP4、WebM，最大 50 MB</small></label>
      <div className="switch-row"><label><input type="checkbox" name="available" defaultChecked={product?.available ?? true} /><span>可售</span></label><label><input type="checkbox" name="published" defaultChecked={product?.published ?? true} /><span>前台显示</span></label></div>
      <button className="primary-action" type="submit">{product ? "保存修改" : "创建商品"}</button>
    </form></aside>
    <section className="list-pane"><header className="list-head"><div><h1>商品目录</h1><p>{props.products.length} 个商品</p></div><button className="icon-action" onClick={() => void props.onRefresh()} title="刷新">↻</button></header>
      <div className="filter-tabs">{[["all", "全部"], ["food", "菜品"], ["drink", "酒水"], ["sushi", "寿司"]].map(([value, label]) => <button key={value} className={props.filter === value ? "active" : ""} onClick={() => props.onFilter(value as ProductFilter)}>{label}</button>)}</div>
      <div className="product-list">{rows.length ? rows.map((row) => {
        const media = row.media[0];
        return <button className={`product-row ${product?.id === row.id ? "selected" : ""}`} key={row.id} onClick={() => props.onEdit(row)}><span className="product-thumb">{media?.type === "image" ? <img src={props.mediaUrl(media.url)} alt="" /> : <span className="media-mark">{media?.type === "video" ? "▶" : row.kind === "drink" ? "杯" : row.kind === "sushi" ? "鮨" : "菜"}</span>}</span><span className="product-copy"><b>{row.names.zh || row.names.de || row.names.en}</b><small>{row.sku} · {row.category}{row.modifiers?.length ? ` · ${row.modifiers.length} 组选项` : ""}{row.bundleItems?.length ? ` · 套餐(${row.bundleItems.length})` : ""}</small></span><span className="product-kind">{{ food: "菜品", drink: "酒水", sushi: "寿司" }[row.kind]}</span><strong>{formatEuro(row.priceCents)}</strong><i className={row.published && row.available ? "live" : ""} /></button>;
      }) : <div className="admin-empty">当前分类暂无商品</div>}</div>
      {product && <button className="danger-action" onClick={() => { if (window.confirm("确定删除这个商品及其媒体吗？")) void props.onDelete(product.id); }}>删除当前商品</button>}
    </section>
  </div></section>;
}
